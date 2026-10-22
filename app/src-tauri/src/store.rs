//! 世帯ファイルの保存と暗号化の命令（0011・0013）。中身は household-store。
//!
//! - データフォルダは Tauri のアプリのデータの場所の中に固定する（製品は `data/`、開発用のビルドは `data-dev/`）。
//!   画面からは選べず、パスを画面に渡さない・受け取らない（0016 の1。ファイル・ダイアログのプラグインは入れない）。
//!   世帯は本体が振る内部ID（UUID）だけで指す。
//! - 事務所の親鍵は OS の資格情報の保管庫（Mac はキーチェーン、Windows は資格情報マネージャー）。サービス名はアプリの識別子。
//! - 開発用のビルド（debug）は、既定では OS の保管庫を使わず、データフォルダ（`data-dev-filekeys/`）の中の `dev-keystore/` に
//!   平文で置く（dev_keystore.rs。作り直すたびに OS の確認の窓が出るのを避ける）。環境変数 `FINANCIA_DEV_KEYCHAIN_SERVICE`
//!   （`<識別子>.〜`）を明示したときだけ、そのサービス名で OS の保管庫を使う（データフォルダは `data-dev/`。0013 の2: 製品の鍵に触れない）。
//!   製品のビルドは必ず OS の保管庫を使う（ファイルの実装はコンパイルされない）。
//! - 本文のうち、同意とAIの記録の区画（`consents`・`consentExplanations`・`aiShares`・`candidates`）は本体だけが書く（ai.rs）。
//!   開くときは画面に返す本文から外し、保存のときは画面から届いた本文に本体の帳面の中身を入れて書く。
//! - 復号は本体だけが行い、画面には本文（JSON）だけを返す。鍵は返さない。例外は復元キーで、FP が書き写すために表示する
//!   ときだけ返す（画面はどこにも保存しない。0016 の1 の「画面に保存しない」で守る）。

use std::sync::Arc;

use household_store::{
    CategoryEdit, CategorySettings, CreateOptions, CreateRequest, HouseholdEntry, Opened,
    OsSecretStore, RenameOutcome, SampleRequest, Saved, SecretStore, Status, Store, StoreError,
    SystemClock,
};
use tauri::{AppHandle, Manager, Runtime};

use crate::ai::AiState;

/// 鍵の保管庫の選び方
#[derive(Debug, Clone, PartialEq, Eq)]
enum Keystore {
    /// OS の資格情報の保管庫（サービス名）
    Os { service: String },
    /// 開発用のビルドだけ: データフォルダの中のファイル（dev_keystore.rs）
    DevFile,
}

/// 保管庫を選ぶ（製品のビルドは必ず OS の保管庫）。開発用のビルドは、`FINANCIA_DEV_KEYCHAIN_SERVICE` に
/// `<識別子>.〜` を明示したときだけ OS の保管庫（そのサービス名）、それ以外はファイル
fn choose_keystore(identifier: &str, debug: bool, dev_service: Option<&str>) -> Keystore {
    if !debug {
        return Keystore::Os {
            service: identifier.to_owned(),
        };
    }
    match dev_service {
        Some(s) if s.starts_with(identifier) && s.len() > identifier.len() => Keystore::Os {
            service: s.to_owned(),
        },
        _ => Keystore::DevFile,
    }
}

/// データフォルダの名前（アプリのデータの場所の中）。開発用のビルドでファイルの保管庫を使うときは、
/// OS の保管庫と組にしていた前の開発用のデータ（`data-dev/`）とは別にする（前のデータは消さずに残す）
fn data_dir_name(keystore: &Keystore, debug: bool) -> &'static str {
    match (debug, keystore) {
        (false, _) => "data",
        (true, Keystore::Os { .. }) => "data-dev",
        (true, Keystore::DevFile) => "data-dev-filekeys",
    }
}

pub struct StoreState {
    pub store: Store,
    /// 開発用: 鍵をファイルに置いている（画面に小さな札を出す）
    pub dev_file_keys: bool,
}

/// アプリの起動時に作る（まだファイルは読まない。最初の store_status で準備する）
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<StoreState, Box<dyn std::error::Error>> {
    let identifier = &app.config().identifier;
    let debug = cfg!(debug_assertions);
    let dev_service = if debug {
        std::env::var("FINANCIA_DEV_KEYCHAIN_SERVICE").ok()
    } else {
        None
    };
    let keystore = choose_keystore(identifier, debug, dev_service.as_deref());
    let mut root = app
        .path()
        .app_data_dir()?
        .join(data_dir_name(&keystore, debug));
    // 開発のときだけ（debug のビルド）: 試験用のデータフォルダに替える（手元で試して、終わったら消すため）
    if debug {
        if let Some(d) = std::env::var_os("FINANCIA_DEV_STORE_DIR").filter(|v| !v.is_empty()) {
            root = std::path::PathBuf::from(d);
        }
    }
    let secrets: Arc<dyn SecretStore> = match &keystore {
        Keystore::Os { service } => Arc::new(OsSecretStore::new(service)),
        #[cfg(debug_assertions)]
        Keystore::DevFile => Arc::new(crate::dev_keystore::DevFileSecretStore::new(&root)),
        #[cfg(not(debug_assertions))]
        Keystore::DevFile => {
            return Err("製品のビルドでは OS の資格情報の保管庫だけを使います".into())
        }
    };
    let version = app.package_info().version.to_string();
    Ok(StoreState {
        store: Store::new(root, secrets, SystemClock, &version).exclude_keys_from_os_backup(),
        dev_file_keys: keystore == Keystore::DevFile,
    })
}

/// 鍵の保管庫の種類（開発用のビルドでファイルに置いているときだけ true。画面の札のため。パスは返さない）
#[tauri::command]
pub fn store_keystore(state: tauri::State<'_, StoreState>) -> bool {
    state.dev_file_keys
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
        f(&state.store).map_err(code)
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
        f(&state.store, &ai)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

/// 顧客の世帯と見本の世帯の一覧から、その世帯の行
fn entry_of(s: &Store, id: &str) -> Option<HouseholdEntry> {
    let find = |l: Vec<HouseholdEntry>| l.into_iter().find(|e| e.id == id);
    s.list()
        .ok()
        .and_then(find)
        .or_else(|| s.list_samples().ok().and_then(find))
}

fn summary_of(s: &Store, id: &str) -> String {
    entry_of(s, id).map(|e| e.summary).unwrap_or_default()
}

/// 新しい世帯を作る（世帯の内部IDと世帯の鍵は本体が作る）。`category` は区分の記号（無ければ見込み客）、
/// `sample` があれば見本として作る（顧客番号を持たず、見本番号を振る。0033）
#[tauri::command]
pub async fn store_create(
    app: AppHandle,
    body: String,
    summary: String,
    category: Option<String>,
    sample: Option<SampleRequest>,
) -> Result<Opened, String> {
    with_ai(app, move |s, ai| {
        let o = s
            .create_with(
                CreateRequest {
                    body,
                    summary: summary.clone(),
                },
                CreateOptions { category, sample },
            )
            .map_err(code)?;
        ai.on_opened(o, summary)
    })
    .await
}

/// 見本の棚（FP が作った見本の世帯。0033）
#[tauri::command]
pub async fn store_list_samples(app: AppHandle) -> Result<Vec<HouseholdEntry>, String> {
    blocking(app, |s| s.list_samples()).await
}

/// 世帯の区分を変える（体系の番号は記号だけが変わる。0033）
#[tauri::command]
pub async fn store_set_category(
    app: AppHandle,
    id: String,
    category: String,
) -> Result<RenameOutcome, String> {
    blocking(app, move |s| s.set_category(&id, &category)).await
}

/// 自由な番号の世帯に、区分の記号＋新しい通し番号を付ける（一方向。0033）
#[tauri::command]
pub async fn store_assign_serial(app: AppHandle, id: String) -> Result<RenameOutcome, String> {
    blocking(app, move |s| s.assign_serial(&id)).await
}

/// 顧客の世帯を見本の棚へ移す（画面で「中身は架空です」を確かめた後。0033）
#[tauri::command]
pub async fn store_make_sample(
    app: AppHandle,
    id: String,
    sample: SampleRequest,
) -> Result<RenameOutcome, String> {
    blocking(app, move |s| s.make_sample(&id, &sample)).await
}

/// 見本の名前と絞り込みの項目を直す（0033）
#[tauri::command]
pub async fn store_update_sample(
    app: AppHandle,
    id: String,
    name: String,
    traits: Vec<String>,
) -> Result<(), String> {
    blocking(app, move |s| s.update_sample(&id, &name, &traits)).await
}

/// 区分の設定（区分の一覧と、区分を使うかを決めたか。0033）
#[tauri::command]
pub async fn store_categories(app: AppHandle) -> Result<CategorySettings, String> {
    blocking(app, |s| s.categories()).await
}

/// 区分の設定を変える（0033）。空の変更は「区分を使わない」
#[tauri::command]
pub async fn store_set_categories(
    app: AppHandle,
    edits: Vec<CategoryEdit>,
) -> Result<CategorySettings, String> {
    blocking(app, move |s| s.set_categories(&edits)).await
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
        let matches = entry_of(s, &id).is_some_and(|e| e.customer_no == confirm.trim());
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

/// 復元キーで開けるかを試す（世帯のデータは変えない。開けたら日時を記録する。共有の事務所では保管済みとみなす。0023 の5）
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

    use super::{choose_keystore, data_dir_name, Keystore};

    #[test]
    fn data_folder_is_fixed() {
        for k in [
            Keystore::DevFile,
            Keystore::Os {
                service: "x".into(),
            },
        ] {
            for debug in [false, true] {
                let n = data_dir_name(&k, debug);
                assert!(!n.contains('/') && !n.contains(".."));
            }
        }
        assert_eq!(data_dir_name(&Keystore::DevFile, false), "data");
    }

    /// 製品のビルドは、環境変数があっても必ず OS の保管庫（製品のサービス名）。開発用のビルドは明示したときだけ OS の保管庫
    #[test]
    fn release_always_uses_the_os_keystore() {
        let id = "com.example.app";
        for env in [None, Some(""), Some("com.example.app.dev"), Some("other")] {
            assert_eq!(
                choose_keystore(id, false, env),
                Keystore::Os { service: id.into() }
            );
        }
        assert_eq!(choose_keystore(id, true, None), Keystore::DevFile);
        assert_eq!(choose_keystore(id, true, Some(id)), Keystore::DevFile);
        assert_eq!(
            choose_keystore(id, true, Some("other.dev")),
            Keystore::DevFile
        );
        assert_eq!(
            choose_keystore(id, true, Some("com.example.app.dev")),
            Keystore::Os {
                service: "com.example.app.dev".into()
            }
        );
    }

    /// ファイルの保管庫の実装は、開発用のビルドのときだけコンパイルする
    #[test]
    fn dev_keystore_is_debug_only() {
        let lib = include_str!("lib.rs");
        let i = lib.find("mod dev_keystore;").unwrap();
        assert!(lib[..i].trim_end().ends_with("#[cfg(debug_assertions)]"));
    }
}
