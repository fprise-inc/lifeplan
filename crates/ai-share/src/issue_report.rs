//! AI がまとめた要望・不具合の報告を、アプリの「送る報告の確認画面」に承認待ちで出す（0259）。
//!
//! - 接続口の `propose_issue_report` から届いた報告（`{ items: [{ kind, screen?, text }] }`。FP が話した内容を AI が1件ずつに分けた物）を、
//!   形だけ確かめてメモリの中に置くだけ。送らない・フォームを開かない・世帯ファイルにも事務所データにも書かない。FP が画面で件ごとに確かめて
//!   直し・外し、「送る」を押したときだけ、画面が全件を1つの文にまとめて写し、フォームを1回だけ開く（送り方は画面の1か所。文は URL に入れない）。
//! - 文は信用しない（AI が書いた物）。画面は文字のまま出し、名前・金額らしい所に件ごとに印を付けて FP に確かめてもらう。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 1件の文の長さの上限（文字。draft_issue_report の文は見出しと20件の根拠・手順・エラーの記録で、ふつうは数千文字まで）
pub const MAX_TEXT_CHARS: usize = 12_000;
/// 1回の報告の全件の文の長さの上限（文字）
pub const MAX_TOTAL_CHARS: usize = 40_000;
/// 1回の報告の件数の上限
pub const MAX_ITEMS: usize = 20;
/// どの画面かの長さの上限（文字）
pub const MAX_SCREEN_CHARS: usize = 40;
/// 承認待ちに置ける報告の数（FP が送るか捨てるまで、新しい報告は出せない）
pub const MAX_PENDING: usize = 3;
/// 件の種類（不具合・要望・質問。受け付けのフォームの「どれに当たりますか」と同じ3つ）
pub const KINDS: [&str; 3] = ["bug", "request", "question"];

/// 報告の1件（AI が書いた物。信用しない）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReportItem {
    /// bug（不具合）・request（要望）・question（質問）
    pub kind: String,
    /// どの画面のことか（AI が書いた1行。無ければ None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<String>,
    /// 内容（改行はそのまま。制御文字・見えない書式の文字は除いてある）
    pub text: String,
}

/// 承認待ちの報告（1回に何件か）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReportCandidate {
    pub candidate_id: String,
    pub received_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub items: Vec<IssueReportItem>,
}

/// 文をそろえる: 改行を \n に、タブを空白に、ほかの制御文字と見えない書式の文字を除き、行の後ろの空白と続く空行を詰める
fn tidy(s: &str) -> String {
    let s = s.replace("\r\n", "\n").replace('\r', "\n");
    let kept: String = s
        .chars()
        .filter_map(|c| match c {
            '\n' => Some('\n'),
            '\t' => Some(' '),
            c if c.is_control() || crate::hearing::is_format(c) => None,
            c => Some(c),
        })
        .collect();
    let mut out: Vec<&str> = Vec::new();
    let mut blank = 0;
    for line in kept.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push(line);
    }
    out.join("\n").trim().to_owned()
}

fn item(v: &Value, n: usize) -> Result<IssueReportItem, String> {
    let Value::Object(m) = v else {
        return Err(format!(
            "items の{n}件目は物（JSON の object）で書いてください。"
        ));
    };
    if let Some(k) = m
        .keys()
        .find(|k| !["kind", "screen", "text"].contains(&k.as_str()))
    {
        return Err(format!("items の{n}件目に知らない欄があります: {k}"));
    }
    let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
    if !KINDS.contains(&kind) {
        return Err(format!(
            "items の{n}件目の kind は bug（不具合）・request（要望）・question（質問）のどれかです。"
        ));
    }
    let text = tidy(
        m.get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("items の{n}件目の text に内容を書いてください。"))?,
    );
    if text.is_empty() {
        return Err(format!(
            "items の{n}件目の内容が空です（空の件は出せません。要らない件は外してください）。"
        ));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "items の{n}件目の内容は {MAX_TEXT_CHARS} 文字までです。"
        ));
    }
    let screen = match m.get("screen") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            let one: String = tidy(s).split_whitespace().collect::<Vec<_>>().join(" ");
            if one.chars().count() > MAX_SCREEN_CHARS {
                return Err(format!(
                    "items の{n}件目の screen（どの画面か）は {MAX_SCREEN_CHARS} 文字までです（例「結果」「入力」）。"
                ));
            }
            Some(one).filter(|s| !s.is_empty())
        }
        Some(_) => {
            return Err(format!(
                "items の{n}件目の screen（どの画面か）は文字で書いてください。"
            ))
        }
    };
    Ok(IssueReportItem {
        kind: kind.to_owned(),
        screen,
        text,
    })
}

/// 届いた報告の形を確かめる（Ok は件の並び。Err は AI に見せてよい理由）
pub fn validate(report: &Value) -> Result<Vec<IssueReportItem>, String> {
    let Value::Object(m) = report else {
        return Err("報告は物（JSON の object）で渡してください。".into());
    };
    if let Some(k) = m.keys().find(|k| k.as_str() != "items") {
        return Err(format!("報告に知らない欄があります: {k}"));
    }
    let list = m
        .get("items")
        .and_then(Value::as_array)
        .ok_or("items に報告の件を並べてください。")?;
    if list.is_empty() {
        return Err("items が空です（空の報告は出せません）。".into());
    }
    if list.len() > MAX_ITEMS {
        return Err(format!(
            "1回に出せるのは {MAX_ITEMS} 件までです。分けて出してください。"
        ));
    }
    let items = list
        .iter()
        .enumerate()
        .map(|(i, v)| item(v, i + 1))
        .collect::<Result<Vec<_>, _>>()?;
    let total: usize = items.iter().map(|i| i.text.chars().count()).sum();
    if total > MAX_TOTAL_CHARS {
        return Err(format!(
            "1回の報告の内容は合わせて {MAX_TOTAL_CHARS} 文字までです。分けて出してください。"
        ));
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn items_are_tidied_and_empty_reports_are_refused() {
        let items = validate(&json!({ "items": [
            { "kind": "bug", "text": "  一行目\r\n\r\n\r\n\r\n二行目\t終わり \u{200B}\u{202E}\u{7}  ", "screen": " 結果 \n のタブ " },
            { "kind": "request", "text": "要望" },
            { "kind": "question", "text": "質問", "screen": "" },
        ] }))
        .unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].text, "一行目\n\n二行目 終わり");
        assert_eq!(items[0].screen.as_deref(), Some("結果 のタブ"));
        assert!(items[1].screen.is_none() && items[2].screen.is_none());
        for bad in [
            json!({ "items": [] }),
            json!({ "items": [{ "kind": "bug", "text": "" }] }),
            json!({ "items": [{ "kind": "bug", "text": " \n\t \u{200B}" }] }),
            json!({ "items": [{ "kind": "bug", "text": "x" }, { "kind": "bug", "text": " " }] }),
            json!({ "items": [{ "kind": "bug" }] }),
            json!({}),
            json!({ "text": "x" }),
            json!("文"),
        ] {
            assert!(validate(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn kinds_limits_and_unknown_fields_are_refused() {
        assert!(
            validate(&json!({ "items": [{ "kind": "other", "text": "x" }] }))
                .unwrap_err()
                .contains("bug（不具合）")
        );
        assert!(validate(
            &json!({ "items": [{ "kind": "bug", "text": "あ".repeat(MAX_TEXT_CHARS) }] })
        )
        .is_ok());
        assert!(validate(
            &json!({ "items": [{ "kind": "bug", "text": "あ".repeat(MAX_TEXT_CHARS + 1) }] })
        )
        .is_err());
        let many: Vec<Value> = (0..=MAX_ITEMS)
            .map(|i| json!({ "kind": "request", "text": format!("要望{i}") }))
            .collect();
        assert!(validate(&json!({ "items": many }))
            .unwrap_err()
            .contains("20 件まで"));
        let big: Vec<Value> = (0..4)
            .map(|_| json!({ "kind": "bug", "text": "あ".repeat(MAX_TEXT_CHARS) }))
            .collect();
        assert!(validate(&json!({ "items": big }))
            .unwrap_err()
            .contains("合わせて"));
        assert!(validate(
            &json!({ "items": [{ "kind": "bug", "text": "x", "screen": "あ".repeat(41) }] })
        )
        .is_err());
        assert!(validate(
            &json!({ "items": [{ "kind": "bug", "text": "x", "url": "https://example.com" }] })
        )
        .unwrap_err()
        .contains("url"));
        assert!(
            validate(&json!({ "items": [{ "kind": "bug", "text": "x" }], "url": "u" }))
                .unwrap_err()
                .contains("url")
        );
    }
}
