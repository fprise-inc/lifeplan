//! 明細の取り込み（0034）の命令。読む・仕分ける・数えるは画面の statement/ の部品が PC の中で行い、本体は次だけを受け持つ。
//!
//! - 明細のファイルを開く: 本体の開くダイアログで選ばせ、大きさを確かめてから中身を画面に返す（10MB まで）。
//!   パスもファイル名も画面に渡さない。元のファイルはどこにも書かない・残さない（画面は指紋と取り込んだ行だけを世帯ファイルに残す）。
//! - 明細の確認シート（迷う行を前もってお客さまに印を付けてもらう .xlsx。0034 の9）を、平文の書き出しの出口で保存する・
//!   返ってきたシートを選ばせて中身を返す。シートを作る・読むのは画面の statement/ の部品（土台は xlsx/）。パスは受け取らない・返さない。
//! - 覚えた辞書と形（事務所データ。household-store の `statement_office`・`statement_learn`）を読み書きする。
//!   直した人（`by`）は本体が決める（呼んだ側の値は使わない）。中身の検査は household-store が行う。
//! - 明細の写真・スクショ・画像だけの PDF のページの文字を読む（0034 の段階3。0221）: 画面が渡した画像のバイト列を OS の文字認識
//!   （statement-ocr。macOS は Vision、Windows は Windows.Media.Ocr で日本語と、数字の読み直しの英語の2回）で読み、文字の塊（位置は
//!   画像に対する割合）と画像の大きさだけを返す。ファイルを書かない・ネットにつながない・外の AI に送らない。番号を消すのは受け取った
//!   画面の部品（statement/）。対応しない OS・日本語の文字認識が無い Windows・古い Mac は、それぞれのコードを返す。

use ::statement_ocr as ocr;
use household_store::statement_dict::{DictionaryEntry, LearnedFormat, StatementOffice};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, WebviewWindow};

use crate::export::{self, ExportKind, SaveOutcome};
use crate::store::blocking;

/// 明細のファイルの大きさの上限（statement/ の MAX_FILE_BYTES と同じ 10MB）
pub const STATEMENT_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// 確認シート（.xlsx）の大きさの上限（xlsx/ の DEFAULT_LIMITS.maxFileBytes と同じ 10MB）
pub const STATEMENT_SHEET_MAX_BYTES: u64 = 10 * 1024 * 1024;

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

/// 明細のファイル（CSV・TSV・PDF、写真・スクショは何枚か）を選んで、中身を返す。選ばなかったときは空。
/// 返す形は [`pack_files`]（ファイル名・パスは入れない）
#[tauri::command]
pub async fn statement_open(window: WebviewWindow) -> Result<Response, String> {
    let files = crate::export::open_statement(&window, STATEMENT_MAX_BYTES).await?;
    Ok(Response::new(pack_files(&files)))
}

/// 選んだファイルの並びを1つのバイト列にする（"STMF"・数〔u32 LE〕・それぞれの長さ〔u32 LE〕・中身を続けて）。選ばなかったときは空。
/// 画面の `unpackFiles`（app/src/engine/host.ts）が読む
pub fn pack_files(files: &[Vec<u8>]) -> Vec<u8> {
    if files.is_empty() {
        return Vec::new();
    }
    let mut out =
        Vec::with_capacity(8 + files.len() * 4 + files.iter().map(Vec::len).sum::<usize>());
    out.extend_from_slice(b"STMF");
    out.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for f in files {
        out.extend_from_slice(&(f.len() as u32).to_le_bytes());
    }
    for f in files {
        out.extend_from_slice(f);
    }
    out
}

/// 明細の確認シート（画面の statement/ の部品が作った .xlsx のバイト列）を保存する。
/// 見出し: x-customer-no（表示用の顧客番号。英数字。無くてよい）・x-exported-on（YYYY-MM-DD）
#[tauri::command]
pub async fn statement_sheet_save(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<SaveOutcome, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("E_STATEMENT_SHEET_BODY".to_owned());
    };
    // .xlsx（zip）だけを受ける。大きすぎるものは書かない
    if bytes.len() as u64 > STATEMENT_SHEET_MAX_BYTES || !bytes.starts_with(b"PK\x03\x04") {
        return Err("E_STATEMENT_SHEET_BODY".to_owned());
    }
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned()
    };
    let name = sheet_name(&header("x-customer-no"), &header("x-exported-on"));
    export::save(&app, &window, ExportKind::StatementSheet, &name, bytes).await
}

/// 明細の写真・スクショ・画像だけの PDF のページ（PNG・JPEG・HEIC など。10MB まで）の文字を読む。本文は画像のバイト列。
/// 返すのは `{width, height, engine, boxes, digits?}`（画像の大きさ〔画素〕と、文字の塊。塊の `x`・`y`・`w`・`h` は画像の幅・高さに対する
/// 0〜1 の割合で左上が原点。`conf` は Vision だけ。`digits` は Windows で英語でもう1回読んだ塊）。
/// 読めないときはコード（E_OCR_UNSUPPORTED: この OS では読めない・E_OCR_NO_LANGUAGE: 日本語の文字認識が入っていない Windows・
/// E_OCR_OLD_MAC: 日本語を読めない古い macOS・E_OCR_IMAGE: 画像として読めない・E_OCR_FAILED: 文字認識が失敗した）
#[tauri::command]
pub async fn statement_ocr(request: Request<'_>) -> Result<ocr::OcrPage, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("E_STATEMENT_OCR_BODY".to_owned());
    };
    if bytes.len() > ocr::MAX_IMAGE_BYTES || ocr::image_kind(bytes).is_none() {
        return Err("E_STATEMENT_OCR_BODY".to_owned());
    }
    let bytes = bytes.clone();
    // OS の文字認識は時間がかかる（1枚に1秒前後）ので、画面の処理を止めないよう別のスレッドで読む
    tauri::async_runtime::spawn_blocking(move || ocr::recognize_page(&bytes))
        .await
        .map_err(|_| "E_OCR_FAILED".to_owned())?
        .map_err(|e| e.code().to_owned())
}

/// 保存するときの既定のファイル名（顧客番号と日付は形を確かめたときだけ付ける）
fn sheet_name(customer: &str, on: &str) -> String {
    let mut name = "明細の確認シート".to_owned();
    if export::safe_name_part(customer, 16) {
        name.push('_');
        name.push_str(customer);
    }
    if export::is_date(on) {
        name.push('_');
        name.push_str(on);
    }
    name.push_str(".xlsx");
    name
}

/// お客さまが印を付けた確認シートを選んで、中身を返す（読むのは画面の statement/ の部品）。選ばなかったときは空
#[tauri::command]
pub async fn statement_sheet_open(window: WebviewWindow) -> Result<Response, String> {
    Ok(Response::new(
        export::open_statement_sheet(&window, STATEMENT_SHEET_MAX_BYTES)
            .await?
            .unwrap_or_default(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_files_without_names() {
        assert!(pack_files(&[]).is_empty());
        let b = pack_files(&[b"ab".to_vec(), b"xyz".to_vec()]);
        assert_eq!(&b[..4], b"STMF");
        assert_eq!(u32::from_le_bytes(b[4..8].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(b[8..12].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(b[12..16].try_into().unwrap()), 3);
        assert_eq!(&b[16..], b"abxyz");
    }

    #[test]
    fn sheet_names_do_not_take_paths() {
        assert_eq!(
            sheet_name("A0042", "2026-10-23"),
            "明細の確認シート_A0042_2026-10-23.xlsx"
        );
        assert_eq!(sheet_name("../x", "2026/10/23"), "明細の確認シート.xlsx");
        assert_eq!(sheet_name("", ""), "明細の確認シート.xlsx");
    }
}
