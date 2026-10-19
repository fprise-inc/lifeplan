//! 世帯ファイルの保存と暗号化の命令（0011・0013）。中身は household-store。
//!
//! - データフォルダは Tauri のアプリのデータの場所の中に固定する（製品は `data/`、開発用のビルドは `data-dev/`）。
//!   画面からは選べず、パスを画面に渡さない・受け取らない（0016 の1。ファイル・ダイアログのプラグインは入れない）。
//!   世帯は本体が振る内部ID（UUID）だけで指す。
//! - 事務所の親鍵は OS の資格情報の保管庫（Mac はキーチェーン、Windows は資格情報マネージャー）。サービス名はアプリの識別子で、
//!   開発用のビルドは `<識別子>.dev`（0013 の2: 製品の鍵に触れない）。
//! - 本文のうち、同意とAIの記録の区画（`consents`・`consentExplanations`・`aiShares`・`candidates`）は本体だけが書く（ai.rs）。
//!   開くときは画面に返す本文から外し、保存のときは画面から届いた本文に本体の帳面の中身を入れて書く。
//! - 復号は本体だけが行い、画面には本文（JSON）だけを返す。鍵は返さない。例外は復元キーで、FP が書き写すために表示する
//!   ときだけ返す（画面はどこにも保存しない。0016 の1 の「画面に保存しない」で守る）。

use household_store::{
    CreateRequest, HouseholdEntry, Opened, OsSecretStore, RenameOutcome, Saved, Status, Store,
    StoreError, SystemClock,
};
use tauri::{AppHandle, Manager, Runtime};

use crate::ai::AiState;

/// データフォルダの名前（アプリのデータの場所の中）
fn data_dir_name() -> &'static str {
    if cfg!(debug_assertions) {
        "data-dev"
    } else {
        "data"
    }
}

pub struct StoreState(pub Store);

/// アプリの起動時に作る（まだファイルは読まない。最初の store_status で準備する）
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<StoreState, Box<dyn std::error::Error>> {
    let mut root = app.path().app_data_dir()?.join(data_dir_name());
    let identifier = &app.config().identifier;
    let mut service = if cfg!(debug_assertions) {
        format!("{identifier}.dev")
    } else {
        identifier.clone()
    };
    // 開発のときだけ（debug のビルド）: 試験用のデータフォルダと保管庫のサービス名に替える（手元で試して、終わったら消すため）
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("FINANCIA_DEV_STORE_DIR").filter(|v| !v.is_empty()) {
            root = std::path::PathBuf::from(d);
        }
        if let Ok(s) = std::env::var("FINANCIA_DEV_KEYCHAIN_SERVICE") {
            if s.starts_with(identifier.as_str()) && s.len() > identifier.len() {
                service = s;
            }
        }
    }
    let version = app.package_info().version.to_string();
    Ok(StoreState(
        Store::new(root, OsSecretStore::new(&service), SystemClock, &version)
            .exclude_keys_from_os_backup(),
    ))
}

fn code(e: StoreError) -> String {
    e.code().to_owned()
}

/// 保存の処理は画面の動きを止めないよう、別のスレッドで行う
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Store) -> Result<T, StoreError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StoreState>();
        f(&state.0).map_err(code)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

#[tauri::command]
pub async fn store_status(app: AppHandle) -> Result<Status, String> {
    blocking(app, |s| s.status()).await
}

#[tauri::command]
pub async fn store_list(app: AppHandle) -> Result<Vec<HouseholdEntry>, String> {
    blocking(app, |s| s.list()).await
}

/// 同意とAIの記録の帳面（ai.rs）と一緒に、保存の処理を別のスレッドで行う
async fn with_ai<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Store, &AiState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StoreState>();
        let ai = app.state::<AiState>();
        f(&state.0, &ai)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

fn summary_of(s: &Store, id: &str) -> String {
    s.list()
        .ok()
        .and_then(|l| l.into_iter().find(|e| e.id == id).map(|e| e.summary))
        .unwrap_or_default()
}

/// 新しい世帯を作る（世帯の内部IDと世帯の鍵は本体が作る）
#[tauri::command]
pub async fn store_create(app: AppHandle, body: String, summary: String) -> Result<Opened, String> {
    with_ai(app, move |s, ai| {
        let o = s
            .create(CreateRequest {
                body,
                summary: summary.clone(),
            })
            .map_err(code)?;
        ai.on_opened(o, summary)
    })
    .await
}

#[tauri::command]
pub async fn store_open(app: AppHandle, id: String) -> Result<Opened, String> {
    with_ai(app, move |s, ai| {
        let o = s.open(&id).map_err(code)?;
        let summary = summary_of(s, &id);
        ai.on_opened(o, summary)
    })
    .await
}

#[tauri::command]
pub async fn store_save(
    app: AppHandle,
    id: String,
    body: String,
    summary: String,
) -> Result<Saved, String> {
    with_ai(app, move |s, ai| ai.save(s, &id, &body, &summary)).await
}

/// 表示用の顧客番号を変える
#[tauri::command]
pub async fn store_rename(
    app: AppHandle,
    id: String,
    customer_no: String,
) -> Result<RenameOutcome, String> {
    blocking(app, move |s| s.rename(&id, &customer_no)).await
}

/// 完全削除（confirm は FP が打った顧客番号）
#[tauri::command]
pub async fn store_delete(app: AppHandle, id: String, confirm: String) -> Result<(), String> {
    with_ai(app, move |s, ai| {
        // 確認の顧客番号が合うときだけ、共有を取り消して帳面を捨てる
        let matches = s
            .list()
            .ok()
            .and_then(|l| l.into_iter().find(|e| e.id == id))
            .is_some_and(|e| e.customer_no == confirm.trim());
        if matches {
            ai.on_deleting(&id);
        }
        s.delete(&id, &confirm).map_err(code)
    })
    .await
}

/// 復元キー（72文字）を表示のために返す
#[tauri::command]
pub async fn recovery_key_show(app: AppHandle) -> Result<String, String> {
    blocking(app, |s| s.recovery_key().map(|k| k.to_string())).await
}

#[tauri::command]
pub async fn recovery_key_acknowledge(app: AppHandle) -> Result<Status, String> {
    blocking(app, |s| s.acknowledge_recovery()).await
}

/// 復元キーで開けるかを試す（データは変えない）
#[tauri::command]
pub async fn recovery_key_test(app: AppHandle, key: String) -> Result<Status, String> {
    blocking(app, move |s| s.test_recovery_key(&key)).await
}

/// 保管庫に親鍵が無いとき: 復元キーで入れ直す
#[tauri::command]
pub async fn recovery_key_restore(app: AppHandle, key: String) -> Result<Status, String> {
    blocking(app, move |s| s.restore_with_recovery_key(&key)).await
}

#[cfg(test)]
mod tests {
    /// 0016 の1: 画面から呼べる保存の命令は、パス・フォルダ・ファイル名を引数に取らない（世帯は内部IDだけで指す）
    #[test]
    fn commands_take_no_paths() {
        let needle = concat!("#[tauri::", "command]");
        let mut count = 0;
        for text in [
            include_str!("store.rs"),
            include_str!("lib.rs"),
            include_str!("ai.rs"),
            include_str!("office.rs"),
        ] {
            let mut rest = text;
            while let Some(i) = rest.find(needle) {
                count += 1;
                rest = &rest[i + needle.len()..];
                let sig_end = rest.find('{').unwrap();
                let sig = &rest[..sig_end];
                let lower = sig.to_lowercase();
                for bad in ["path", "dir:", "folder", "file_name", "filename", "pathbuf"] {
                    assert!(
                        !lower.contains(bad),
                        "命令の引数にパスらしいものがある: {sig}"
                    );
                }
            }
        }
        assert!(count >= 40, "命令を見つけられていない（{count}）");
    }

    #[test]
    fn data_folder_is_fixed() {
        assert!(!super::data_dir_name().contains('/'));
        assert!(!super::data_dir_name().contains(".."));
    }
}
