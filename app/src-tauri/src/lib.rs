//! ファイナンシアのアプリ本体（Tauri 2）。
//!
//! - 画面（WebView）は「外と話せない箱」（0016 の1）: CSP は tauri.conf.json、起動時のスクリプトは `hardening.js`、
//!   画面の移動と新しいウィンドウは本体で止める。画面から呼べるのは下の命令だけ（capabilities/main.json）。
//! - 正の計算は quickjs-ng（engine-host）で、計算ごとに新しい実行環境を作る（0005 の2・3）。画面側のエンジンは表示の先出しだけ（0005 の5）。
//! - 世帯は、保存した世帯（store.rs。暗号化した世帯ファイル。0011・0013）と、埋め込んだ架空のモデル世帯（見本）。
//! - アプリを閉じるときは、画面に自動保存の残りを書かせてから閉じる（`__financiaBeforeClose` → `app_close_ready`。待つのは最長4秒）。
//!   保存できなかったときは、画面が `app_close_cancel` で待つのをやめてもらい、保存し直す・捨てて閉じる・やめるを FP に聞く。
//! - 提案書の PDF（report.rs）・ヒアリングシートの保存・取り込み・持ち帰り用のレポート（takeaway.rs。0030）は、
//!   平文の書き出しの出口（export.rs）を通す（0020 の5）。
//!   画面にはファイル・ダイアログの権限を与えず、パスも受け取らない。
//! - AI接続口（ai.rs。0014・0015）: 事務所全体の設定（既定はオフ）・世帯ごとの同意・期限つきの共有・記録・AIの候補の判断。
//!   受け口は設定がオンのときだけ開け、画面には鍵もパスも渡さない。
//! - 明細の取り込み（statement.rs。0034）: 明細のファイルは本体のダイアログで選ばせ、大きさを確かめて中身だけを画面に返す（元のファイルは残さない）。
//!   覚えた辞書と形は事務所データ（household-store）に持つ。
//! - 事務所での共有（office.rs。0023）: 共有フォルダは本体のダイアログで選ばせ、パスを画面に渡さない。参加の承認は指紋の入力が必須。
//!   開いている印は裏で定期的に新しくし、閉じるときに消す。
//! - お知らせの一覧（notices.rs。0087）: 配信元のお知らせを読む口は1か所（署名を確かめた中身だけを渡す。今は通信しない）。
//!   既読の印と受付番号はこの PC のアプリのデータにだけ置き、何も送り返さない。要望・不具合のフォームは受付番号だけを受け取って本体が開く。
//! - カスタム層（custom.rs。0016 の3・4・6）: 今は説明の文の差し替えだけ。読み書き・検査・指紋・承認は本体で行い、
//!   承認の台帳はデータフォルダの中（カスタム層の外）。画面は承認した文を文字として当てるだけ。
//! - macOS のメニュー（menu.rs）: 標準の編集メニューを付け、元に戻す・やり直すは画面のアプリ全体の履歴へ渡す。
//!   Windows・Linux はメニューバーを出さない（キー操作は画面が受ける）。

mod ai;
mod custom;
/// 開発用のビルドだけの鍵の保管庫（ファイル。製品のビルドには入らない）
#[cfg(debug_assertions)]
mod dev_keystore;
mod engine;
mod export;
mod features;
mod hearing_web;
mod keyring;
mod menu;
mod notices;
mod office;
mod report;
mod revocations;
mod statement;
mod store;
mod takeaway;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, RunEvent, State, Url, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

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
    app: AppHandle,
    state: State<'_, ReportState>,
    input: String,
    addressee: Option<String>,
    accent: Option<String>,
) -> Result<RenderInfo, String> {
    // 事務所の見た目（0121）: 事務所の名前とロゴは事務所データから（読めなければ無し）。アクセントの色は画面が見やすさを確かめて導いた色
    let brand = office::report_brand(&app, accent.as_deref());
    let (prepared, info) = tauri::async_runtime::spawn_blocking(move || {
        report::render(&input, addressee.as_deref(), brand)
    })
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

/// 持ち帰り用のレポート（0030）: 画面が作った HTML（バイト列）を、平文の書き出しの出口で保存する。
/// 見出し: x-exported-on（YYYY-MM-DD）・x-encrypted（1 ならパスワードを付けた。ファイルの見出しと突き合わせる）
#[tauri::command]
async fn takeaway_save(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<SaveOutcome, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("E_TAKEAWAY_BODY".to_owned());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned()
    };
    let checked = takeaway::check(bytes, header("x-encrypted") == "1")?;
    let name = takeaway::default_name(&header("x-exported-on"), checked.encrypted);
    export::save_with(
        &app,
        &window,
        ExportKind::Takeaway,
        &name,
        bytes,
        checked.encrypted,
    )
    .await
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

/// 閉じる前の保存が済んだ（または待ちきれなかった）
static CLOSE_READY: AtomicBool = AtomicBool::new(false);
/// 閉じる前の保存を画面に頼んだ
static CLOSE_ASKED: AtomicBool = AtomicBool::new(false);
/// 画面の保存を待つ時間の上限
const CLOSE_WAIT: std::time::Duration = std::time::Duration::from_secs(4);
/// 閉じる前の保存を頼んだ回（画面が待つのをやめてもらったら進める。前の回の時間切れで閉じない）
static CLOSE_ROUND: AtomicU64 = AtomicU64::new(0);

/// アプリを閉じる前に、画面に自動保存の残りを書かせる（画面は済んだら app_close_ready を呼ぶ）。
/// 画面のスクリプトは本体から呼ぶだけで、画面に新しい権限は与えない
fn ask_flush_before_close<R: tauri::Runtime>(app: &AppHandle<R>) {
    if CLOSE_ASKED.swap(true, Ordering::SeqCst) {
        return;
    }
    let round = CLOSE_ROUND.load(Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.__financiaBeforeClose ? window.__financiaBeforeClose() : 0");
    }
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_WAIT);
        if !close_wait_over(round) {
            return;
        }
        CLOSE_READY.store(true, Ordering::SeqCst);
        a.exit(0);
    });
}

/// 時間切れで閉じてよいか（その回のあいだに、画面が待つのをやめてもらっていない）
fn close_wait_over(round: u64) -> bool {
    CLOSE_ROUND.load(Ordering::SeqCst) == round
}

/// 画面が、閉じるのを待ってもらう（保存できていない変更をどうするか FP に聞く）。FP が「やめる」を選べば閉じない。
/// 次に閉じようとしたときは、また初めから頼む
#[tauri::command]
fn app_close_cancel() {
    CLOSE_ROUND.fetch_add(1, Ordering::SeqCst);
    CLOSE_ASKED.store(false, Ordering::SeqCst);
}

/// 画面が閉じる前の保存を済ませた
#[tauri::command]
fn app_close_ready(app: AppHandle) {
    CLOSE_READY.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(|app, event| {
        if let Some(js) = menu::script_for(event.id().as_ref()) {
            if let Some(w) = app.get_webview_window("main") {
                w.eval(js).ok();
            }
        }
    });
    let app = builder
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
            hearing_open,
            takeaway_save,
            store::store_status,
            store::store_list,
            store::store_create,
            store::store_open,
            store::store_previous_generation,
            store::store_open_previous,
            store::store_save,
            store::store_rename,
            store::store_delete,
            store::recovery_key_show,
            store::recovery_key_acknowledge,
            store::recovery_key_test,
            store::recovery_key_restore,
            store::store_keystore,
            store::store_list_samples,
            store::store_set_category,
            store::store_assign_serial,
            store::store_make_sample,
            store::store_update_sample,
            store::store_categories,
            store::store_set_categories,
            statement::statement_office,
            statement::statement_learn,
            statement::statement_open,
            statement::statement_sheet_save,
            statement::statement_sheet_open,
            ai::ai_status,
            ai::ai_set_enabled,
            ai::ai_setup_copy,
            ai::ai_household,
            ai::ai_consent_record,
            ai::ai_share_start,
            ai::ai_share_stop,
            ai::ai_candidate_decide,
            ai::ai_documents_taken,
            office::office_status,
            office::office_start,
            office::office_join,
            office::office_cancel,
            office::office_approve,
            office::office_reject,
            office::office_remove,
            office::office_move_local,
            office::office_recover,
            office::office_end,
            office::office_dismiss_notices,
            office::office_accept_roster,
            office::office_defaults_get,
            office::office_defaults_put,
            office::office_branding_get,
            office::office_branding_put,
            office::office_logo_pick,
            features::feature_codes_status,
            features::feature_code_add,
            features::feature_code_remove,
            features::feature_code_notice_dismiss,
            features::feature_codes_check,
            features::feature_code_candidate_decide,
            custom::custom_texts_status,
            custom::custom_texts_approve,
            custom::custom_texts_decline,
            custom::custom_texts_revert,
            custom::custom_texts_rows,
            custom::custom_ledger_reset,
            custom::custom_dir_choose,
            custom::custom_dir_reset,
            custom::custom_dir_create,
            office::store_fork_info,
            office::store_fork_resolve,
            office::store_sync_copies_resolve,
            office::store_leave,
            office::storage_sync_start,
            office::storage_sync_open,
            office::storage_sync_end,
            office::storage_notices,
            notices::notices_feed,
            notices::notice_local_get,
            notices::notice_local_put,
            notices::feedback_form_open,
            notices::feedback_copy,
            app_close_ready,
            app_close_cancel,
            hearing_web::hearing_web_config,
            hearing_web::hearing_web_call,
            hearing_web::hearing_document_save
        ])
        .setup(|app| {
            // エンジンのバイトコードを裏で用意する（最初の計算を待たせない）
            std::thread::spawn(engine::warm_up);
            app.manage(store::init(app.handle())?);
            // 0016 の追記（2026-11-02）: カスタム層（承認の台帳はデータフォルダの中。ファイルは命令が呼ばれたときに読む）
            app.manage(custom::init(app.handle()));
            app.manage(ai::init(app.handle())?);
            ai::start_watch(app.handle());
            // 0110 の追記: 機能を有効にするコードの止めた一覧（コードが入っているときだけ、起動したときと1日1回、配信元から取る）
            app.manage(revocations::init(app.handle()));
            revocations::start_watch(app.handle());
            office::start_heartbeat(app.handle());
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
                let handle = app.handle().clone();
                w.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        if !CLOSE_READY.load(Ordering::SeqCst) {
                            api.prevent_close();
                            ask_flush_before_close(&handle);
                        }
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ファイナンシアを起動できませんでした");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !CLOSE_READY.load(Ordering::SeqCst) {
                api.prevent_exit();
                ask_flush_before_close(handle);
            }
        }
        // 終わる直前: AIへの共有をすべて「アプリの終了」で閉じ、記録を世帯ファイルへ書き戻し、受け口を閉じる（app.json を消す）
        RunEvent::Exit => {
            let store = handle.state::<store::StoreState>();
            handle.state::<ai::AiState>().shutdown(&store.store);
            // 事務所で共有しているときは、自分の開いている印を消す（0023 の7）
            store.store.leave_all();
        }
        _ => {}
    });
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

    #[test]
    fn close_waits_after_the_screen_asks_the_fp() {
        // 閉じる前の保存を頼んだ回のあいだに、画面が待つのをやめてもらったら、時間切れでも閉じない
        CLOSE_ASKED.store(true, Ordering::SeqCst);
        let round = CLOSE_ROUND.load(Ordering::SeqCst);
        assert!(close_wait_over(round));
        app_close_cancel();
        assert!(!close_wait_over(round));
        // 次に閉じようとしたときは、また初めから頼む
        assert!(!CLOSE_ASKED.load(Ordering::SeqCst));
    }
}
