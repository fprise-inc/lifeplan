//! 事務所での共有の命令（0023）。中身は household-store（名簿・世帯の鍵の札・世帯の札・開いている印）。
//!
//! - 共有フォルダは、本体が OS のフォルダのダイアログを出して選ばせる（`rfd`。画面にはダイアログの権限を与えない）。
//!   画面からパスを受け取らず、画面にパスを返さない（0016 の1・0023 の8）。
//! - 選べない場所: データフォルダ（アプリのデータ・設定の場所）、カスタム層の既定の場所、AIの受け口の作業フォルダと、
//!   それらを含む場所・それらの中（household-store が確かめる）。
//! - 承認は、承認する人が新しいメンバーから別の経路で聞いた指紋の入力が必須（画面に申請の指紋は返さない。0023 の3）。
//! - 開いている印は、裏で定期的に新しくし、アプリを閉じるときに消す（lib.rs）。

use std::path::PathBuf;

use household_store::{ForkChoice, ForkInfo, OfficeStatus, Opened, Store, StoreError};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::ai::AiState;
use crate::export;
use crate::store::StoreState;

fn code(e: StoreError) -> String {
    e.code().to_owned()
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Store, &AiState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<StoreState>();
        let ai = app.state::<AiState>();
        f(&store.0, &ai)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

/// 共有フォルダに選ばせない場所（データフォルダ・カスタム層の既定の場所・AIの受け口の作業フォルダ）
fn forbidden<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = export::forbidden_of(app).roots;
    if let Some(ai) = app.try_state::<AiState>() {
        roots.push(ai.runtime_dir());
    }
    roots
}

/// 開発のときだけ（debug のビルド）: ダイアログの代わりに使う共有フォルダ（画面の確かめを自動で流すため）
fn dev_office_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("FINANCIA_DEV_OFFICE_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// OS のフォルダのダイアログで共有フォルダを選ばせる。選ばなかったら None
async fn pick<R: Runtime>(window: &WebviewWindow<R>, title: &str) -> Option<PathBuf> {
    if let Some(d) = dev_office_dir() {
        return Some(d);
    }
    rfd::AsyncFileDialog::new()
        .set_title(title)
        .set_parent(window)
        .pick_folder()
        .await
        .map(|h| h.path().to_path_buf())
}

#[tauri::command]
pub async fn office_status(app: AppHandle) -> Result<OfficeStatus, String> {
    blocking(app, |s, _| s.office_status().map_err(code)).await
}

/// 事務所の共有を始める（最初の1人）。選ばなかったときは null
#[tauri::command]
pub async fn office_start(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
) -> Result<Option<OfficeStatus>, String> {
    let Some(picked) = pick(&window, "事務所で共有するフォルダを選ぶ").await else {
        return Ok(None);
    };
    let roots = forbidden(&app);
    let sync = export::is_sync_folder(&picked);
    blocking(app, move |s, ai| {
        let st = s.office_start(&picked, &name, sync, &roots).map_err(code)?;
        // 世帯を共有フォルダへ移したので、開いていた世帯の帳面は作り直す
        for e in s.list().unwrap_or_default() {
            ai.forget(&e.id);
        }
        Ok(Some(st))
    })
    .await
}

/// 事務所の共有に参加する（参加の申請を置く）。選ばなかったときは null
#[tauri::command]
pub async fn office_join(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
) -> Result<Option<OfficeStatus>, String> {
    let Some(picked) = pick(&window, "事務所の共有フォルダを選ぶ").await else {
        return Ok(None);
    };
    let roots = forbidden(&app);
    let sync = export::is_sync_folder(&picked);
    blocking(app, move |s, _| {
        s.office_join(&picked, &name, sync, &roots)
            .map(Some)
            .map_err(code)
    })
    .await
}

/// 参加の申請を取り下げる・外された設定を片付ける
#[tauri::command]
pub async fn office_cancel(app: AppHandle) -> Result<OfficeStatus, String> {
    blocking(app, |s, _| s.office_leave_setting().map_err(code)).await
}

/// 参加の申請を承認する（fingerprint は、新しいメンバーから別の経路で聞いて入力した指紋）
#[tauri::command]
pub async fn office_approve(
    app: AppHandle,
    request: String,
    fingerprint: String,
) -> Result<OfficeStatus, String> {
    blocking(app, move |s, _| {
        s.office_approve(&request, &fingerprint).map_err(code)
    })
    .await
}

#[tauri::command]
pub async fn office_reject(app: AppHandle, request: String) -> Result<OfficeStatus, String> {
    blocking(app, move |s, _| s.office_reject(&request).map_err(code)).await
}

/// メンバーを外す（親鍵と世帯の鍵の入れ替え。confirm は外す人の表示名）
#[tauri::command]
pub async fn office_remove(
    app: AppHandle,
    member: String,
    confirm: String,
) -> Result<OfficeStatus, String> {
    blocking(app, move |s, _| {
        s.office_remove(&member, &confirm).map_err(code)
    })
    .await
}

/// このPCの中の世帯を共有フォルダへ移す（移した数）
#[tauri::command]
pub async fn office_move_local(app: AppHandle) -> Result<usize, String> {
    blocking(app, |s, ai| {
        let n = s.office_move_local().map_err(code)?;
        for e in s.list().unwrap_or_default() {
            ai.forget(&e.id);
        }
        Ok(n)
    })
    .await
}

/// 分岐を選ぶ画面の材料
#[tauri::command]
pub async fn store_fork_info(app: AppHandle, id: String) -> Result<ForkInfo, String> {
    blocking(app, move |s, _| s.fork_info(&id).map_err(code)).await
}

/// 分岐を選ぶ（keep_ours: こちらの内容で上書きする／false: 相手の内容を残す）。開き直した世帯を返す
#[tauri::command]
pub async fn store_fork_resolve(
    app: AppHandle,
    id: String,
    keep_ours: bool,
) -> Result<Opened, String> {
    blocking(app, move |s, ai| {
        let choice = if keep_ours {
            ForkChoice::Ours
        } else {
            ForkChoice::Theirs
        };
        let o = s.resolve_fork(&id, choice).map_err(code)?;
        // 同意とAIの記録の帳面は、世帯ファイルの中身で作り直す
        ai.forget(&id);
        let summary = s
            .list()
            .ok()
            .and_then(|l| l.into_iter().find(|e| e.id == id).map(|e| e.summary))
            .unwrap_or_default();
        ai.on_opened(o, summary)
    })
    .await
}

/// 同期サービスの衝突の写しを片付ける（adopt: 一番新しい写しを今の内容にする）
#[tauri::command]
pub async fn store_sync_copies_resolve(
    app: AppHandle,
    id: String,
    adopt: bool,
) -> Result<(), String> {
    blocking(app, move |s, ai| {
        s.resolve_sync_copies(&id, adopt).map_err(code)?;
        ai.forget(&id);
        Ok(())
    })
    .await
}

/// 保存した世帯から離れた（見本を開いた・削除した）: 自分の開いている印を消す
#[tauri::command]
pub async fn store_leave(app: AppHandle) -> Result<(), String> {
    blocking(app, |s, _| {
        s.leave_all();
        Ok(())
    })
    .await
}

/// 開いている印を定期的に新しくする（アプリの起動時に1回）
pub fn start_heartbeat<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(20));
        if let Some(s) = handle.try_state::<StoreState>() {
            s.0.heartbeat();
        }
    });
}
