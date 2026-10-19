//! 復元キー（0013 の3）: 親鍵32バイト＋確かめ用4バイトを Base32 にした58文字を、4文字ずつ「-」で区切った72文字。
//!
//! - 文字の並びは数字と英大文字の32文字の Base32（I・L・O・U を使わない並び）。印刷して書き写しても読み違いが起きにくい。
//! - 入力のときは、大文字・小文字、空白、区切りの有無、全角の英数字を問わない。紛らわしい文字は吸収する（O→0、I・L→1）。
//! - 確かめ用の4バイト（親鍵の SHA-256 の先頭4バイト）が合わなければ打ち間違い（[`StoreError::RECOVERY_TYPO`]）。

use zeroize::Zeroizing;

use crate::crypto::{self, Key, KEY_LEN};
use crate::StoreError;

pub(crate) const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RAW_LEN: usize = KEY_LEN + 4;
/// 区切りを除いた文字数（36バイト＝288ビット → 5ビットずつで58文字）
pub const CHARS: usize = 58;
/// 区切りを含む文字数
pub const DISPLAY_LEN: usize = 72;

fn check_of(master: &[u8; KEY_LEN]) -> [u8; 4] {
    let h = crypto::sha256(master);
    [h[0], h[1], h[2], h[3]]
}

/// 親鍵から復元キー（表示の形）を作る
pub fn encode(master: &[u8; KEY_LEN]) -> Zeroizing<String> {
    let mut raw = Zeroizing::new([0u8; RAW_LEN]);
    raw[..KEY_LEN].copy_from_slice(master);
    raw[KEY_LEN..].copy_from_slice(&check_of(master));
    let mut chars = Zeroizing::new(String::with_capacity(CHARS));
    let mut acc: u32 = 0;
    let mut bits = 0;
    for b in raw.iter() {
        acc = (acc << 8) | u32::from(*b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            chars.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
        acc &= (1 << bits) - 1;
    }
    if bits > 0 {
        chars.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    let mut out = Zeroizing::new(String::with_capacity(DISPLAY_LEN));
    for (i, c) in chars.chars().enumerate() {
        if i > 0 && i % 4 == 0 {
            out.push('-');
        }
        out.push(c);
    }
    out
}

pub(crate) fn value_of(c: char) -> Option<u8> {
    // 全角の英数字を半角に
    let c = match c {
        '\u{FF10}'..='\u{FF19}' | '\u{FF21}'..='\u{FF3A}' | '\u{FF41}'..='\u{FF5A}' => {
            char::from_u32(c as u32 - 0xFEE0)?
        }
        other => other,
    };
    let c = match c.to_ascii_uppercase() {
        'O' => '0',
        'I' | 'L' => '1',
        other => other,
    };
    ALPHABET
        .iter()
        .position(|a| *a as char == c)
        .map(|p| p as u8)
}

pub(crate) fn is_separator(c: char) -> bool {
    c.is_whitespace() || matches!(c, '-' | '‐' | '－' | 'ー' | '—' | '–' | '_' | '.' | '・')
}

/// 復元キー（入力）から親鍵を取り出す。打ち間違いは [`StoreError::RECOVERY_TYPO`]
pub fn decode(input: &str) -> Result<Key, StoreError> {
    let mut values = Zeroizing::new(Vec::with_capacity(CHARS));
    for c in input.chars() {
        if is_separator(c) {
            continue;
        }
        values.push(value_of(c).ok_or(StoreError::RECOVERY_TYPO)?);
    }
    if values.len() != CHARS {
        return Err(StoreError::RECOVERY_TYPO);
    }
    let mut raw = Zeroizing::new([0u8; RAW_LEN]);
    let mut acc: u32 = 0;
    let mut bits = 0;
    let mut n = 0;
    for v in values.iter() {
        acc = (acc << 5) | u32::from(*v);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            if n < RAW_LEN {
                raw[n] = ((acc >> bits) & 0xff) as u8;
            }
            n += 1;
        }
        acc &= (1 << bits) - 1;
    }
    // 最後の文字の余りのビットは 0（違えば打ち間違い）
    if n != RAW_LEN || acc != 0 {
        return Err(StoreError::RECOVERY_TYPO);
    }
    let mut master = Zeroizing::new([0u8; KEY_LEN]);
    master.copy_from_slice(&raw[..KEY_LEN]);
    if raw[KEY_LEN..] != check_of(&master) {
        return Err(StoreError::RECOVERY_TYPO);
    }
    Ok(master)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_shape() {
        for _ in 0..50 {
            let m = crypto::random_key();
            let k = encode(&m);
            assert_eq!(k.chars().count(), DISPLAY_LEN, "{}", k.as_str());
            assert_eq!(k.split('-').count(), 15);
            assert!(k.chars().all(|c| c == '-' || ALPHABET.contains(&(c as u8))));
            assert_eq!(*decode(&k).unwrap(), *m);
        }
    }

    #[test]
    fn input_is_forgiving() {
        let m = crypto::random_key();
        let k = encode(&m).to_string();
        // 小文字・空白区切り・区切りなし
        assert_eq!(*decode(&k.to_lowercase()).unwrap(), *m);
        assert_eq!(*decode(&k.replace('-', " ")).unwrap(), *m);
        assert_eq!(*decode(&k.replace('-', "")).unwrap(), *m);
        // 紛らわしい文字: 0 を O、1 を I・L と書いたもの
        assert_eq!(*decode(&k.replace('0', "O")).unwrap(), *m);
        assert_eq!(*decode(&k.replace('1', "l")).unwrap(), *m);
        // 全角の英数字
        let wide: String = k
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    char::from_u32(c as u32 + 0xFEE0).unwrap()
                } else {
                    c
                }
            })
            .collect();
        assert_eq!(*decode(&wide).unwrap(), *m);
    }

    #[test]
    fn typos_are_detected() {
        let m = crypto::random_key();
        let k = encode(&m).to_string();
        // どの1文字を別の文字に変えても、打ち間違いとして止まる
        let chars: Vec<char> = k.chars().collect();
        for i in (0..chars.len()).filter(|i| chars[*i] != '-') {
            let mut c = chars.clone();
            c[i] = if c[i] == 'A' { 'B' } else { 'A' };
            let s: String = c.into_iter().collect();
            assert_eq!(decode(&s).unwrap_err(), StoreError::RECOVERY_TYPO, "{i}");
        }
        assert_eq!(decode(&k[..70]).unwrap_err(), StoreError::RECOVERY_TYPO);
        assert_eq!(
            decode(&format!("{k}A")).unwrap_err(),
            StoreError::RECOVERY_TYPO
        );
        assert_eq!(
            decode(&k.replacen(|c: char| c.is_ascii_alphanumeric(), "U", 1)).unwrap_err(),
            StoreError::RECOVERY_TYPO
        );
        assert_eq!(decode("").unwrap_err(), StoreError::RECOVERY_TYPO);
    }
}
