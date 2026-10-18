//! 見本の速さを測る（開発用）: cargo run [--release] -p report-pdf --example timing -- <帳票の入力.json> <外枠.json>
//! 帳票を組む（PDF まで）・ページの PNG（見本の旧方式の倍率 2.8 と、縮小一覧の 0.3）・ページの SVG のそれぞれの時間を出す
use std::time::Instant;

use report_pdf::{render_page_png, render_page_svg, render_proposal_output, ReportFrame};

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let input = std::fs::read_to_string(&args[0]).expect("帳票の入力");
    let frame: ReportFrame =
        serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("外枠")).expect("外枠の形");
    let t = Instant::now();
    let r = render_proposal_output(&input, &frame, Some("見本 太郎")).expect("PDF");
    let render = ms(t);
    let mut png = vec![];
    let mut thumb = vec![];
    let mut svg = vec![];
    let mut svg_bytes = 0;
    for i in 0..r.pages {
        let t = Instant::now();
        render_page_png(&r, i, 2.8).unwrap();
        png.push(ms(t));
        let t = Instant::now();
        render_page_png(&r, i, 0.3).unwrap();
        thumb.push(ms(t));
        let t = Instant::now();
        svg_bytes += render_page_svg(&r, i).unwrap().len();
        svg.push(ms(t));
    }
    let stat = |v: &[f64]| {
        let max = v.iter().cloned().fold(0.0, f64::max);
        let avg = v.iter().sum::<f64>() / v.len() as f64;
        format!(
            "平均 {avg:.0}ms・最大 {max:.0}ms・合計 {:.0}ms",
            v.iter().sum::<f64>()
        )
    };
    println!("ページ数 {}・PDF {}KB", r.pages, r.pdf.len() / 1024);
    println!("帳票を組む（PDF まで）: {render:.0}ms");
    println!("PNG 倍率2.8（旧方式の見本）: {}", stat(&png));
    println!("PNG 倍率0.3（縮小一覧）: {}", stat(&thumb));
    println!("SVG: {}（全ページ {}KB）", stat(&svg), svg_bytes / 1024);
}
