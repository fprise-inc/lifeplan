//! 「アプリ本体がどこで待っているか」と「起動ごとの合言葉」を書いた小さなファイル（`app.json`。0015 の4）。
//! アプリ本体が起動時に作り、終了時に消す。そのOSユーザー専用の作業フォルダの中に 0600 で置く。

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};

pub const DISCOVERY_FILE: &str = "app.json";

/// 作業フォルダを差し替える環境変数（開発とテストのためだけ。製品の案内には書かない）
pub const RUNTIME_DIR_ENV: &str = "LIFEPLAN_RUNTIME_DIR";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    /// 取り決めの版
    pub ipc_version: u32,
    /// Unix: ソケットのパス / Windows: パイプの名前（`\\.\pipe\...`）
    pub endpoint: String,
    /// 起動ごとに作り直す合言葉（32バイトの乱数の16進）
    pub token: String,
    pub pid: u32,
    pub app_version: String,
}

/// そのOSユーザー専用の作業フォルダ（0015 の4）
///
/// - Mac: `~/Library/Application Support/<識別子>/run/`
/// - Windows: `%LOCALAPPDATA%\<識別子>\run\`
/// - Linux（開発と CI）: `$XDG_RUNTIME_DIR/<識別子>/`、無ければ `~/.local/state/<識別子>/run/`
pub fn runtime_dir() -> PathBuf {
    if let Some(d) = std::env::var_os(RUNTIME_DIR_ENV) {
        return PathBuf::from(d);
    }
    default_runtime_dir()
}

#[cfg(target_os = "macos")]
fn default_runtime_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join("Library/Application Support")
        .join(crate::IDENTIFIER)
        .join("run")
}

#[cfg(windows)]
fn default_runtime_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default();
    base.join(crate::IDENTIFIER).join("run")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn default_runtime_dir() -> PathBuf {
    if let Some(x) = std::env::var_os("XDG_RUNTIME_DIR") {
        return PathBuf::from(x).join(crate::IDENTIFIER);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".local/state")
        .join(crate::IDENTIFIER)
        .join("run")
}

impl Discovery {
    pub fn path(dir: &Path) -> PathBuf {
        dir.join(DISCOVERY_FILE)
    }

    /// 接続口の側: 読むだけ。無ければ「アプリが起動していない」。
    /// Unix では、作業フォルダと `app.json` の持ち主が自分で、ほかの人が読み書きできないことも確かめる
    /// （別の OS ユーザーが置いた偽の `app.json` に合言葉を送らないように）
    pub fn read(dir: &Path) -> io::Result<Discovery> {
        let path = Self::path(dir);
        check_private(dir, true)?;
        check_private(&path, false)?;
        let s = std::fs::read_to_string(path)?;
        serde_json::from_str(&s).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    /// アプリ本体の側: 一時ファイルに 0600 で書いてから置き換える（途中の状態を読まれないように）
    pub fn write(&self, dir: &Path) -> io::Result<()> {
        let tmp = dir.join(format!(".{DISCOVERY_FILE}.tmp"));
        let body = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        write_private_file(&tmp, &body)?;
        std::fs::rename(&tmp, Self::path(dir))
    }

    /// アプリ本体の側: 終了時に消す（自分が書いたもの（合言葉が同じもの）だけ）
    pub fn remove_if_mine(&self, dir: &Path) {
        let path = Self::path(dir);
        if let Ok(s) = std::fs::read_to_string(&path) {
            if let Ok(d) = serde_json::from_str::<Discovery>(&s) {
                if crate::constant_time_eq(d.token.as_bytes(), self.token.as_bytes()) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
}

/// 本人だけが読み書きできるファイルを作る（Unix は 0600。Windows は %LOCALAPPDATA% の下で、既定で本人・管理者・SYSTEM だけ）
pub fn write_private_file(path: &Path, body: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let _ = std::fs::remove_file(path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(body)?;
    f.sync_all()
}

/// アプリ本体の側: 作業フォルダを本人専用（0700）で用意し、持ち主を確かめる
pub fn prepare_private_dir(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let meta = std::fs::symlink_metadata(dir)?;
        if meta.file_type().is_symlink() {
            return Err(io::Error::other(
                "作業フォルダがシンボリックリンクになっています",
            ));
        }
        // SAFETY: geteuid は引数を取らず、失敗しない
        let my_uid = unsafe { libc::geteuid() };
        if meta.uid() != my_uid {
            return Err(io::Error::other("作業フォルダの持ち主が自分ではありません"));
        }
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// 持ち主が自分で、グループ・ほかの人の権限が無いこと（Unix）。Windows は %LOCALAPPDATA% の既定の権限に任せる
#[cfg(unix)]
fn check_private(path: &Path, is_dir: bool) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let meta = std::fs::symlink_metadata(path)?;
    // SAFETY: geteuid は引数を取らず、失敗しない
    let my_uid = unsafe { libc::geteuid() };
    let ok_kind = if is_dir {
        meta.file_type().is_dir()
    } else {
        meta.file_type().is_file()
    };
    if !ok_kind || meta.uid() != my_uid || meta.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "作業フォルダか app.json の持ち主・権限が正しくありません",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn check_private(path: &Path, _is_dir: bool) -> io::Result<()> {
    std::fs::symlink_metadata(path).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ai-ipc-{name}-{}", crate::random_hex(4)));
        prepare_private_dir(&d).unwrap();
        d
    }

    #[test]
    fn write_read_remove() {
        let dir = temp_dir("disc");
        let d = Discovery {
            ipc_version: 1,
            endpoint: "x".into(),
            token: crate::random_hex(32),
            pid: 1,
            app_version: "0.1.0".into(),
        };
        d.write(&dir).unwrap();
        assert_eq!(Discovery::read(&dir).unwrap(), d);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let f = std::fs::metadata(Discovery::path(&dir)).unwrap();
            assert_eq!(f.permissions().mode() & 0o777, 0o600);
            let m = std::fs::metadata(&dir).unwrap();
            assert_eq!(m.permissions().mode() & 0o777, 0o700);
        }
        // 合言葉の違う app.json は消さない
        let other = Discovery {
            token: "other".into(),
            ..d.clone()
        };
        other.remove_if_mine(&dir);
        assert!(Discovery::path(&dir).exists());
        d.remove_if_mine(&dir);
        assert!(!Discovery::path(&dir).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_files_others_can_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perm");
        let d = Discovery {
            ipc_version: 1,
            endpoint: "x".into(),
            token: "t".into(),
            pid: 1,
            app_version: "0.1.0".into(),
        };
        d.write(&dir).unwrap();
        std::fs::set_permissions(
            Discovery::path(&dir),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert!(Discovery::read(&dir).is_err());
        std::fs::set_permissions(
            Discovery::path(&dir),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(Discovery::read(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
