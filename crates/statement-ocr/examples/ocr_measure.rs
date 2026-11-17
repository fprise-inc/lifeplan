//! 文字認識の試し（0034 の段階3）: 画像のファイルを読み、OS の文字認識の結果を JSON で標準出力に書く。
//! 架空の明細の画像（statement/test/fixtures/ocr/）で読める度合いを測るのに使う（statement/scripts/ocr-measure.ts が読む）。
//!   cargo run --release -p statement-ocr --example ocr_measure -- <画像> ...
use std::time::Instant;

use serde::Serialize;
use statement_ocr::{backend, languages, recognize, OcrBox};

#[derive(Serialize)]
struct Image {
    file: String,
    ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    boxes: Option<Vec<OcrBox>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

#[derive(Serialize)]
struct Report {
    backend: &'static str,
    languages: Vec<String>,
    images: Vec<Image>,
}

fn main() {
    let mut images = Vec::new();
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let file = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(path.clone());
        let started = Instant::now();
        let result = recognize(&bytes);
        let ms = started.elapsed().as_millis();
        images.push(match result {
            Ok(boxes) => Image {
                file,
                ms,
                boxes: Some(boxes),
                error: None,
            },
            Err(e) => Image {
                file,
                ms,
                boxes: None,
                error: Some(e.code()),
            },
        });
    }
    let report = Report {
        backend: backend(),
        languages: languages(),
        images,
    };
    println!("{}", serde_json::to_string(&report).expect("JSON"));
}
