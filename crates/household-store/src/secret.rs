//! OS の資格情報の保管庫（0013 の2）。事務所の親鍵だけを置く（項目は1つ: サービス名＝アプリの識別子、アカウント名＝事務所ID）。
//!
//! 差し替えられるようにしてある: アプリ本体は [`OsSecretStore`]（Mac はキーチェーン、Windows は資格情報マネージャー）、
//! テストと CI は [`MemorySecretStore`] を使い、保管庫に触れない。

use std::collections::HashMap;
use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::StoreError;

pub trait SecretStore: Send + Sync {
    /// 無ければ None
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, StoreError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreError>;
    /// 無くても成功
    fn delete(&self, account: &str) -> Result<(), StoreError>;
}

/// メモリの中だけの保管庫（テスト用）
#[derive(Default)]
pub struct MemorySecretStore(Mutex<HashMap<String, Zeroizing<String>>>);

impl SecretStore for MemorySecretStore {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, StoreError> {
        Ok(self
            .0
            .lock()
            .map_err(|_| StoreError::KEYCHAIN)?
            .get(account)
            .cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreError> {
        self.0
            .lock()
            .map_err(|_| StoreError::KEYCHAIN)?
            .insert(account.to_owned(), Zeroizing::new(secret.to_owned()));
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        self.0
            .lock()
            .map_err(|_| StoreError::KEYCHAIN)?
            .remove(account);
        Ok(())
    }
}

impl<T: SecretStore + ?Sized> SecretStore for std::sync::Arc<T> {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, StoreError> {
        (**self).get(account)
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreError> {
        (**self).set(account, secret)
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        (**self).delete(account)
    }
}

/// OS の資格情報の保管庫。サービス名は製品がアプリの識別子、開発用のビルドは `<識別子>.dev`（0013 の2:
/// 開発用のビルドは製品の鍵に触れない）。どちらにするかはアプリ本体が決める
#[cfg(feature = "os-keyring")]
pub struct OsSecretStore {
    service: String,
}

#[cfg(feature = "os-keyring")]
impl OsSecretStore {
    pub fn new(service: &str) -> Self {
        OsSecretStore {
            service: service.to_owned(),
        }
    }
    fn entry(&self, account: &str) -> Result<keyring::Entry, StoreError> {
        keyring::Entry::new(&self.service, account).map_err(|_| StoreError::KEYCHAIN)
    }
}

#[cfg(feature = "os-keyring")]
impl SecretStore for OsSecretStore {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, StoreError> {
        match self.entry(account)?.get_password() {
            Ok(s) => Ok(Some(Zeroizing::new(s))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(StoreError::KEYCHAIN),
        }
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreError> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|_| StoreError::KEYCHAIN)
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(StoreError::KEYCHAIN),
        }
    }
}

#[cfg(all(test, feature = "os-keyring"))]
mod os_tests {
    use super::*;

    /// 手元でだけ流す（CI では流さない）: テスト専用のサービス名で書いて読んで消す。
    /// `cargo test -p household-store --features os-keyring -- --ignored os_keyring_round_trip`
    #[test]
    #[ignore]
    fn os_keyring_round_trip() {
        let s = OsSecretStore::new("lifeplan.household-store.test");
        let account = crate::crypto::new_uuid();
        assert!(s.get(&account).unwrap().is_none());
        s.set(&account, "00ff").unwrap();
        assert_eq!(s.get(&account).unwrap().unwrap().as_str(), "00ff");
        s.delete(&account).unwrap();
        assert!(s.get(&account).unwrap().is_none());
        s.delete(&account).unwrap();
    }
}
