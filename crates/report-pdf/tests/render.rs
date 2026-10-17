//! 提案書の PDF の試験（0009 の「テストで確かめること」のうち、帳票の外側で付けるもの）。
//! 入力は架空のモデル世帯から作った帳票の入力（tests/fixtures。report/ で `npm run samples -- --fixture` が作る）
use report_pdf::{
    extract_text, normalize, render_proposal, render_with_main, Internal, ReportError, ReportFrame,
    Stamp, INPUT_VERSION, WATERMARK, XMP_NAMESPACE,
};

const INPUT: &str = include_str!("fixtures/advisoryFeeProposal.input.json");

fn frame() -> ReportFrame {
    ReportFrame {
        stamp: Stamp {
            data_set_label: "2026.10-test".into(),
            base_month: "2026-10".into(),
        },
        beta: true,
        notices: vec![
            "この提案書は試算です（試験の文）。".into(),
            "前提条件や計算方法の一部は担当FPが設定しています。".into(),
        ],
        internal: Internal {
            snapshot_id: Some("snap-test-1".into()),
            data_set_id: Some("ds-test".into()),
            custom_digests: vec![],
        },
    }
}

/// PDF の生のバイトの中に文字列があるか（XMP は圧縮しない）
fn contains(pdf: &[u8], s: &str) -> bool {
    pdf.windows(s.len()).any(|w| w == s.as_bytes())
}

#[test]
fn renders_with_stamp_on_every_page() {
    let f = frame();
    let r = render_proposal(INPUT, &f).expect("PDF ができる");
    assert!(r.pages >= 8, "標準構成のページ数: {}", r.pages);
    assert!(!r.notices_page_added, "公式の帳票は必須の記載の欄を持つ");
    let pages = extract_text(&r.pdf).unwrap();
    assert_eq!(pages.len(), r.pages);
    let stamp = normalize(&f.stamp.text());
    for (i, p) in pages.iter().enumerate() {
        let t = normalize(p);
        assert!(t.contains(&stamp), "{}ページ目に刻印", i + 1);
        assert!(
            t.contains(&normalize(WATERMARK)),
            "{}ページ目に透かし",
            i + 1
        );
    }
    let all = normalize(&pages.join(""));
    for n in &f.notices {
        assert!(all.contains(&normalize(n)), "必須の記載: {n}");
    }
}

#[test]
fn same_input_gives_same_bytes() {
    let a = render_proposal(INPUT, &frame()).unwrap();
    let b = render_proposal(INPUT, &frame()).unwrap();
    assert_eq!(a.pdf, b.pdf, "同じ入力から同じ PDF（時計を使わない）");
}

#[test]
fn metadata_has_no_creator_and_internal_xmp() {
    let r = render_proposal(INPUT, &frame()).unwrap();
    let doc = lopdf::Document::load_mem(&r.pdf).unwrap();
    let info = doc
        .trailer
        .get(b"Info")
        .and_then(|o| o.as_reference())
        .and_then(|id| doc.get_dictionary(id))
        .ok();
    if let Some(info) = info {
        for k in [b"Creator".as_slice(), b"Producer".as_slice()] {
            if let Ok(v) = info.get(k) {
                let s = v.as_str().map(|b| b.to_vec()).unwrap_or_default();
                assert!(s.is_empty(), "{} は空", String::from_utf8_lossy(k));
            }
        }
    }
    assert!(contains(&r.pdf, XMP_NAMESPACE), "内部情報の名前空間");
    assert!(contains(&r.pdf, "<lp:snapshot>snap-test-1</lp:snapshot>"));
    assert!(contains(&r.pdf, "<lp:custom>false</lp:custom>"));
    for bad in ["Typst", "ファイナンシア", "Financia", "FPライズ", "FPRISE"] {
        assert!(
            !contains(&r.pdf, bad),
            "製品名・社名・作成ソフトが入らない: {bad}"
        );
    }
}

#[test]
fn custom_digests_go_to_xmp_only() {
    let mut f = frame();
    f.internal.custom_digests = vec!["sha256:abc123".into()];
    let r = render_proposal(INPUT, &f).unwrap();
    assert!(contains(&r.pdf, "<lp:custom>true</lp:custom>"));
    assert!(contains(&r.pdf, "sha256:abc123"));
    let text = extract_text(&r.pdf).unwrap().join("");
    assert!(
        !text.contains("abc123"),
        "カスタムの印は紙面に出ない（D-29）"
    );
}

#[test]
fn declares_addressee_field_on_cover() {
    let r = render_proposal(INPUT, &frame()).unwrap();
    let a = r.addressee.expect("表紙の部品が宛名欄を宣言する");
    assert_eq!(a.page, 1);
    assert!(a.width > 100.0 && a.height > 10.0);
    assert!(r.report.typst == "0.15.1" && r.report.fonts.len() == 2);
    assert!(r
        .report
        .fonts
        .iter()
        .all(|f| f.digest.starts_with("sha256:")));
}

/// 必須の記載の欄を持たない独自帳票でも、アプリが「注意書き」のページを足す
#[test]
fn adds_notices_page_when_template_lacks_it() {
    let main =
        "#set text(font: \"BIZ UDGothic\")\n#set page(paper: \"a4\")\n= 独自の帳票\n本文だけ。\n";
    let f = frame();
    let r = render_with_main(main, INPUT, &f).unwrap();
    assert!(r.notices_page_added);
    assert_eq!(r.pages, 2);
    let pages = extract_text(&r.pdf).unwrap();
    for n in &f.notices {
        assert!(normalize(&pages[1]).contains(&normalize(n)));
    }
}

/// 帳票が刻印の帯に描いても、フッターを消そうとしても、刻印は残る（帳票を組んだ後に重ねるため）
#[test]
fn template_cannot_remove_stamp() {
    let main = "#set text(font: \"BIZ UDGothic\")\n#set page(paper: \"a4\", margin: 0pt, footer: none)\n#place(bottom + left, rect(width: 100%, height: 40pt, fill: black))\n#place(bottom + left, text(\"偽の刻印\"))\n本文\n";
    let f = frame();
    let r = render_with_main(main, INPUT, &f).unwrap();
    let pages = extract_text(&r.pdf).unwrap();
    assert!(normalize(&pages[0]).contains(&normalize(&f.stamp.text())));
}

#[test]
fn rejects_unbundled_font() {
    let main = "#set text(font: \"Arial\")\n本文\n";
    match render_with_main(main, INPUT, &frame()) {
        Err(ReportError::Font(_)) => {}
        other => panic!("同梱以外のフォントはエラー: {other:?}"),
    }
}

#[test]
fn rejects_other_input_version() {
    let bad = INPUT.replacen(
        &format!("\"version\": \"{INPUT_VERSION}\""),
        "\"version\": \"9.9.9\"",
        1,
    );
    assert_ne!(bad, INPUT);
    match render_proposal(&bad, &frame()) {
        Err(e) => assert_eq!(e.code(), "E_REPORT_INPUT"),
        Ok(_) => panic!("版の違う入力は受けない"),
    }
}

#[test]
fn template_cannot_read_files_or_clock() {
    for main in [
        "#read(\"/etc/passwd\")",
        "#datetime.today()",
        "#import \"@preview/cetz:0.3.0\": *",
    ] {
        let m = format!("#set text(font: \"BIZ UDGothic\")\n{main}\n");
        assert!(
            matches!(
                render_with_main(&m, INPUT, &frame()),
                Err(ReportError::Typst(_))
            ),
            "読めない: {main}"
        );
    }
}
