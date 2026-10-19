//! 鍵置き場（0013 の2。事務所データの一部。0011 の6）。
//!
//! - 中身: 形式の版・事務所ID・親鍵の鍵ID・世帯の内部ID → { 世帯の鍵の鍵ID, 包んだ世帯の鍵 }。
//! - ファイル全体を、親鍵から導いた鍵（`lifeplan/key-vault/v1`）で暗号化する。世帯の数や世帯IDも外から見えない。
//! - 中の世帯の鍵は、別の導いた鍵（`lifeplan/household-key-wrap/v1`）で、「世帯の鍵であること＋世帯の内部ID＋鍵ID」を
//!   改ざん検出の対象に入れて包む。別の世帯の欄と入れ替えても開かない。
//! - 見出しの確かめ値（KCV）で、違う親鍵で開こうとしたことを、壊れ・改ざんと区別して伝える。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::container;
use crate::crypto::{self, purpose, Key, KEY_LEN, NONCE_LEN};
use crate::StoreError;

pub const VAULT_MAGIC: &[u8; 4] = b"LPKV";
pub const VAULT_FORMAT: &str = "lifeplan.keyVault";
pub const VAULT_FORMAT_VERSION: &str = "0.1";

/// 鍵置き場の見出し（平文。欄は名前の順）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultHeader {
    cipher: String,
    format: String,
    format_version: String,
    /// 確かめ値（親鍵から導いた値の先頭8バイト）
    kcv: String,
    master_key_id: String,
    nonce: String,
    office_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WrappedKey {
    key_id: String,
    nonce: String,
    wrapped: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultBody {
    format_version: String,
    office_id: String,
    master_key_id: String,
    households: BTreeMap<String, WrappedKey>,
}

/// 開いた鍵置き場（世帯の鍵は包んだまま持ち、使うときだけ外す）
#[derive(Clone)]
pub struct Vault {
    pub office_id: String,
    pub master_key_id: String,
    households: BTreeMap<String, WrappedKey>,
}

fn kcv(master: &[u8; KEY_LEN]) -> String {
    crypto::hex_encode(&crypto::derive(master, purpose::KEY_CHECK)[..8])
}

fn wrap_aad(household_id: &str, key_id: &str) -> Vec<u8> {
    format!("lifeplan.householdKey\0{household_id}\0{key_id}").into_bytes()
}

impl Vault {
    pub fn new(office_id: &str, master_key_id: &str) -> Vault {
        Vault {
            office_id: office_id.to_owned(),
            master_key_id: master_key_id.to_owned(),
            households: BTreeMap::new(),
        }
    }

    pub fn contains(&self, household_id: &str) -> bool {
        self.households.contains_key(household_id)
    }

    pub fn household_ids(&self) -> impl Iterator<Item = &String> {
        self.households.keys()
    }

    /// 世帯の鍵を新しく作って入れる。（鍵ID, 鍵）
    pub fn insert_new(&mut self, master: &[u8; KEY_LEN], household_id: &str) -> (String, Key) {
        let key = crypto::random_key();
        let key_id = crypto::new_uuid();
        let nonce = crypto::random_nonce();
        let wk = crypto::derive(master, purpose::HOUSEHOLD_KEY_WRAP);
        let wrapped = crypto::seal(&wk, &nonce, &wrap_aad(household_id, &key_id), key.as_ref());
        self.households.insert(
            household_id.to_owned(),
            WrappedKey {
                key_id: key_id.clone(),
                nonce: crypto::hex_encode(&nonce),
                wrapped: crypto::hex_encode(&wrapped),
            },
        );
        (key_id, key)
    }

    /// 世帯の鍵を外す。（鍵ID, 鍵）。無ければ [`StoreError::NO_KEY`]
    pub fn unwrap_key(
        &self,
        master: &[u8; KEY_LEN],
        household_id: &str,
    ) -> Result<(String, Key), StoreError> {
        let w = self
            .households
            .get(household_id)
            .ok_or(StoreError::NO_KEY)?;
        let nonce: [u8; NONCE_LEN] = crypto::hex_array(&w.nonce).ok_or(StoreError::CORRUPT)?;
        let wrapped = crypto::hex_decode(&w.wrapped).ok_or(StoreError::CORRUPT)?;
        let wk = crypto::derive(master, purpose::HOUSEHOLD_KEY_WRAP);
        let raw = crypto::open(&wk, &nonce, &wrap_aad(household_id, &w.key_id), &wrapped)?;
        if raw.len() != KEY_LEN {
            return Err(StoreError::CORRUPT);
        }
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&raw);
        Ok((w.key_id.clone(), key))
    }

    /// 親鍵を入れ替えた鍵置き場（世帯の鍵はそのまま、包みだけを新しい親鍵で作り直す。親鍵の鍵IDも新しくする。0024）
    pub fn rekeyed(
        &self,
        old: &[u8; KEY_LEN],
        new: &[u8; KEY_LEN],
        master_key_id: &str,
    ) -> Result<Vault, StoreError> {
        let wk = crypto::derive(new, purpose::HOUSEHOLD_KEY_WRAP);
        let mut households = BTreeMap::new();
        for id in self.households.keys() {
            let (key_id, key) = self.unwrap_key(old, id)?;
            let nonce = crypto::random_nonce();
            let wrapped = crypto::seal(&wk, &nonce, &wrap_aad(id, &key_id), key.as_ref());
            households.insert(
                id.clone(),
                WrappedKey {
                    key_id,
                    nonce: crypto::hex_encode(&nonce),
                    wrapped: crypto::hex_encode(&wrapped),
                },
            );
        }
        Ok(Vault {
            office_id: self.office_id.clone(),
            master_key_id: master_key_id.to_owned(),
            households,
        })
    }

    pub fn remove(&mut self, household_id: &str) -> bool {
        self.households.remove(household_id).is_some()
    }

    /// ファイルのバイト列にする（親鍵から導いた鍵で暗号化）
    pub fn encode(&self, master: &[u8; KEY_LEN]) -> Vec<u8> {
        let body = Zeroizing::new(
            serde_json::to_vec(&VaultBody {
                format_version: VAULT_FORMAT_VERSION.to_owned(),
                office_id: self.office_id.clone(),
                master_key_id: self.master_key_id.clone(),
                households: self.households.clone(),
            })
            .expect("鍵置き場の JSON"),
        );
        let nonce = crypto::random_nonce();
        let header = VaultHeader {
            cipher: crypto::CIPHER.to_owned(),
            format: VAULT_FORMAT.to_owned(),
            format_version: VAULT_FORMAT_VERSION.to_owned(),
            kcv: kcv(master),
            master_key_id: self.master_key_id.clone(),
            nonce: crypto::hex_encode(&nonce),
            office_id: self.office_id.clone(),
        };
        let vk = crypto::derive(master, purpose::KEY_VAULT);
        container::seal(
            VAULT_MAGIC,
            &container::header_json(&header),
            &vk,
            &nonce,
            &body,
        )
    }

    /// ファイルを開く。違う親鍵なら [`StoreError::WRONG_MASTER`]、壊れ・改ざんなら [`StoreError::CORRUPT`]
    pub fn decode(bytes: &[u8], master: &[u8; KEY_LEN]) -> Result<Vault, StoreError> {
        let p = container::split(VAULT_MAGIC, bytes)?;
        let h: VaultHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
        if h.format != VAULT_FORMAT || h.cipher != crypto::CIPHER {
            return Err(StoreError::CORRUPT);
        }
        if h.kcv != kcv(master) {
            return Err(StoreError::WRONG_MASTER);
        }
        let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
        let vk = crypto::derive(master, purpose::KEY_VAULT);
        let body = crypto::open(&vk, &nonce, p.aad, p.ciphertext)?;
        let b: VaultBody = serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)?;
        if b.office_id != h.office_id || b.master_key_id != h.master_key_id {
            return Err(StoreError::CORRUPT);
        }
        Ok(Vault {
            office_id: b.office_id,
            master_key_id: b.master_key_id,
            households: b.households,
        })
    }

    /// 見出しの事務所IDだけを読む（暗号は外さない）
    pub fn peek_office_id(bytes: &[u8]) -> Result<String, StoreError> {
        let p = container::split(VAULT_MAGIC, bytes)?;
        let h: VaultHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
        Ok(h.office_id)
    }

    /// 2つの世帯の包んだ鍵を入れ替える（テスト用: 入れ替えても開かないことを確かめる）
    #[cfg(test)]
    fn swap_for_test(&mut self, a: &str, b: &str) {
        let wa = self.households.get(a).cloned().unwrap();
        let wb = self.households.get(b).cloned().unwrap();
        self.households.insert(a.to_owned(), wb);
        self.households.insert(b.to_owned(), wa);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rekeyed_vault_opens_only_with_the_new_master() {
        let (m1, m2) = (crypto::random_key(), crypto::random_key());
        let mut v = Vault::new(&crypto::new_uuid(), &crypto::new_uuid());
        let h = crypto::new_uuid();
        let (kid, k) = v.insert_new(&m1, &h);
        let r = v.rekeyed(&m1, &m2, &crypto::new_uuid()).unwrap();
        let bytes = r.encode(&m2);
        assert_eq!(
            Vault::decode(&bytes, &m1).err(),
            Some(StoreError::WRONG_MASTER)
        );
        let back = Vault::decode(&bytes, &m2).unwrap();
        let (kid2, k2) = back.unwrap_key(&m2, &h).unwrap();
        assert_eq!((kid, *k), (kid2, *k2));
        assert!(back.unwrap_key(&m1, &h).is_err());
        assert_ne!(back.master_key_id, v.master_key_id);
    }

    #[test]
    fn round_trip_and_wrong_master() {
        let m = crypto::random_key();
        let mut v = Vault::new(&crypto::new_uuid(), &crypto::new_uuid());
        let h = crypto::new_uuid();
        let (kid, k) = v.insert_new(&m, &h);
        let bytes = v.encode(&m);
        let v2 = Vault::decode(&bytes, &m).unwrap();
        let (kid2, k2) = v2.unwrap_key(&m, &h).unwrap();
        assert_eq!(kid, kid2);
        assert_eq!(*k, *k2);
        let other = crypto::random_key();
        assert_eq!(
            Vault::decode(&bytes, &other).err(),
            Some(StoreError::WRONG_MASTER)
        );
        let mut bad = bytes.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(Vault::decode(&bad, &m).err(), Some(StoreError::CORRUPT));
        assert_eq!(
            v2.unwrap_key(&m, &crypto::new_uuid()).err(),
            Some(StoreError::NO_KEY)
        );
    }

    #[test]
    fn swapped_entries_do_not_open() {
        let m = crypto::random_key();
        let mut v = Vault::new(&crypto::new_uuid(), &crypto::new_uuid());
        let a = crypto::new_uuid();
        let b = crypto::new_uuid();
        v.insert_new(&m, &a);
        v.insert_new(&m, &b);
        v.swap_for_test(&a, &b);
        assert_eq!(v.unwrap_key(&m, &a).err(), Some(StoreError::CORRUPT));
        assert_eq!(v.unwrap_key(&m, &b).err(), Some(StoreError::CORRUPT));
    }

    #[test]
    fn no_raw_key_in_the_file() {
        let m = crypto::random_key();
        let mut v = Vault::new(&crypto::new_uuid(), &crypto::new_uuid());
        let h = crypto::new_uuid();
        let (_, k) = v.insert_new(&m, &h);
        let bytes = v.encode(&m);
        let hex = crypto::hex_encode(k.as_ref());
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(&hex));
        assert!(!text.contains(&h), "世帯IDも外から見えない");
        assert!(bytes.windows(KEY_LEN).all(|w| w != k.as_ref()));
    }
}
