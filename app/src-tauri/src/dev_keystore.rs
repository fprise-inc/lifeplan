//! 開発用のビルド（debug。`npx tauri dev`）だけの鍵の保管庫: OS の資格情報の保管庫の代わりに、ファイルへ平文で置く。
//!
//! - 作り直すたびに署名の無いバイナリが変わり、macOS がキーチェーンの確認（パスワードの入力）を毎回出すのを避けるため。
//! - 置き場所はアプリの開発用のデータフォルダの中の `dev-keystore/`。ファイル名と中身の先頭に「開発用・本物の顧客データに使わない」と書く。
//! - 事務所の親鍵・共有の事務所の親鍵の写し・メンバーの秘密鍵など、保管庫を使うすべての鍵が対象（household-store の [`SecretStore`]）。
//! - このファイル（モジュール）は `cfg(debug_assertions)` のときだけコンパイルする（lib.rs）。製品のビルドには入らず、選べない。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use household_store::{SecretStore, StoreError};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// データフォルダの中の、開発用の鍵の保管庫のフォルダ
pub const DIR: &str = "dev-keystore";
/// 鍵を置くファイル（名前に「開発用・本物の顧客データに使わない」を入れる）
pub const FILE: &str = "開発用_本物の顧客データに使わない.json";
/// ファイルの先頭に書く注意
pub const NOTICE: &str =
    "開発用・本物の顧客データに使わない。鍵を平文で置いています（開発用のビルドだけが読み書きします）。";

#[derive(Serialize, Deserialize, Default)]
struct KeyFile {
    /// 先頭に出る注意（JSON の並びの最初）
    #[serde(rename = "注意", default)]
    notice: String,
    #[serde(default)]
    entries: BTreeMap<String, String>,
}

pub struct DevFileSecretStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl DevFileSecretStore {
    /// `data_dir` はアプリの開発用のデータフォルダ（この中に `dev-keystore/` を作る）
    pub fn new(data_dir: &Path) -> DevFileSecretStore {
        DevFileSecretStore {
            path: data_dir.join(DIR).join(FILE),
            lock: Mutex::new(()),
        }
    }

    fn read(&self) -> Result<KeyFile, StoreError> {
        match std::fs::read(&self.path) {
            Ok(b) => serde_json::from_slice(&b).map_err(|_| StoreError::KEYCHAIN),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(KeyFile::default()),
            Err(_) => Err(StoreError::KEYCHAIN),
        }
    }

    fn write(&self, mut f: KeyFile) -> Result<(), StoreError> {
        f.notice = NOTICE.to_owned();
        let dir = self.path.parent().ok_or(StoreError::KEYCHAIN)?;
        std::fs::create_dir_all(dir).map_err(|_| StoreError::KEYCHAIN)?;
        let bytes =
            Zeroizing::new(serde_json::to_vec_pretty(&f).map_err(|_| StoreError::KEYCHAIN)?);
        let tmp = dir.join(format!(".{FILE}.tmp"));
        std::fs::write(&tmp, &*bytes).map_err(|_| StoreError::KEYCHAIN)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, &self.path).map_err(|_| StoreError::KEYCHAIN)
    }
}

impl SecretStore for DevFileSecretStore {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, StoreError> {
        let _g = self.lock.lock().map_err(|_| StoreError::KEYCHAIN)?;
        Ok(self.read()?.entries.remove(account).map(Zeroizing::new))
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), StoreError> {
        let _g = self.lock.lock().map_err(|_| StoreError::KEYCHAIN)?;
        let mut f = self.read()?;
        f.entries.insert(account.to_owned(), secret.to_owned());
        self.write(f)
    }
    fn delete(&self, account: &str) -> Result<(), StoreError> {
        let _g = self.lock.lock().map_err(|_| StoreError::KEYCHAIN)?;
        let mut f = self.read()?;
        if f.entries.remove(account).is_some() {
            self.write(f)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_with_the_notice_first() {
        let dir = std::env::temp_dir().join(format!("dev-keystore-test-{}", std::process::id()));
        let s = DevFileSecretStore::new(&dir);
        assert!(s.get("a").unwrap().is_none());
        s.set("a", "00ff").unwrap();
        s.set("b.member", "11ee").unwrap();
        assert_eq!(s.get("a").unwrap().unwrap().as_str(), "00ff");
        let text = std::fs::read_to_string(dir.join(DIR).join(FILE)).unwrap();
        assert!(
            text.trim_start()
                .starts_with("{\n  \"注意\": \"開発用・本物の顧客データに使わない"),
            "{text}"
        );
        assert!(FILE.contains("開発用") && FILE.contains("本物の顧客データに使わない"));
        s.delete("a").unwrap();
        s.delete("a").unwrap();
        assert!(s.get("a").unwrap().is_none());
        assert_eq!(s.get("b.member").unwrap().unwrap().as_str(), "11ee");
        // 開き直しても読める
        let s2 = DevFileSecretStore::new(&dir);
        assert_eq!(s2.get("b.member").unwrap().unwrap().as_str(), "11ee");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
