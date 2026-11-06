//! 提案書のバランスシートの図の色と形（帳票 report-core の layout.typ）:
//! - 箱の中の文字は白の 7pt の太字（小さい文字）なので、どの色も白い文字との差 4.5:1 以上
//! - 色は画面（app/src/styles/balance.css）と同じ
//! - 箱の間に細い余白、角を少し丸める（画面の図と同じ形）
use report_pdf::{render_proposal, Internal, ReportFrame, Stamp};

const LAYOUT: &str = include_str!("../../../report/typst/report-core/parts/layout.typ");
const APP_CSS: &str = include_str!("../../../app/src/styles/balance.css");
const INPUT: &str = include_str!("fixtures/advisoryFeeProposal.input.json");

/// `#let bs-colors = ( ... )` の中の (名前, "#rrggbb")
fn typst_colors() -> Vec<(String, String)> {
    let start = LAYOUT.find("#let bs-colors = (").expect("bs-colors がある");
    let body = &LAYOUT[start..];
    let body = &body[..body.find("\n)").expect("bs-colors の終わり")];
    body.lines()
        .filter_map(|l| {
            let l = l.trim();
            let (k, rest) = l.split_once(": rgb(\"")?;
            Some((k.to_string(), rest.get(..7)?.to_string()))
        })
        .collect()
}

/// 画面の CSS の `--bs-<名前>: #rrggbb;`
fn app_color(key: &str) -> String {
    let pat = format!("--bs-{key}: ");
    let i = APP_CSS
        .find(&pat)
        .unwrap_or_else(|| panic!("--bs-{key} がある"));
    APP_CSS[i + pat.len()..i + pat.len() + 7].to_string()
}

fn ratio_white(hex: &str) -> f64 {
    let ch = |i: usize| {
        let v = u8::from_str_radix(&hex[i..i + 2], 16).unwrap() as f64 / 255.0;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    let l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
    1.05 / (l + 0.05)
}

#[test]
fn box_colors_keep_white_text_readable() {
    let cs = typst_colors();
    assert_eq!(cs.len(), 11, "{cs:?}");
    for (k, c) in &cs {
        let r = ratio_white(c);
        assert!(r >= 4.5, "{k} {c}: 白い文字との差 {r:.2}");
    }
}

#[test]
fn box_colors_match_the_app() {
    let same = [
        ("liquid", "deposit"),
        ("market", "nisa"),
        ("locked", "ideco"),
        ("illiquid", "land"),
        ("land", "land"),
        ("building", "building"),
        ("illiquidOther", "car"),
        ("mortgage", "mortgage"),
        ("propertyLoan", "propertyLoan"),
        ("debt", "carLoan"),
        ("netWorth", "netWorth"),
    ];
    let cs = typst_colors();
    for (t, a) in same {
        let c = cs.iter().find(|(k, _)| k == t).map(|(_, c)| c.clone());
        assert_eq!(c, Some(app_color(a)), "{t} と画面の --bs-{a}");
    }
}

#[test]
fn boxes_have_gap_and_rounded_corners() {
    assert!(LAYOUT.contains("#let bs-gap = 1.5pt"));
    assert!(LAYOUT.contains("#let bs-radius = 3pt"));
    // 白い区切り線ではなく余白で分ける
    assert!(!LAYOUT.contains("stroke: (bottom: 0.6pt + white)"));
    // 図を含む提案書が作れる
    let frame = ReportFrame {
        stamp: Stamp {
            data_set_label: "2026.10-test".into(),
            base_month: "2026-10".into(),
        },
        beta: true,
        notices: vec!["この提案書は試算です（試験の文）。".into()],
        internal: Internal {
            snapshot_id: None,
            data_set_id: None,
            custom_digests: vec![],
        },
        brand: None,
    };
    let r = render_proposal(INPUT, &frame).expect("PDF ができる");
    assert!(r.pages >= 8);
}
