//! 提案書の PDF（0009）: 画面が組み立てた帳票の入力（JSON）から、report-pdf で PDF を作り、見本の画像を返し、平文の出口で保存する。
//!
//! - 刻印（制度データの版・計算基準日）・必須の記載・「β版・試算」の透かし・内部情報（XMP）は、本体がここで決める
//!   （画面から受け取らない。0009 の5〜7）。制度データの版は、本体に埋め込んだパックの組から作る。
//! - 宛名は保存しない（0012・0009 の3）。出力の PDF に重ねるだけで、ファイル・記録・ログに残さない。作った PDF は
//!   次に作り直すまで本体のメモリの中だけに置く（見本の表示と保存のため）。
//! - 画面は PDF を直接表示できない（CSP の object-src・frame-src が none）ので、見本はページごとの PNG で返す。
//! - 控え（0009 の2。世帯ファイルの snapshots と、暗号化した宛名なしの PDF）は、世帯ファイルの保存の回で作る。

use std::sync::{Arc, Mutex};
use std::time::Instant;

use report_pdf::{render_page_png, render_proposal_output, Internal, Rendered, ReportFrame, Stamp};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::engine;

/// 必須の記載（0009 の6）。文言は仮のもの（原本の確認と事務所の文言の設定は後の回）
pub const STANDARD_NOTICES: &[&str] = &[
    "この提案書は、お伺いした情報と前提条件にもとづく試算です。将来の金額や結果を保証するものではありません。",
    "公的データの出典: 国税庁、厚生労働省、日本年金機構、文部科学省、金融庁、総務省統計局の公表資料（加工して作成）",
    "前提条件や計算方法の一部は担当FPが設定しています。",
];
/// 遺族年金を見直し前の制度で計算しているとき（帳票の入力の assumptions.survivorReform）
pub const REFORM_NOTICE: &str =
    "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）。";
/// β版の期間（0009 の5）
pub const BETA: bool = true;

/// 作った PDF（次に作り直すまで）
pub struct Prepared {
    pub rendered: Arc<Rendered>,
    /// 既定のファイル名に使う作成日（帳票の入力の document.issuedOn）
    pub issued_on: String,
}

#[derive(Default)]
pub struct ReportState(pub Mutex<Option<Prepared>>);

/// 画面に返す情報（PDF のバイトは返さない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderInfo {
    pub pages: usize,
    /// ページの大きさ（pt。幅・高さ）
    pub sizes: Vec<[f64; 2]>,
    pub bytes: usize,
    /// 本体の中で PDF を作った時間（ミリ秒）
    pub ms: f64,
    pub notices_page_added: bool,
}

/// 刻印の制度データの版: 計算基準月と、パックと版の組の指紋の先頭8桁（書式は未確定。0009 の未確定・0017）
pub fn data_set_label(base_month: &str, packs_json: &str) -> Result<String, String> {
    let packs: Vec<serde_json::Value> =
        serde_json::from_str(packs_json).map_err(|_| "E_REPORT_PACKS".to_owned())?;
    let mut ids: Vec<String> = packs
        .iter()
        .filter_map(|p| {
            let pack = p.get("pack")?;
            Some(format!(
                "{}@{}",
                pack.get("packId")?.as_str()?,
                pack.get("version")?.as_str()?
            ))
        })
        .collect();
    if ids.is_empty() {
        return Err("E_REPORT_PACKS".to_owned());
    }
    ids.sort();
    let digest = format!("{:x}", Sha256::digest(ids.join("\n").as_bytes()));
    Ok(format!("{}-{}", base_month.replace('-', "."), &digest[..8]))
}

fn is_base_month(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7
        && b[4] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || c.is_ascii_digit())
        && matches!(s[5..7].parse::<u32>(), Ok(1..=12))
}

/// 帳票の外側（刻印・透かし・必須の記載・内部情報）を本体が決める
pub fn frame_for(input: &serde_json::Value, packs_json: &str) -> Result<ReportFrame, String> {
    let base_month = input
        .pointer("/basis/baseMonth")
        .and_then(|v| v.as_str())
        .filter(|s| is_base_month(s))
        .ok_or_else(|| "E_REPORT_INPUT".to_owned())?;
    let label = data_set_label(base_month, packs_json)?;
    let mut notices: Vec<String> = STANDARD_NOTICES.iter().map(|s| (*s).to_owned()).collect();
    if input
        .pointer("/assumptions/survivorReform")
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        notices.push(REFORM_NOTICE.to_owned());
    }
    Ok(ReportFrame {
        stamp: Stamp {
            data_set_label: label.clone(),
            base_month: base_month.to_owned(),
        },
        beta: BETA,
        notices,
        internal: Internal {
            snapshot_id: None,
            data_set_id: Some(label),
            custom_digests: vec![],
        },
    })
}

/// 帳票の入力から PDF を作る（宛名は重ねるだけで残さない）
pub fn render(input_json: &str, addressee: Option<&str>) -> Result<(Prepared, RenderInfo), String> {
    let t0 = Instant::now();
    let input: serde_json::Value =
        serde_json::from_str(input_json).map_err(|_| "E_REPORT_INPUT".to_owned())?;
    let frame = frame_for(&input, engine::packs_json())?;
    let addressee = addressee.map(str::trim).filter(|s| !s.is_empty());
    let rendered =
        render_proposal_output(input_json, &frame, addressee).map_err(|e| e.code().to_owned())?;
    let info = RenderInfo {
        pages: rendered.pages,
        sizes: rendered
            .layout
            .pages()
            .iter()
            .map(|p| {
                let s = p.frame.size();
                [s.x.to_pt(), s.y.to_pt()]
            })
            .collect(),
        bytes: rendered.pdf.len(),
        ms: t0.elapsed().as_secs_f64() * 1000.0,
        notices_page_added: rendered.notices_page_added,
    };
    let issued_on = input
        .pointer("/document/issuedOn")
        .and_then(|v| v.as_str())
        .filter(|s| crate::export::is_date(s))
        .unwrap_or("")
        .to_owned();
    Ok((
        Prepared {
            rendered: Arc::new(rendered),
            issued_on,
        },
        info,
    ))
}

/// 見本の1ページ（0 から）の PNG
pub fn page_png(prepared: &Prepared, page: usize, scale: f64) -> Result<Vec<u8>, String> {
    render_page_png(&prepared.rendered, page, scale).ok_or_else(|| "E_REPORT_PAGE".to_owned())
}

/// 既定のファイル名（宛名・氏名は入れない）
pub fn default_name(prepared: &Prepared) -> String {
    if prepared.issued_on.is_empty() {
        "提案書.pdf".to_owned()
    } else {
        format!("提案書_{}.pdf", prepared.issued_on)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INPUT: &str =
        include_str!("../../../crates/report-pdf/tests/fixtures/advisoryFeeProposal.input.json");

    #[test]
    fn frame_is_decided_by_the_host() {
        let input: serde_json::Value = serde_json::from_str(INPUT).unwrap();
        let f = frame_for(&input, engine::packs_json()).unwrap();
        let base = input.pointer("/basis/baseMonth").unwrap().as_str().unwrap();
        assert_eq!(f.stamp.base_month, base);
        assert!(f.stamp.data_set_label.starts_with(&base.replace('-', ".")));
        assert_eq!(f.stamp.data_set_label.len(), 7 + 1 + 8);
        assert!(f.beta);
        for n in STANDARD_NOTICES {
            assert!(f.notices.iter().any(|x| x == n));
        }
        // 刻印に製品名・提供元の名前を入れない
        let t = f.stamp.text();
        for w in ["ファイナンシア", "Financia", "FPRISE", "FPライズ"] {
            assert!(!t.contains(w), "{w}");
        }
    }

    #[test]
    fn reform_notice_follows_the_input() {
        let mut input: serde_json::Value = serde_json::from_str(INPUT).unwrap();
        input["assumptions"]["survivorReform"] = serde_json::Value::Bool(true);
        let f = frame_for(&input, engine::packs_json()).unwrap();
        assert!(f.notices.iter().any(|n| n == REFORM_NOTICE));
        input["basis"]["baseMonth"] = serde_json::Value::String("2026-13".into());
        assert_eq!(
            frame_for(&input, engine::packs_json()).unwrap_err(),
            "E_REPORT_INPUT"
        );
    }

    #[test]
    fn data_set_label_is_order_independent() {
        let a = r#"[{"pack":{"packId":"b","version":"1"}},{"pack":{"packId":"a","version":"2"}}]"#;
        let b = r#"[{"pack":{"packId":"a","version":"2"}},{"pack":{"packId":"b","version":"1"}}]"#;
        assert_eq!(
            data_set_label("2026-10", a).unwrap(),
            data_set_label("2026-10", b).unwrap()
        );
        assert_ne!(
            data_set_label("2026-10", a).unwrap(),
            data_set_label("2026-10", r#"[{"pack":{"packId":"a","version":"3"}}]"#).unwrap()
        );
        assert!(data_set_label("2026-10", "[]").is_err());
    }

    #[test]
    fn renders_pdf_and_preview_pages_with_addressee_only_in_output() {
        let (p, info) = render(INPUT, Some("見本 花子")).unwrap();
        assert_eq!(info.pages, p.rendered.pages);
        assert_eq!(info.sizes.len(), info.pages);
        assert!(info.bytes > 10_000);
        let png = page_png(&p, 0, 1.0).unwrap();
        assert_eq!(&png[..4], b"\x89PNG");
        assert!(page_png(&p, info.pages, 1.0).is_err());
        let text = report_pdf::extract_text(&p.rendered.pdf).unwrap();
        assert!(report_pdf::normalize(&text[0]).contains("見本花子"));
        assert!(default_name(&p).starts_with("提案書_"));
        assert!(
            !default_name(&p).contains("花子"),
            "既定のファイル名に宛名を入れない"
        );
        // 空白だけの宛名は宛名なし
        let (q, _) = render(INPUT, Some("   ")).unwrap();
        assert!(
            !report_pdf::normalize(&report_pdf::extract_text(&q.rendered.pdf).unwrap()[0])
                .contains("見本花子")
        );
    }
}
