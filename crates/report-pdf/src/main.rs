//! 提案書の PDF を作る小さなコマンド（見本の PDF・テスト用。アプリは report_pdf::render_proposal を直接呼ぶ）。
//! 使い方: report-pdf render --input <帳票の入力.json> --frame <外枠.json> --out <出力.pdf> [--meta <控えの情報.json>]
//!         report-pdf text <file.pdf>（各ページの文字を JSON の配列で出す）
//! 失敗は符号だけの JSON を標準エラーに出し、終了コード 1（中身は --debug のときだけ）
use std::process::ExitCode;

use report_pdf::{extract_text, render_proposal, ReportFrame};

fn usage() -> ExitCode {
    eprintln!("usage: report-pdf render --input <input.json> --frame <frame.json> --out <out.pdf> [--meta <meta.json>] [--debug]");
    eprintln!("       report-pdf text <file.pdf>");
    ExitCode::from(2)
}

fn fail(code: &str, detail: &dyn std::fmt::Debug, debug: bool) -> ExitCode {
    if debug {
        eprintln!("{detail:?}");
    }
    eprintln!("{}", serde_json::json!({ "error": { "code": code } }));
    ExitCode::from(1)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("text") => {
            let Some(path) = args.get(1) else {
                return usage();
            };
            let bytes = match std::fs::read(path) {
                Ok(b) => b,
                Err(e) => return fail("E_IO", &e, true),
            };
            match extract_text(&bytes) {
                Ok(pages) => {
                    println!("{}", serde_json::Value::from(pages));
                    ExitCode::SUCCESS
                }
                Err(e) => fail("E_REPORT_PDF", &e, true),
            }
        }
        Some("render") => {
            let (mut input, mut frame, mut out, mut meta, mut debug) =
                (None, None, None, None, false);
            let mut it = args.iter().skip(1);
            while let Some(a) = it.next() {
                match a.as_str() {
                    "--input" => input = it.next().cloned(),
                    "--frame" => frame = it.next().cloned(),
                    "--out" => out = it.next().cloned(),
                    "--meta" => meta = it.next().cloned(),
                    "--debug" => debug = true,
                    _ => return usage(),
                }
            }
            let (Some(input), Some(frame), Some(out)) = (input, frame, out) else {
                return usage();
            };
            let input = match std::fs::read_to_string(&input) {
                Ok(s) => s,
                Err(e) => return fail("E_IO", &e, debug),
            };
            let frame: ReportFrame = match std::fs::read_to_string(&frame)
                .map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            {
                Ok(f) => f,
                Err(e) => return fail("E_REPORT_FRAME", &e, debug),
            };
            let r = match render_proposal(&input, &frame) {
                Ok(r) => r,
                Err(e) => return fail(e.code(), &e, debug),
            };
            if let Err(e) = std::fs::write(&out, &r.pdf) {
                return fail("E_IO", &e, debug);
            }
            if let Some(meta) = meta {
                let m = serde_json::json!({
                    "pages": r.pages,
                    "bytes": r.pdf.len(),
                    "addressee": r.addressee,
                    "noticesPageAdded": r.notices_page_added,
                    "report": r.report,
                });
                if let Err(e) = std::fs::write(&meta, format!("{m:#}\n")) {
                    return fail("E_IO", &e, debug);
                }
            }
            ExitCode::SUCCESS
        }
        _ => usage(),
    }
}
