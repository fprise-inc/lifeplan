//! カスタム層の命令（0016 の3・4・6。2026-11-02 の追記）。中身は custom-layer（検査・指紋・台帳・保存庫・当て方）。
//!
//! - 今動くのは、説明の文の差し替え（カスタム層の `settings/texts.json`）だけ。読み書き・指紋・承認は本体だけが行い、
//!   画面は返した状態を出す・承認した文を文字として当てるだけ（画面はカスタム層のファイルを読まない）。
//! - 承認の台帳と承認した中身はデータフォルダの中の `custom/`（カスタム層の外）。台帳の改ざん検出の鍵は事務所の親鍵から導く（household-store）。
//! - カスタム層の場所は、既定（書類のフォルダの `lifeplan-custom/`）か、本体が出す OS のフォルダのダイアログで FP が選んだ場所。
//!   データフォルダ・鍵置き場・アプリのデータの場所・書き出しの既定のフォルダ・AIの受け口の作業フォルダと、互いに含む場所は選べない。
//!   画面からパスは受け取らない（場所の表示のために、ホームを `~` にした形だけ返す。FP が自分の AI にこのフォルダを開かせるため）。
//! - 説明の一覧（書き換えられる公式の文）は、画面のビルドの段が作った `app/src/generated/texts-catalog.json` を埋め込む。
//! - AI がカスタム層のファイルを書いても、FP がこの画面で承認するまで効かない（0015 の追記の2段目と同じ形。AI 接続口の道具は足していない）。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use custom_layer::{ledger, Catalog, Context, TextsStatus};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::ai::AiState;
use crate::export;
use crate::store::StoreState;

/// 説明の一覧（画面のビルドの段が作る。npm run prepare-assets）
const CATALOG_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/texts-catalog.json"));

fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    // 一覧の誤りはビルドの誤り（テストで止める）。読めないときは空の一覧（どの文も書き換えない）
    C.get_or_init(|| Catalog::parse(CATALOG_JSON).unwrap_or_default())
}

pub struct CustomState {
    /// 読み書きを1つずつにする（承認と状態の読み出しが混ざらないように）
    lock: Mutex<()>,
    /// 台帳と保存庫の置き場所（データフォルダの中の `custom/`）
    ledger_dir: PathBuf,
    default_dir: PathBuf,
    /// 今のカスタム層の場所（書き出しの出口・事務所の共有フォルダの選択で避ける場所に使う。読むたびに新しくする）
    current: Mutex<PathBuf>,
}

impl CustomState {
    /// 今のカスタム層の場所（最後に読んだもの）
    pub fn current_dir(&self) -> PathBuf {
        self.current
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| self.default_dir.clone())
    }
}

/// アプリの起動時に作る（まだファイルは読まない）
pub fn init<R: Runtime>(app: &AppHandle<R>) -> CustomState {
    let root = app.state::<StoreState>().root.clone();
    let default_dir = app
        .path()
        .document_dir()
        .map(|d| d.join(export::CUSTOM_DIR_NAME))
        .unwrap_or_else(|_| root.join("..").join(export::CUSTOM_DIR_NAME));
    CustomState {
        lock: Mutex::new(()),
        ledger_dir: root.join("custom"),
        current: Mutex::new(default_dir.clone()),
        default_dir,
    }
}

/// カスタム層と重なってはいけない場所
fn protected<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let p = app.path();
    let mut out: Vec<PathBuf> = [p.app_data_dir(), p.app_local_data_dir(), p.app_config_dir()]
        .into_iter()
        .flatten()
        .collect();
    out.push(app.state::<StoreState>().root.clone());
    if let Ok(docs) = p.document_dir() {
        out.push(docs.join(export::EXPORT_DIR_NAME));
    }
    if let Some(ai) = app.try_state::<AiState>() {
        out.push(ai.runtime_dir());
    }
    out
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 場所の表示（ホームのフォルダを `~` にする）
fn display_dir(dir: &Path, home: Option<&Path>) -> String {
    if let Some(rest) = home.and_then(|h| dir.strip_prefix(h).ok()) {
        let rest = rest.to_string_lossy().replace('\\', "/");
        return if rest.is_empty() {
            "~".into()
        } else {
            format!("~/{rest}")
        };
    }
    dir.to_string_lossy().into_owned()
}

/// 画面に返す状態（パスはホームを `~` にした表示だけ）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusView {
    #[serde(flatten)]
    status: TextsStatus,
    dir: String,
}

fn with_ctx<T>(
    app: &AppHandle,
    f: impl FnOnce(&Context<'_>) -> Result<T, &'static str>,
) -> Result<T, String> {
    let cs = app.state::<CustomState>();
    let _g = cs.lock.lock().map_err(|_| "E_HOST_LOCK".to_owned())?;
    let key = app
        .state::<StoreState>()
        .store
        .custom_ledger_key()
        .map_err(|e| e.code().to_owned())?;
    let ctx = Context {
        store: ledger::Store::new(&cs.ledger_dir),
        key: &key,
        catalog: catalog(),
        default_dir: cs.default_dir.clone(),
    };
    let out = f(&ctx).map_err(str::to_owned);
    if let Ok(mut cur) = cs.current.lock() {
        *cur = ctx.dir();
    }
    out
}

fn view(app: &AppHandle, ctx: &Context<'_>, status: TextsStatus) -> StatusView {
    let home = app.path().home_dir().ok();
    StatusView {
        status,
        dir: display_dir(&ctx.dir(), home.as_deref()),
    }
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, &Context<'_>) -> Result<TextsStatus, &'static str> + Send + 'static,
    wrap: impl FnOnce(StatusView) -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_ctx(&app, |ctx| f(&app, ctx).map(|st| view(&app, ctx, st))).map(wrap)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

/// 説明の文の設定の状態（承認の画面の材料）
#[tauri::command]
pub async fn custom_texts_status(app: AppHandle) -> Result<StatusView, String> {
    blocking(app, |_, c| Ok(c.status()), |v| v).await
}

/// 承認待ちの中身を承認する（fingerprint は画面に見せた状態の指紋。違えば E_CUSTOM_CHANGED）
#[tauri::command]
pub async fn custom_texts_approve(
    app: AppHandle,
    fingerprint: String,
) -> Result<StatusView, String> {
    blocking(app, move |_, c| c.approve(&fingerprint, now()), |v| v).await
}

/// 承認待ちの中身を承認しない（前に承認した文のまま）
#[tauri::command]
pub async fn custom_texts_decline(
    app: AppHandle,
    fingerprint: String,
) -> Result<StatusView, String> {
    blocking(app, move |_, c| c.decline(&fingerprint), |v| v).await
}

/// 事務所の文を全部やめて公式の文に戻す（カスタム層のファイルは消さない）
#[tauri::command]
pub async fn custom_texts_revert(app: AppHandle) -> Result<StatusView, String> {
    blocking(app, |_, c| c.revert(), |v| v).await
}

/// アプリの更新で公式の文が変わった行を確かめる（keep: このまま使う／false: その行を外して公式の文に戻す）。
/// アプリの画面での操作なので、直したファイルをそのまま承認する
#[tauri::command]
pub async fn custom_texts_rows(
    app: AppHandle,
    ids: Vec<String>,
    keep: bool,
) -> Result<StatusView, String> {
    blocking(
        app,
        move |_, c| {
            if keep {
                c.keep_rows(&ids, now())
            } else {
                c.drop_rows(&ids, now())
            }
        },
        |v| v,
    )
    .await
}

/// 確かめられなかった承認の台帳を作り直す（承認は無いまま）
#[tauri::command]
pub async fn custom_ledger_reset(app: AppHandle) -> Result<StatusView, String> {
    blocking(app, |_, c| c.reset_ledger(), |v| v).await
}

/// 開発のときだけ（debug のビルド）: ダイアログの代わりに使うカスタム層の場所（画面の確かめを自動で流すため）
fn dev_custom_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("FINANCIA_DEV_CUSTOM_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// カスタム層の場所を、OS のフォルダのダイアログで選ぶ。選ばなかったときは null
#[tauri::command]
pub async fn custom_dir_choose(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<StatusView>, String> {
    let picked = match dev_custom_dir() {
        Some(d) => Some(d),
        None => rfd::AsyncFileDialog::new()
            .set_title("カスタム層のフォルダを選ぶ")
            .set_parent(&window)
            .pick_folder()
            .await
            .map(|h| h.path().to_path_buf()),
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    blocking(
        app,
        move |a, c| c.set_dir(Some(&picked), &protected(a)),
        Some,
    )
    .await
}

/// カスタム層の場所を既定（書類のフォルダの lifeplan-custom）に戻す
#[tauri::command]
pub async fn custom_dir_reset(app: AppHandle) -> Result<StatusView, String> {
    blocking(app, |a, c| c.set_dir(None, &protected(a)), |v| v).await
}

/// カスタム層のフォルダと settings/ を作る（AI が書く場所を用意する。中身は書かない）
#[tauri::command]
pub async fn custom_dir_create(app: AppHandle) -> Result<StatusView, String> {
    blocking(app, |a, c| c.create_folder(&protected(a)), |v| v).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_is_readable() {
        // 埋め込んだ説明の一覧が読める（読めないと、どの文も書き換えられない）
        let c = Catalog::parse(CATALOG_JSON).expect("説明の一覧");
        assert!(c.len() > 100, "{}", c.len());
        // 消せない知らせに hide が付いていない（Catalog::parse も確かめる）
        for e in c.entries().filter(|e| e.kind == "notice") {
            let hideable = matches!(
                e.notice_kind.as_deref(),
                Some("outside" | "assumed" | "data")
            );
            assert_eq!(
                e.ops.contains(&custom_layer::Op::Hide),
                hideable,
                "{}",
                e.id
            );
        }
    }

    #[test]
    fn home_is_shown_as_tilde() {
        let home = Path::new("/Users/fp");
        assert_eq!(
            display_dir(Path::new("/Users/fp/Documents/lifeplan-custom"), Some(home)),
            "~/Documents/lifeplan-custom"
        );
        assert_eq!(
            display_dir(Path::new("/Volumes/x"), Some(home)),
            "/Volumes/x"
        );
    }
}
