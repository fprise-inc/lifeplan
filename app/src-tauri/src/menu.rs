//! アプリのメニュー（macOS）。
//!
//! - 標準の「編集」メニュー（元に戻す・やり直す・切り取り・コピー・ペースト・すべてを選択）を付ける。これがないと、
//!   macOS の WebView では文字の欄の中でも ⌘C・⌘V などが効かない。
//! - 元に戻す・やり直すは標準の項目（文字の欄の元に戻すだけ）にせず、自前の項目にして画面へ渡す。画面の側が
//!   「文字の欄の中に戻せる入力があれば文字を、なければアプリ全体の履歴を」戻す（キー操作と同じ入口）。
//!   画面へは決まった文だけを eval で送る（ウィンドウの "financia:menu" のイベント。画面に命令の権限は足さない）。
//! - ⌘Z を画面が先に受けて処理したときは、メニューには届かない（届いたときも画面の側で二重に戻さない）。

// Windows・Linux ではメニューを付けないので、ID と送る文はテストでだけ使う
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

/// 元に戻す・やり直すのメニューの項目の ID
pub const UNDO_ID: &str = "financia.undo";
pub const REDO_ID: &str = "financia.redo";

/// メニューの項目 → 画面に送る文（決まった文だけ。ほかの項目は送らない）
pub fn script_for(id: &str) -> Option<&'static str> {
    match id {
        UNDO_ID => {
            Some(r#"window.dispatchEvent(new CustomEvent("financia:menu",{detail:"undo"}))"#)
        }
        REDO_ID => {
            Some(r#"window.dispatchEvent(new CustomEvent("financia:menu",{detail:"redo"}))"#)
        }
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let info = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some("ファイナンシア".to_owned()),
        version: Some(info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "ファイナンシア",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("ファイナンシアについて"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("サービス"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("ファイナンシアを隠す"))?,
            &PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?,
            &PredefinedMenuItem::show_all(app, Some("すべてを表示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("ファイナンシアを終了"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "編集",
        true,
        &[
            &MenuItem::with_id(app, UNDO_ID, "元に戻す", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, REDO_ID, "やり直す", true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("カット"))?,
            &PredefinedMenuItem::copy(app, Some("コピー"))?,
            &PredefinedMenuItem::paste(app, Some("ペースト"))?,
            &PredefinedMenuItem::select_all(app, Some("すべてを選択"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "表示",
        true,
        &[&PredefinedMenuItem::fullscreen(
            app,
            Some("フルスクリーンにする"),
        )?],
    )?;
    let window = Submenu::with_items(
        app,
        "ウインドウ",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("しまう"))?,
            &PredefinedMenuItem::maximize(app, Some("拡大／縮小"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("ウインドウを閉じる"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_undo_and_redo_reach_the_screen() {
        let undo = script_for(UNDO_ID).unwrap();
        let redo = script_for(REDO_ID).unwrap();
        assert!(undo.contains(r#""financia:menu""#) && undo.contains(r#"detail:"undo""#));
        assert!(redo.contains(r#"detail:"redo""#));
        assert_eq!(script_for("quit"), None);
        assert_eq!(script_for(""), None);
    }
}
