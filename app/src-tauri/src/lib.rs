//! ファイナンシアのアプリ本体（Tauri 2）。
//!
//! - 画面（WebView）は「外と話せない箱」（0016 の1）: CSP は tauri.conf.json、起動時のスクリプトは `hardening.js`、
//!   画面の移動と新しいウィンドウは本体で止める。画面から呼べるのは下の命令だけ（capabilities/main.json）。
//! - 正の計算は quickjs-ng（engine-host）で、計算ごとに新しい実行環境を作る（0005 の2・3）。画面側のエンジンは表示の先出しだけ（0005 の5）。
//! - 世帯は、いまは埋め込んだ架空のモデル世帯だけ（入力・保存・暗号化は次の回）。

mod engine;

use tauri::ipc::Response;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewWindowBuilder};

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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            engine_packs,
            list_households,
            open_household,
            compute,
            evidence
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
