//! 開発用のサーバーの文字認識の代わり（app/vite.config.ts の /__dev/statement/ocr）: 標準入力の画像のバイト列を、画面の命令
//! `statement_ocr` と同じ読み方で読み、結果の JSON を標準出力に書く。読めなければ `{"error": "E_OCR_…"}`。ファイルは書かない
//!   cargo build --release -p statement-ocr --example ocr_page
use std::io::{Read, Write};

fn main() {
    let mut bytes = Vec::new();
    if std::io::stdin()
        .take(statement_ocr::MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .is_err()
    {
        println!(r#"{{"error":"E_OCR_IMAGE"}}"#);
        return;
    }
    let out = match statement_ocr::recognize_page(&bytes) {
        Ok(page) => serde_json::to_string(&page).expect("JSON"),
        Err(e) => format!(r#"{{"error":"{}"}}"#, e.code()),
    };
    let _ = writeln!(std::io::stdout(), "{out}");
}
