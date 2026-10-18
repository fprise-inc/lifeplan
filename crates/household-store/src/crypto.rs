//! 暗号の部品（0013 の1・2）: AES-256-GCM（鍵 256 ビット・ナンス 96 ビットの乱数）、HKDF-SHA256 による用途ごとの鍵、乱数、指紋。
//! 鍵は [`Key`]（使い終わるとメモリから消える）で持つ。

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::StoreError;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
/// 封筒に書く暗号の方式の名前（0011 の1）
pub const CIPHER: &str = "aes-256-gcm";

/// 鍵（32バイト）。落とすときにメモリから消す
pub type Key = Zeroizing<[u8; KEY_LEN]>;

/// OS の乱数で埋める
pub fn fill_random(buf: &mut [u8]) {
    getrandom::getrandom(buf).expect("OS の乱数を使えません");
}

pub fn random_key() -> Key {
    let mut k = Zeroizing::new([0u8; KEY_LEN]);
    fill_random(k.as_mut());
    k
}

pub fn random_nonce() -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    fill_random(&mut n);
    n
}

/// 乱数だけで作る UUID 第4版（0004・0012: 日時・PC・人の情報を含めない）
pub fn new_uuid() -> String {
    let mut b = [0u8; 16];
    fill_random(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex_encode(&b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// UUID の書式（英小文字の16進）か。ファイル名に使う前に必ず確かめる
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
        })
}

/// 暗号化（認証タグを含む暗号文を返す）。aad は改ざん検出の対象（付加データ）
pub fn seal(key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], aad: &[u8], plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("鍵の長さ");
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .expect("暗号化")
}

/// 復号。改ざん・別の鍵・別の付加データでは [`StoreError::CORRUPT`]
pub fn open(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, StoreError> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("鍵の長さ");
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| StoreError::CORRUPT)
}

/// 親鍵から用途ごとの鍵を導く（0013 の2: 1つの鍵を複数の用途に直接使わない）
pub fn derive(master: &[u8; KEY_LEN], info: &str) -> Key {
    let hk = Hkdf::<Sha256>::new(None, master);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(info.as_bytes(), out.as_mut())
        .expect("HKDF の長さ");
    out
}

/// 用途の名前（HKDF の info）。版を付け、変えない
pub mod purpose {
    pub const KEY_VAULT: &str = "lifeplan/key-vault/v1";
    pub const HOUSEHOLD_KEY_WRAP: &str = "lifeplan/household-key-wrap/v1";
    pub const OFFICE_DATA: &str = "lifeplan/office-data/v1";
    pub const KEY_CHECK: &str = "lifeplan/key-check/v1";
}

/// ファイル全体の指紋（0011 の1 の改訂のID）。`sha256:<16進>`
pub fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex_encode(&Sha256::digest(bytes)))
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let v = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    s.as_bytes()
        .chunks(2)
        .map(|p| Some((v(p[0])? << 4) | v(p[1])?))
        .collect()
}

/// 16進の文字列から決まった長さの配列へ
pub fn hex_array<const N: usize>(s: &str) -> Option<[u8; N]> {
    hex_decode(s)?.try_into().ok()
}

/// 16進の文字列から鍵へ（途中の値もメモリから消す）
pub fn key_from_hex(s: &str) -> Option<Key> {
    let v = Zeroizing::new(hex_decode(s)?);
    if v.len() != KEY_LEN {
        return None;
    }
    let mut k = Zeroizing::new([0u8; KEY_LEN]);
    k.copy_from_slice(&v);
    Some(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open() {
        let k = random_key();
        let n = random_nonce();
        let c = seal(&k, &n, b"aad", b"hello");
        assert_eq!(open(&k, &n, b"aad", &c).unwrap().as_slice(), b"hello");
        assert_eq!(open(&k, &n, b"aaD", &c).unwrap_err(), StoreError::CORRUPT);
        let k2 = random_key();
        assert_eq!(open(&k2, &n, b"aad", &c).unwrap_err(), StoreError::CORRUPT);
        let mut bad = c.clone();
        bad[0] ^= 1;
        assert_eq!(open(&k, &n, b"aad", &bad).unwrap_err(), StoreError::CORRUPT);
    }

    #[test]
    fn derived_keys_differ_by_purpose() {
        let m = random_key();
        assert_ne!(
            *derive(&m, purpose::KEY_VAULT),
            *derive(&m, purpose::OFFICE_DATA)
        );
        assert_eq!(
            *derive(&m, purpose::KEY_VAULT),
            *derive(&m, purpose::KEY_VAULT)
        );
    }

    #[test]
    fn uuid_and_hex() {
        let u = new_uuid();
        assert!(is_uuid(&u), "{u}");
        assert_eq!(&u[14..15], "4");
        assert!(!is_uuid("../../etc/passwd"));
        assert!(!is_uuid(&u.to_uppercase()));
        assert_eq!(
            hex_decode(&hex_encode(&[0, 1, 254, 255])).unwrap(),
            vec![0, 1, 254, 255]
        );
        assert!(hex_decode("abc").is_none());
        assert!(hex_decode("zz").is_none());
    }
}
