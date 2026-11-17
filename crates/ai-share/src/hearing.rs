//! Web のヒアリング（0125・0192）を AI 接続口から使う所（0222）。
//!
//! - 発行（接続口の道具 `issue_hearing_url`）: アプリ本体は形の外側（大きさ・欄の名前・文字）と回数の上限だけを確かめ、発行そのものはアプリの画面に頼む
//!   （鍵の組・合言葉は画面が WebCrypto で作り、世帯ファイルか事務所データにだけ置く。0125 の2。接続口・アプリ本体の受け口は鍵を持たない）。
//!   画面に頼む所（`HearingIssuer`）はアプリ本体が入れ、画面の答えが来るまで `ISSUE_WAIT` まで待つ
//! - 回数の上限: 1時間に `HOURLY_LIMIT` 件（アプリを開いている間の数。発行できたものだけを数える）。世帯の決まっていない依頼の同時に受け付けている数の
//!   上限は、事務所データを持つ画面が数える（`UNASSIGNED_LIMIT`。画面の側の定数と同じ）
//! - 事務所のひな形の案（接続口の道具 `propose_hearing_template`）: 名前と選び方の形の外側を確かめて、メモリの中に承認待ちで置くだけ。
//!   事務所の既定値に入れるのは、FPが画面で「ひな形として保存する」を押したときの画面（ほかの事務所の既定値の案と同じ。0215）
//! - 選び方の中身（項目・票・独自の質問・書類・話題）は、接続口が案を出す前に・画面が発行と保存の前に、FP の画面と同じ関数
//!   （app/src/workspace/hearing/aiSelection.ts・hearing/src/web/packet.ts の checkSelection）で確かめる。ここでは信用しない入口として形だけを見る

use crate::households::clean_line;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Arc;
use std::time::Duration;

/// アプリ本体が画面の答えを待つ長さ（接続口の期限 `ai_ipc::client::ISSUE_HEARING_TIMEOUT` より短く）
pub const ISSUE_WAIT: Duration = Duration::from_secs(30);
/// 1時間に発行できる数（AI 接続口から。アプリを開いている間の数）
pub const HOURLY_LIMIT: usize = 10;
/// 同時に受け付けている、世帯の決まっていない依頼の数の上限（数えるのは画面。app/src/workspace/hearing/aiHearing.ts の同じ名前の定数と同じ）
pub const UNASSIGNED_LIMIT: usize = 20;
/// 承認待ちにしておける事務所のひな形の案の数
pub const MAX_TEMPLATE_PENDING: usize = 4;
/// 事務所のひな形の名前の長さ（画面の readHearingTemplates と同じ40文字）
pub const MAX_TEMPLATE_NAME: usize = 40;
/// 何のための問いか（お客さまの最初の画面。画面の officeFace と同じ120文字）
pub const MAX_PURPOSE: usize = 120;
/// AI が書いた理由の長さの上限（文字。ほかの案と同じ）
pub const MAX_NOTE_CHARS: usize = 500;
/// 選び方の JSON の大きさの上限（バイト。独自の質問10問・書類20通・話題20でも収まる大きさ）
pub const MAX_SELECTION_BYTES: usize = 64 * 1024;

/// 画面に頼む発行の1件（画面だけが鍵を作り、記録を書く）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HearingJob {
    /// 接続口が確かめた選び方（WebSelection）と、任意の何のための問いか
    pub issue: Value,
    /// 渡された世帯の依頼なら、その世帯（AIには返さない。画面が世帯ファイルに記録を置くため）。世帯の決まっていない依頼は None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household: Option<JobHousehold>,
    /// MCP のあいさつで AI のアプリが名乗った名前（自己申告。認証ではない）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub received_at: String,
}

/// 渡された世帯の依頼の世帯（AIには返さない）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHousehold {
    pub household_id: String,
    pub customer_number: Option<String>,
    pub share_id: String,
}

/// 画面に発行を頼む所（アプリ本体が入れる）。Ok は画面の答え（`{ ok: true, requestId, … }`）、Err は AI に見せてよい理由
pub type HearingIssuer = Arc<dyn Fn(HearingJob) -> Result<Value, String> + Send + Sync>;

/// 事務所の Web のヒアリングのひな形と話題（事務所データの defaults の hearingTemplates・hearingTopics）を読む所（アプリ本体が入れる）
pub type OfficeHearingSource = Arc<dyn Fn() -> Option<Value> + Send + Sync>;

/// 承認待ちの事務所のひな形の案（形だけを確かめて置く。信用しない。画面が同じ関数で確かめ直してから出す）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HearingTemplateCandidate {
    pub candidate_id: String,
    pub received_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub name: String,
    pub selection: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 人の書いた1行の文の確かめ（制御文字・見えない書式の文字は断る。空と長すぎも断る）
fn line(v: &Value, what: &str, max: usize) -> Result<String, String> {
    let s = v
        .as_str()
        .ok_or_else(|| format!("{what}は文字で書いてください。"))?;
    if s.chars().any(|c| c.is_control() || is_format(c)) {
        return Err(format!(
            "{what}に、改行・タブなどの制御文字や見えない書式の文字は使えません。"
        ));
    }
    let t = s.trim();
    if t.is_empty() {
        return Err(format!("{what}が空です。"));
    }
    if t.chars().count() > max {
        return Err(format!("{what}は{max}文字までです。"));
    }
    Ok(t.to_owned())
}

/// 見えない書式の文字（幅の無い空白・向きを変える印・行の区切りなど。Unicode の Cf と行・段落の区切り）
fn is_format(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{0600}'..='\u{0605}' | '\u{061C}' | '\u{06DD}' | '\u{070F}' | '\u{180E}'
        | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2028}' | '\u{2029}'
        | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}'
        | '\u{E0001}' | '\u{E0020}'..='\u{E007F}')
}

/// 選び方（WebSelection）の形の外側: 物で、決まった欄だけ・大きさの上限まで
fn selection(v: &Value) -> Result<Value, String> {
    let Value::Object(m) = v else {
        return Err("selection は物（JSON の object）で書いてください。".into());
    };
    // WebSelection の欄（hearing/src/web/packet.ts。足すときはここにも足す）
    const KEYS: [&str; 6] = ["base", "sections", "custom", "documents", "topics", "name"];
    if let Some(k) = m.keys().find(|k| !KEYS.contains(&k.as_str())) {
        return Err(format!("selection に知らない欄があります: {k}"));
    }
    for k in ["base", "sections", "custom", "documents"] {
        if !m.contains_key(k) {
            return Err(format!("selection に {k} がありません。"));
        }
    }
    let bytes = serde_json::to_vec(v).map(|b| b.len()).unwrap_or(usize::MAX);
    if bytes > MAX_SELECTION_BYTES {
        return Err("selection が大きすぎます。".into());
    }
    Ok(v.clone())
}

/// 発行の依頼（`{ selection, purpose? }`）の形の外側を確かめて、そろえた物を返す
pub fn validate_issue(issue: &Value) -> Result<Value, String> {
    let Value::Object(m) = issue else {
        return Err("発行の依頼の形が違います。".into());
    };
    if let Some(k) = m
        .keys()
        .find(|k| !["selection", "purpose"].contains(&k.as_str()))
    {
        return Err(format!("発行の依頼に知らない欄があります: {k}"));
    }
    let sel = selection(m.get("selection").unwrap_or(&Value::Null))?;
    let mut out = Map::new();
    out.insert("selection".into(), sel);
    if let Some(p) = m.get("purpose").filter(|p| !p.is_null()) {
        out.insert(
            "purpose".into(),
            Value::String(line(p, "purpose（何のための問いか）", MAX_PURPOSE)?),
        );
    }
    Ok(Value::Object(out))
}

/// 選び方に見直し（今の値を見せて確かめてもらう項目。mode が confirm）があるか
pub fn has_review(selection: &Value) -> bool {
    selection["sections"].as_array().is_some_and(|secs| {
        secs.iter().any(|s| {
            s["items"]
                .as_array()
                .is_some_and(|items| items.iter().any(|i| i["mode"] == "confirm"))
        })
    })
}

/// 事務所のひな形の案（`{ name, selection, note? }`）の形の外側を確かめる
pub fn validate_template(proposal: &Value) -> Result<(String, Value, Option<String>), String> {
    let Value::Object(m) = proposal else {
        return Err("ひな形の案の形が違います。".into());
    };
    if let Some(k) = m
        .keys()
        .find(|k| !["name", "selection", "note"].contains(&k.as_str()))
    {
        return Err(format!("ひな形の案に知らない欄があります: {k}"));
    }
    let name = line(
        m.get("name").unwrap_or(&Value::Null),
        "name（ひな形の名前）",
        MAX_TEMPLATE_NAME,
    )?;
    let sel = selection(m.get("selection").unwrap_or(&Value::Null))?;
    let note = match m.get("note") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            if s.chars().count() > MAX_NOTE_CHARS {
                return Err(format!("note は{MAX_NOTE_CHARS}文字までです。"));
            }
            Some(clean_line(s)).filter(|n| !n.is_empty())
        }
        Some(_) => return Err("note は文字で書いてください。".into()),
    };
    Ok((name, sel, note))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sel() -> Value {
        json!({ "base": { "sheetId": "basic", "version": 3 }, "sections": [], "custom": [], "documents": [], "topics": [], "name": "シンプル" })
    }

    #[test]
    fn issue_shape() {
        let ok = validate_issue(&json!({ "selection": sel(), "purpose": " 面談の前に " })).unwrap();
        assert_eq!(ok["purpose"], "面談の前に");
        assert!(validate_issue(&json!({ "selection": sel(), "url": "x" })).is_err());
        assert!(validate_issue(&json!({ "selection": { "base": {} } })).is_err());
        let mut extra = sel();
        extra["secrets"] = json!("x");
        assert!(validate_issue(&json!({ "selection": extra })).is_err());
        assert!(validate_issue(&json!({ "selection": sel(), "purpose": "改行\nあり" })).is_err());
        assert!(
            validate_issue(&json!({ "selection": sel(), "purpose": "あ".repeat(121) })).is_err()
        );
        assert!(
            validate_issue(&json!({ "selection": sel(), "purpose": "あ".repeat(120) })).is_ok()
        );
    }

    #[test]
    fn template_shape() {
        let (name, _, note) = validate_template(
            &json!({ "name": "初回の面談の前", "selection": sel(), "note": "よく使う" }),
        )
        .unwrap();
        assert_eq!(name, "初回の面談の前");
        assert_eq!(note.as_deref(), Some("よく使う"));
        assert!(validate_template(&json!({ "name": "", "selection": sel() })).is_err());
        assert!(
            validate_template(&json!({ "name": "あ".repeat(41), "selection": sel() })).is_err()
        );
        assert!(
            validate_template(&json!({ "name": "見えない\u{200B}文字", "selection": sel() }))
                .is_err()
        );
        assert!(validate_template(&json!({ "name": "名前", "selection": sel(), "x": 1 })).is_err());
    }

    #[test]
    fn selection_size_limit() {
        let mut big = sel();
        big["topics"] = json!(vec!["あ".repeat(100); 300]);
        assert!(validate_issue(&json!({ "selection": big })).is_err());
    }
}
