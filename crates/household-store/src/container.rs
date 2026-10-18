//! 封筒（ファイルの外側。0011 の1）:
//!
//! ```text
//! [4バイト] 識別の印（世帯ファイルは "LPHF"）
//! [1バイト] 容器の版（0x01）
//! [4バイト] 見出しの長さ（ビッグエンディアン）
//! [見出し]   UTF-8 の JSON（キーの名前の順に並べ、空白を入れない形）
//! [残り]     暗号文（認証タグを含む）
//! ```
//!
//! 改ざん検出の対象（付加データ）は、暗号文の前のバイト列すべて（識別の印・容器の版・長さ・見出しの JSON 全体）。
//! 見出しの1文字の書き換え、別の世帯の見出しへの差し替え、世代番号の書き換えは、どれも開けなくなる（0011 の1・0013 の1）。
//! 同じ容器を、鍵置き場（"LPKV"）と事務所データ（"LPOD"）にも使う。

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, NONCE_LEN};
use crate::StoreError;

pub const CONTAINER_VERSION: u8 = 0x01;
const PREFIX_LEN: usize = 4 + 1 + 4;
/// 見出しの大きさの上限（見出しは数百バイト。壊れたファイルで大きな割り当てをしない）
const MAX_HEADER: usize = 64 * 1024;

/// 容器に包む（見出しの JSON はすでに正規化した形）
pub fn seal(
    magic: &[u8; 4],
    header_json: &[u8],
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    body: &[u8],
) -> Vec<u8> {
    let mut out = prefix(magic, header_json);
    let c = crypto::seal(key, nonce, &out, body);
    out.extend_from_slice(&c);
    out
}

fn prefix(magic: &[u8; 4], header_json: &[u8]) -> Vec<u8> {
    let len = u32::try_from(header_json.len()).expect("見出しの長さ");
    let mut out = Vec::with_capacity(PREFIX_LEN + header_json.len() + 64);
    out.extend_from_slice(magic);
    out.push(CONTAINER_VERSION);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(header_json);
    out
}

/// 容器を分ける（暗号は外さない）。見出しの JSON・付加データ（暗号文の前のすべて）・暗号文
pub struct Parts<'a> {
    pub header: &'a [u8],
    pub aad: &'a [u8],
    pub ciphertext: &'a [u8],
}

pub fn split<'a>(magic: &[u8; 4], bytes: &'a [u8]) -> Result<Parts<'a>, StoreError> {
    if bytes.len() < PREFIX_LEN || &bytes[0..4] != magic || bytes[4] != CONTAINER_VERSION {
        return Err(StoreError::CORRUPT);
    }
    let len = u32::from_be_bytes(bytes[5..9].try_into().unwrap()) as usize;
    if len > MAX_HEADER || bytes.len() < PREFIX_LEN + len + 16 {
        return Err(StoreError::CORRUPT);
    }
    let end = PREFIX_LEN + len;
    Ok(Parts {
        header: &bytes[PREFIX_LEN..end],
        aad: &bytes[..end],
        ciphertext: &bytes[end..],
    })
}

/// 見出しを JSON にする。構造体の欄はキーの名前の順に宣言してあるので、この順で出る（正規化した形）
pub fn header_json<T: Serialize>(h: &T) -> Vec<u8> {
    serde_json::to_vec(h).expect("見出しの JSON")
}

/// 世帯ファイルの見出し（0011 の1）。欄は JSON のキーの名前の順に並べる（変えない）。
/// 顧客を推測できる情報（基準日・保存日時・顧客番号など）は書かない
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdHeader {
    pub cipher: String,
    /// 本文の圧縮（0011 の未確定。今は圧縮しない "none"）
    pub compression: String,
    pub device_id: String,
    pub format: String,
    pub format_version: String,
    pub generation: u64,
    pub household_id: String,
    /// 世帯の鍵の鍵ID（0013 の2。親鍵の鍵IDではない）
    pub key_id: String,
    /// 16進
    pub nonce: String,
    /// この保存の元になったファイル全体の指紋（新規は null）
    pub parent_revision: Option<String>,
}

/// 世帯ファイルを作る（見出しのナンスはここで新しく作る）
pub fn seal_household(mut header: HouseholdHeader, key: &[u8; 32], body: &[u8]) -> Vec<u8> {
    let nonce = crypto::random_nonce();
    header.nonce = crypto::hex_encode(&nonce);
    header.cipher = crypto::CIPHER.to_owned();
    seal(
        crate::HOUSEHOLD_MAGIC,
        &header_json(&header),
        key,
        &nonce,
        body,
    )
}

/// 世帯ファイルの見出しだけを読む（暗号は外さない。鍵を探すため）
pub fn read_household_header(bytes: &[u8]) -> Result<HouseholdHeader, StoreError> {
    let p = split(crate::HOUSEHOLD_MAGIC, bytes)?;
    let h: HouseholdHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    if h.format != crate::HOUSEHOLD_FORMAT || h.cipher != crypto::CIPHER || h.compression != "none"
    {
        return Err(StoreError::CORRUPT);
    }
    Ok(h)
}

/// 世帯ファイルの暗号を外す（見出しと本文）
pub fn open_household(
    bytes: &[u8],
    key: &[u8; 32],
) -> Result<(HouseholdHeader, Zeroizing<Vec<u8>>), StoreError> {
    let h = read_household_header(bytes)?;
    let p = split(crate::HOUSEHOLD_MAGIC, bytes)?;
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let body = crypto::open(key, &nonce, p.aad, p.ciphertext)?;
    Ok((h, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header() -> HouseholdHeader {
        HouseholdHeader {
            cipher: String::new(),
            compression: "none".into(),
            device_id: crypto::new_uuid(),
            format: crate::HOUSEHOLD_FORMAT.into(),
            format_version: "0.1".into(),
            generation: 3,
            household_id: crypto::new_uuid(),
            key_id: crypto::new_uuid(),
            nonce: String::new(),
            parent_revision: Some("sha256:00".into()),
        }
    }

    #[test]
    fn header_keys_are_in_name_order() {
        let j = String::from_utf8(header_json(&header())).unwrap();
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(
            keys, sorted,
            "serde_json の Map が名前の順でも、構造体の宣言の順で出ている"
        );
        // 構造体の宣言の順で出ることを、文字の位置で確かめる
        let pos: Vec<usize> = [
            "\"cipher\"",
            "\"compression\"",
            "\"deviceId\"",
            "\"format\"",
            "\"formatVersion\"",
            "\"generation\"",
            "\"householdId\"",
            "\"keyId\"",
            "\"nonce\"",
            "\"parentRevision\"",
        ]
        .iter()
        .map(|k| j.find(k).unwrap())
        .collect();
        assert!(pos.windows(2).all(|w| w[0] < w[1]), "{j}");
        assert!(!j.contains(' '), "空白を入れない");
    }

    #[test]
    fn every_header_byte_is_authenticated() {
        let key = crypto::random_key();
        let file = seal_household(header(), &key, b"{\"a\":1}");
        let (h, body) = open_household(&file, &key).unwrap();
        assert_eq!(h.generation, 3);
        assert_eq!(body.as_slice(), b"{\"a\":1}");
        let p = split(crate::HOUSEHOLD_MAGIC, &file).unwrap();
        let aad_len = p.aad.len();
        for i in 0..aad_len {
            let mut bad = file.clone();
            bad[i] ^= 0x01;
            assert!(
                open_household(&bad, &key).is_err(),
                "{i} バイト目の書き換えを検出できない"
            );
        }
        // 暗号文の最後のバイト（認証タグ）
        let mut bad = file.clone();
        *bad.last_mut().unwrap() ^= 0x80;
        assert_eq!(open_household(&bad, &key).unwrap_err(), StoreError::CORRUPT);
    }

    #[test]
    fn generation_rewrite_and_header_swap_are_detected() {
        let key = crypto::random_key();
        let file = seal_household(header(), &key, b"{}");
        let p = split(crate::HOUSEHOLD_MAGIC, &file).unwrap();
        let text = String::from_utf8(p.header.to_vec()).unwrap();
        // 世代番号を 3 → 9 に（同じ長さ）
        let forged_header = text.replace("\"generation\":3", "\"generation\":9");
        let mut forged = prefix(crate::HOUSEHOLD_MAGIC, forged_header.as_bytes());
        forged.extend_from_slice(p.ciphertext);
        assert_eq!(
            open_household(&forged, &key).unwrap_err(),
            StoreError::CORRUPT
        );
        // 別の世帯の見出しに差し替える（同じ鍵でも開かない）
        let other = seal_household(header(), &key, b"{}");
        let po = split(crate::HOUSEHOLD_MAGIC, &other).unwrap();
        let mut swapped = po.aad.to_vec();
        swapped.extend_from_slice(p.ciphertext);
        assert_eq!(
            open_household(&swapped, &key).unwrap_err(),
            StoreError::CORRUPT
        );
    }

    #[test]
    fn broken_files_are_rejected_without_panic() {
        assert!(read_household_header(b"").is_err());
        assert!(read_household_header(b"LPHF\x01\xff\xff\xff\xff").is_err());
        assert!(read_household_header(b"XXXX\x01\x00\x00\x00\x02{}").is_err());
    }
}
