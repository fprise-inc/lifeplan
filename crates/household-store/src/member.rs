//! メンバーの鍵の組と、事務所の親鍵の包み（0023 の2・3）。
//!
//! - 鍵の組は X25519。秘密鍵は各メンバーの PC の OS の資格情報の保管庫に置き、PC の外へ出さない（[`MemberKeys`]）。
//! - 親鍵の包み: 使い捨ての鍵の組と相手の公開鍵の鍵交換（X25519）から HKDF-SHA256 で鍵を導き、AES-256-GCM で親鍵を包む。
//!   改ざん検出の対象は「名簿の包みであること・事務所ID・親鍵の鍵ID・メンバーID」（別のメンバーの欄・別の時代の欄と入れ替えても開かない）。
//! - 指紋: 「メンバーの公開鍵であること」の印と公開鍵をつないだものの SHA-256 の先頭10バイトを、復元キーと同じ文字の並びで16文字にし、
//!   4文字ずつ区切ったもの（80ビット）。

use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

use crate::crypto::{self, purpose, Key, KEY_LEN, NONCE_LEN};
use crate::recovery::{is_separator, value_of, ALPHABET};
use crate::StoreError;

/// 指紋の文字数（区切りを除く）
pub const FINGERPRINT_CHARS: usize = 16;

/// メンバーの鍵の組（秘密鍵は落とすときにメモリから消える）
pub struct MemberKeys {
    secret: StaticSecret,
}

impl MemberKeys {
    pub fn generate() -> MemberKeys {
        let mut b = Zeroizing::new([0u8; 32]);
        crypto::fill_random(b.as_mut());
        MemberKeys {
            secret: StaticSecret::from(*b),
        }
    }

    /// 保管庫の文字列（16進）から
    pub fn from_hex(s: &str) -> Option<MemberKeys> {
        let k = crypto::key_from_hex(s.trim())?;
        Some(MemberKeys {
            secret: StaticSecret::from(*k),
        })
    }

    /// 保管庫に入れる文字列（16進）
    pub fn secret_hex(&self) -> Zeroizing<String> {
        Zeroizing::new(crypto::hex_encode(self.secret.as_bytes()))
    }

    pub fn public(&self) -> [u8; 32] {
        PublicKey::from(&self.secret).to_bytes()
    }

    pub fn public_hex(&self) -> String {
        crypto::hex_encode(&self.public())
    }
}

/// 公開鍵の指紋（例: `7K2M-QX9P-ABCD-EFGH`）
pub fn fingerprint(public: &[u8; 32]) -> String {
    let mut data = b"lifeplan.memberKey\0".to_vec();
    data.extend_from_slice(public);
    // 10バイト＝80ビット → 5ビットずつで16文字
    grouped_base32(&crypto::sha256(&data)[..10])
}

/// バイト列を、復元キーと同じ文字の並び（5ビットずつ）で4文字ずつ「-」で区切った形にする（長さは5バイトの倍数）
fn grouped_base32(bytes: &[u8]) -> String {
    debug_assert!(bytes.len().is_multiple_of(5));
    let mut chars = String::with_capacity(bytes.len() * 8 / 5 + bytes.len() / 2);
    let mut acc: u32 = 0;
    let mut bits = 0;
    let mut n = 0;
    for b in bytes {
        acc = (acc << 8) | u32::from(*b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            if n > 0 && n % 4 == 0 {
                chars.push('-');
            }
            chars.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
            n += 1;
        }
        acc &= (1 << bits) - 1;
    }
    chars
}

/// 入力された指紋を、比べられる形（区切りを除いた16文字の英大文字・数字）にする。形が違えば None。
/// 大文字・小文字、空白・区切り、全角の英数字、紛らわしい文字（O→0、I・L→1）を吸収する
pub fn normalize_fingerprint(input: &str) -> Option<String> {
    normalize_chars(input, FINGERPRINT_CHARS)
}

/// 入力を、区切りを除いた `len` 文字の英大文字・数字にする（形が違えば None）
fn normalize_chars(input: &str, len: usize) -> Option<String> {
    let mut out = String::with_capacity(len);
    for c in input.chars() {
        if is_separator(c) {
            continue;
        }
        let v = value_of(c)?;
        out.push(ALPHABET[v as usize] as char);
    }
    (out.chars().count() == len).then_some(out)
}

/// 入力された指紋が、公開鍵の指紋と同じか
pub fn fingerprint_matches(input: &str, public: &[u8; 32]) -> bool {
    match normalize_fingerprint(input) {
        Some(n) => n == fingerprint(public).replace('-', ""),
        None => false,
    }
}

/// 名簿の見出しに置く、1人分の親鍵の包み（平文の欄。中の親鍵は暗号化してある）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wrap {
    /// 使い捨ての公開鍵（16進）
    pub ephemeral: String,
    pub member_id: String,
    pub nonce: String,
    /// 包んだ親鍵（認証タグを含む。16進）
    pub wrapped: String,
}

fn wrap_aad(office_id: &str, master_key_id: &str, member_id: &str) -> Vec<u8> {
    format!("lifeplan.memberWrap\0{office_id}\0{master_key_id}\0{member_id}").into_bytes()
}

fn wrap_key(shared: &[u8; 32], ephemeral: &[u8; 32], member: &[u8; 32]) -> Key {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(ephemeral);
    salt[32..].copy_from_slice(member);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(purpose::MEMBER_WRAP.as_bytes(), out.as_mut())
        .expect("HKDF の長さ");
    out
}

/// 親鍵を、メンバーの公開鍵で包む
pub fn wrap_master(
    master: &[u8; KEY_LEN],
    member_public: &[u8; 32],
    office_id: &str,
    master_key_id: &str,
    member_id: &str,
) -> Result<Wrap, StoreError> {
    let eph = MemberKeys::generate();
    let eph_pub = eph.public();
    let shared = eph.secret.diffie_hellman(&PublicKey::from(*member_public));
    if !shared.was_contributory() {
        // 公開鍵が小さい位数の点（壊れた・悪意のある公開鍵）
        return Err(StoreError::OFFICE_BAD_KEY);
    }
    let k = wrap_key(shared.as_bytes(), &eph_pub, member_public);
    let nonce = crypto::random_nonce();
    let wrapped = crypto::seal(
        &k,
        &nonce,
        &wrap_aad(office_id, master_key_id, member_id),
        master,
    );
    Ok(Wrap {
        ephemeral: crypto::hex_encode(&eph_pub),
        member_id: member_id.to_owned(),
        nonce: crypto::hex_encode(&nonce),
        wrapped: crypto::hex_encode(&wrapped),
    })
}

/// 自分の包みから親鍵を取り出す
pub fn unwrap_master(
    w: &Wrap,
    keys: &MemberKeys,
    office_id: &str,
    master_key_id: &str,
) -> Result<Key, StoreError> {
    let eph: [u8; 32] = crypto::hex_array(&w.ephemeral).ok_or(StoreError::CORRUPT)?;
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&w.nonce).ok_or(StoreError::CORRUPT)?;
    let wrapped = crypto::hex_decode(&w.wrapped).ok_or(StoreError::CORRUPT)?;
    let shared = keys.secret.diffie_hellman(&PublicKey::from(eph));
    if !shared.was_contributory() {
        return Err(StoreError::CORRUPT);
    }
    let k = wrap_key(shared.as_bytes(), &eph, &keys.public());
    let raw = crypto::open(
        &k,
        &nonce,
        &wrap_aad(office_id, master_key_id, &w.member_id),
        &wrapped,
    )?;
    if raw.len() != KEY_LEN {
        return Err(StoreError::CORRUPT);
    }
    let mut m = Zeroizing::new([0u8; KEY_LEN]);
    m.copy_from_slice(&raw);
    Ok(m)
}

/// 事務所の確かめ用の番号（親鍵から導いた16文字。全員の画面で同じになる。0023 の2・追記 2026-11-04）。
///
/// 用途 `lifeplan/office-code/v1` で親鍵から導いた値の先頭10バイト（80ビット）を、指紋と同じ文字の並びで4文字ずつ区切る。
/// 前の版の8文字（先頭5バイト）は、この番号の前半の8文字と同じ。
/// 30日より長くアプリを開かなかったメンバーが、ほかのメンバーから聞いたこの番号で入れ替えの後の名簿を受け入れる
/// （[`office_code_matches`]）ので、番号の一致する偽の親鍵を作るのに 2^80 回ほどの計算が要る長さにした（見積もりは 0023 の追記）
pub fn office_code(master: &[u8; KEY_LEN]) -> String {
    let d = crypto::derive(master, purpose::OFFICE_CODE);
    grouped_base32(&d[..10])
}

/// 事務所の確かめ用の番号の文字数（区切りを除く）
pub const OFFICE_CODE_CHARS: usize = 16;

/// 入力された事務所の確かめ用の番号を、比べられる形（区切りを除いた16文字）にする。形が違えば None（指紋と同じく紛らわしい文字を吸収する）
pub fn normalize_office_code(input: &str) -> Option<String> {
    normalize_chars(input, OFFICE_CODE_CHARS)
}

/// 入力された事務所の確かめ用の番号が、この親鍵の番号と同じか（16文字の形でなければ false。前の版の8文字では合わない）
pub fn office_code_matches(input: &str, master: &[u8; KEY_LEN]) -> bool {
    match normalize_office_code(input) {
        Some(n) => n == office_code(master).replace('-', ""),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_round_trip_and_binding() {
        let m = crypto::random_key();
        let a = MemberKeys::generate();
        let b = MemberKeys::generate();
        let w = wrap_master(&m, &a.public(), "office", "mk1", "member-a").unwrap();
        assert_eq!(*unwrap_master(&w, &a, "office", "mk1").unwrap(), *m);
        // 別の人の秘密鍵・別の事務所・別の時代・別のメンバーの欄としては開かない
        assert!(unwrap_master(&w, &b, "office", "mk1").is_err());
        assert!(unwrap_master(&w, &a, "office2", "mk1").is_err());
        assert!(unwrap_master(&w, &a, "office", "mk2").is_err());
        let mut moved = w.clone();
        moved.member_id = "member-b".into();
        assert!(unwrap_master(&moved, &a, "office", "mk1").is_err());
        // 小さい位数の点（全部 0 の公開鍵）には包まない
        assert_eq!(
            wrap_master(&m, &[0u8; 32], "office", "mk1", "x").unwrap_err(),
            StoreError::OFFICE_BAD_KEY
        );
    }

    #[test]
    fn secret_round_trip() {
        let a = MemberKeys::generate();
        let b = MemberKeys::from_hex(&a.secret_hex()).unwrap();
        assert_eq!(a.public(), b.public());
        assert!(MemberKeys::from_hex("zz").is_none());
    }

    #[test]
    fn fingerprints() {
        let a = MemberKeys::generate();
        let f = fingerprint(&a.public());
        assert_eq!(f.len(), 19, "{f}");
        assert_eq!(f.split('-').count(), 4);
        assert!(fingerprint_matches(&f, &a.public()));
        assert!(fingerprint_matches(
            &f.to_lowercase().replace('-', " "),
            &a.public()
        ));
        assert!(fingerprint_matches(&f.replace('0', "O"), &a.public()));
        assert!(!fingerprint_matches("", &a.public()));
        assert!(!fingerprint_matches(&f[..18], &a.public()));
        let b = MemberKeys::generate();
        assert!(!fingerprint_matches(&f, &b.public()));
        // どの1文字を変えても一致しない
        let chars: Vec<char> = f.chars().collect();
        for i in (0..chars.len()).filter(|i| chars[*i] != '-') {
            let mut c = chars.clone();
            c[i] = if c[i] == 'A' { 'B' } else { 'A' };
            let s: String = c.into_iter().collect();
            assert!(!fingerprint_matches(&s, &a.public()), "{i}");
        }
    }

    #[test]
    fn office_code_shape() {
        let m = crypto::random_key();
        let c = office_code(&m);
        assert_eq!(c.len(), 19, "{c}");
        assert_eq!(c.split('-').count(), 4);
        assert_eq!(c, office_code(&m));
        assert_ne!(c, office_code(&crypto::random_key()));
        // 前の版の8文字（先頭5バイト）は、前半の8文字と同じ
        let d = crypto::derive(&m, purpose::OFFICE_CODE);
        assert_eq!(&c[..9], grouped_base32(&d[..5]));
        assert!(office_code_matches(&c, &m));
        assert!(office_code_matches(&c.to_lowercase().replace('-', " "), &m));
        assert!(office_code_matches(
            &c.replace('0', "O").replace('1', "l"),
            &m
        ));
        assert!(
            !office_code_matches(&c[..9], &m),
            "前の版の8文字では合わない"
        );
        assert!(!office_code_matches("", &m));
        assert!(!office_code_matches(&c, &crypto::random_key()));
        let chars: Vec<char> = c.chars().collect();
        for i in (0..chars.len()).filter(|i| chars[*i] != '-') {
            let mut x = chars.clone();
            x[i] = if x[i] == 'A' { 'B' } else { 'A' };
            let s: String = x.into_iter().collect();
            assert!(!office_code_matches(&s, &m), "{i}");
        }
    }
}
