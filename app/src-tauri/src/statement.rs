//! 明細の取り込み（0034）の命令。読む・仕分ける・数えるは画面の statement/ の部品が PC の中で行い、本体は次だけを受け持つ。
//!
//! - 明細のファイルを開く: 本体の開くダイアログで選ばせ、大きさを確かめてから中身を画面に返す（10MB まで）。
//!   パスもファイル名も画面に渡さない。元のファイルはどこにも書かない・残さない（画面は指紋と取り込んだ行だけを世帯ファイルに残す）。
//! - 覚えた辞書と形（事務所データ。household-store の `statement_office`・`statement_learn`）を読み書きする。
//!   直した人（`by`）は本体が決める（呼んだ側の値は使わない）。中身の検査は household-store が行う。

use household_store::statement_dict::{DictionaryEntry, LearnedFormat, StatementOffice};
use tauri::ipc::Response;
use tauri::{AppHandle, WebviewWindow};

use crate::store::blocking;

/// 明細のファイルの大きさの上限（statement/ の MAX_FILE_BYTES と同じ 10MB）
pub const STATEMENT_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 覚えた辞書と形（事務所で共有しているときは、共有フォルダの全員の分と合わせたもの）
#[tauri::command]
pub async fn statement_office(app: AppHandle) -> Result<StatementOffice, String> {
    blocking(app, |s| s.statement_office()).await
}

/// FP が直した結果を覚える（1つでも形が合わなければ何も覚えない）。合わせた後の辞書と形を返す
#[tauri::command]
pub async fn statement_learn(
    app: AppHandle,
    entries: Vec<DictionaryEntry>,
    formats: Vec<LearnedFormat>,
) -> Result<StatementOffice, String> {
    blocking(app, move |s| s.statement_learn(&entries, &formats)).await
}

/// 明細のファイル（CSV・TSV・文字の入った PDF）を選んで、中身を返す。選ばなかったときは空
#[tauri::command]
pub async fn statement_open(window: WebviewWindow) -> Result<Response, String> {
    Ok(Response::new(
        crate::export::open_statement(&window, STATEMENT_MAX_BYTES)
            .await?
            .unwrap_or_default(),
    ))
}
