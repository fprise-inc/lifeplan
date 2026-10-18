//! ファイナンシアのアプリ本体（Tauri 2）。
//!
//! - 画面（WebView）は「外と話せない箱」（0016 の1）: CSP は tauri.conf.json、起動時のスクリプトは `hardening.js`、
//!   画面の移動と新しいウィンドウは本体で止める。画面から呼べるのは下の命令だけ（capabilities/main.json）。
//! - 正の計算は quickjs-ng（engine-host）で、計算ごとに新しい実行環境を作る（0005 の2・3）。画面側のエンジンは表示の先出しだけ（0005 の5）。
//! - 世帯は、いまは埋め込んだ架空のモデル世帯だけ（入力・保存・暗号化は次の回）。
//! - 提案書の PDF（report.rs）とヒアリングシートの保存・取り込みは、平文の書き出しの出口（export.rs）を通す（0020 の5）。
//!   画面にはファイル・ダイアログの権限を与えず、パスも受け取らない。

mod engine;
mod export;
mod report;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewWindow, WebviewWindowBuilder};

use export::{ExportKind, ExportLog, SaveOutcome};
use report::{RenderInfo, ReportState};

/// ヒアリングシートの大きさの上限（取り込み・保存。hearing の読み込みの上限と同じ 10MB。0018 の追記）
const SHEET_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 起動時のスクリプト（画面のどのスクリプトよりも先に動く。0016 の1「画面に保存しない」・外部リンク）
const HARDENING_JS: &str = include_str!("hardening.js");

/// 画面が移動してよい先: アプリ自身の画面だけ（開発中は vite の開発用サーバーも）
fn allowed_navigation(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            let host = url.host_str();
            host == Some("tauri.localhost")
                || (cfg!(debug_assertions) && host == Some("localhost") && url.port() == Some(1420))
        }
        _ => false,
    }
}

/// 制度データ・マスタのパック（JSON の配列）。画面側の先出しのエンジンに渡す（署名の確認は本体の仕事。0017 の3）
#[tauri::command]
fn engine_packs() -> Response {
    Response::new(engine::packs_json().to_owned())
}

/// 埋め込んだ架空のモデル世帯の ID の一覧
#[tauri::command]
fn list_households() -> Vec<&'static str> {
    engine::household_ids()
}

/// 架空のモデル世帯を開く（エンジンへの要求の JSON）
#[tauri::command]
fn open_household(id: String) -> Result<Response, String> {
    engine::household(&id)
        .map(|json| Response::new(json.to_owned()))
        .ok_or_else(|| "E_HOUSEHOLD_UNKNOWN".to_owned())
}

/// 正の計算（0005 の2）: 枠（案×想定）ごとに、新しい実行環境で計算する。枠どうしは別のスレッドで同時に
#[tauri::command]
async fn compute(slots: Vec<engine::SlotRequest>) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || engine::compute(&slots))
        .await
        .map_err(|_| "E_HOST_THREAD".to_owned())?
        .map(Response::new)
}

/// 根拠の表示（0006 の7）: 数字をクリックしたときに、その数字を含む案×想定を根拠の記録「全部」で計算し直す
#[tauri::command]
async fn evidence(request: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || engine::evidence(&request))
        .await
        .map_err(|_| "E_HOST_THREAD".to_owned())?
        .map(Response::new)
}

/// 提案書の PDF を作る（帳票の入力の JSON と、出力の PDF にだけ重ねる宛名）。刻印・必須の記載は本体が決める。
/// 作った PDF は本体の中に置き、画面には大きさと時間だけを返す
#[tauri::command]
async fn proposal_render(
    state: State<'_, ReportState>,
    input: String,
    addressee: Option<String>,
) -> Result<RenderInfo, String> {
    let (prepared, info) =
        tauri::async_runtime::spawn_blocking(move || report::render(&input, addressee.as_deref()))
            .await
            .map_err(|_| "E_HOST_THREAD".to_owned())??;
    *state.0.lock().map_err(|_| "E_HOST_LOCK".to_owned())? = Some(prepared);
    Ok(info)
}

/// 見本の1ページ（0 から）を返す。format が "svg" なら SVG の文字列（本体の見本）、省略・"png" なら PNG（縮小一覧。
/// scale は 1pt あたりの画素）
#[tauri::command]
async fn proposal_page(
    state: State<'_, ReportState>,
    page: usize,
    scale: f64,
    format: Option<String>,
) -> Result<Response, String> {
    let format = report::PageFormat::parse(format.as_deref())?;
    let rendered = {
        let g = state.0.lock().map_err(|_| "E_HOST_LOCK".to_owned())?;
        let p = g.as_ref().ok_or_else(|| "E_REPORT_NONE".to_owned())?;
        report::Prepared {
            rendered: p.rendered.clone(),
            issued_on: p.issued_on.clone(),
        }
    };
    tauri::async_runtime::spawn_blocking(move || report::page_image(&rendered, page, scale, format))
        .await
        .map_err(|_| "E_HOST_THREAD".to_owned())?
        .map(Response::new)
}

/// 作った PDF を保存する（OS の保存のダイアログ。平文の書き出しの出口）
#[tauri::command]
async fn proposal_save(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ReportState>,
) -> Result<SaveOutcome, String> {
    let (pdf, name) = {
        let g = state.0.lock().map_err(|_| "E_HOST_LOCK".to_owned())?;
        let p = g.as_ref().ok_or_else(|| "E_REPORT_NONE".to_owned())?;
        (p.rendered.clone(), report::default_name(p))
    };
    export::save(&app, &window, ExportKind::Proposal, &name, &pdf.pdf).await
}

/// 作った PDF を捨てる（提案書の画面を離れたとき。宛名入りの PDF をメモリに残さない）
#[tauri::command]
fn proposal_discard(state: State<'_, ReportState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "E_HOST_LOCK".to_owned())? = None;
    Ok(())
}

/// ヒアリングシート（画面の hearing の部品が作った .xlsx のバイト列）を保存する。
/// 見出し: x-customer-no（表示用の顧客番号。英数字）・x-exported-on（YYYY-MM-DD）・x-prefilled（1 なら前回の値入り）
#[tauri::command]
async fn hearing_save(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<SaveOutcome, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("E_HEARING_BODY".to_owned());
    };
    // .xlsx（zip）だけを受ける。大きすぎるものは書かない
    if bytes.len() as u64 > SHEET_MAX_BYTES || !bytes.starts_with(b"PK\x03\x04") {
        return Err("E_HEARING_BODY".to_owned());
    }
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned()
    };
    let customer = header("x-customer-no");
    let on = header("x-exported-on");
    let prefilled = header("x-prefilled") == "1";
    let mut name = "ヒアリングシート".to_owned();
    if export::safe_name_part(&customer, 16) {
        name.push('_');
        name.push_str(&customer);
    }
    if export::is_date(&on) {
        name.push('_');
        name.push_str(&on);
    }
    name.push_str(".xlsx");
    let kind = if prefilled {
        ExportKind::HearingSheetPrefilled
    } else {
        ExportKind::HearingSheet
    };
    export::save(&app, &window, kind, &name, bytes).await
}

/// 記入済みのヒアリングシートを選んで、中身を返す（取り込みは画面の hearing の部品が行う。0018 の6）。選ばなかったときは空
#[tauri::command]
async fn hearing_open(window: WebviewWindow) -> Result<Response, String> {
    Ok(Response::new(
        export::open_sheet(&window, SHEET_MAX_BYTES)
            .await?
            .unwrap_or_default(),
    ))
}

pub fn run() {
    tauri::Builder::default()
        .manage(ReportState::default())
        .manage(ExportLog::default())
        .invoke_handler(tauri::generate_handler![
            engine_packs,
            list_households,
            open_household,
            compute,
            evidence,
            proposal_render,
            proposal_page,
            proposal_save,
            proposal_discard,
            hearing_save,
            hearing_open
        ])
        .setup(|app| {
            // エンジンのバイトコードを裏で用意する（最初の計算を待たせない）
            std::thread::spawn(engine::warm_up);
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json に main のウィンドウがありません")?;
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(HARDENING_JS)
                .on_navigation(allowed_navigation)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            if let Some(w) = app.get_webview_window("main") {
                w.set_focus().ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ファイナンシアを起動できませんでした");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_is_limited_to_the_app() {
        assert!(allowed_navigation(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(allowed_navigation(
            &Url::parse("http://tauri.localhost/").unwrap()
        ));
        assert!(!allowed_navigation(
            &Url::parse("https://example.com/").unwrap()
        ));
        assert!(!allowed_navigation(
            &Url::parse("file:///etc/hosts").unwrap()
        ));
        assert!(!allowed_navigation(
            &Url::parse("http://localhost:8080/").unwrap()
        ));
    }
}
