//! 表示の設定の案（接続口の道具 `propose_display_settings`。0215）。AI が出した、事務所の既定値の見せ方だけの設定の案を、アプリのメモリの中に
//! 承認待ちで置くだけ。設定は変えない（FPが画面で設定ごとに「今 → 案」を確かめて「反映する」を押したときだけ、画面が事務所の既定値に書く）。
//! アプリを閉じると、判断していない案は消える。
//!
//! - ここでは形の外側を確かめる: 案を出せる設定（`PROPOSABLE_IDS`。事務所の既定値の見せ方だけの18件。0213 の段C で結果のタブ・資産と負債のタブの
//!   表示の設定の事務所の既定値11件を足した）・同じ設定が2回無いこと・値の大きさと深さ・
//!   文字（列挙の鍵などの短い英数字だけ。基本生活費の内訳の並べ方の行の名前だけは、制御文字・書式の文字を含まない20文字までの文字を通す）・
//!   理由の長さ。選べる値・値の形は、接続口が案を出す前に、画面が反映する前に、同じ関数（app/src/connector/displayProposal.ts）で確かめる
//! - 世帯を渡していなくてよい（事務所の既定値は世帯の中身ではない。AIに渡した記録にも残さない）

use crate::households::clean_line;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 案を出せる表示の設定（接続口の表示の設定の一覧の `proposable` と同じ。crates/lifeplan のテストで確かめる）
pub const PROPOSABLE_IDS: [&str; 18] = [
    "input.order",
    "input.items",
    "input.living",
    "result.levers",
    "result.metrics",
    "result.atAge",
    "result.layout",
    "result.invBreakdown",
    "result.invPeriods",
    "contingency.premises",
    "contingency.scenes",
    "contingency.openScene",
    "balance.health",
    "balance.guide",
    "balance.points",
    "balance.moneyThree.wording",
    "balance.moneyThree.months",
    "balance.moneyThree.years",
];
/// 承認待ちにしておける案の数
pub const MAX_PENDING: usize = 4;
/// AI が書いた理由の長さの上限（文字。プランの候補の理由と同じ）
pub const MAX_NOTE_CHARS: usize = 500;
/// 基本生活費の内訳の並べ方の行の名前の長さの上限（画面の LIVING_LABEL_MAX と同じ。数え方も画面と同じ UTF-16 の数）
pub const MAX_LABEL_UNITS: usize = 20;
/// 1つの値の大きさの上限（JSON にしたときのバイト数。内部の値）
const MAX_VALUE_BYTES: usize = 16 * 1024;
/// 入れ子の深さの上限（内部の値。基本生活費の内訳の並べ方の分けた行で4）
const MAX_DEPTH: usize = 6;
/// 列挙の鍵などの文字の長さの上限
const MAX_KEY: usize = 40;

/// 案の1つの設定（値は get_display_settings の今の値と同じ形。理由は AI が書いた文章で、指示ではない）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayChange {
    pub id: String,
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 承認待ちの表示の設定の案（届いたものを形だけ確かめて置く。信用しない。画面が確かめ直してから「今 → 案」を出す）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCandidate {
    pub candidate_id: String,
    pub received_at: String,
    /// MCP のあいさつでAIのアプリが名乗った名前（自己申告。認証ではない）
    pub connector: Option<String>,
    /// 設定ごとの案（FPが反映した・捨てた設定は外す。全部外したら案ごと外す）
    pub changes: Vec<DisplayChange>,
}

/// 印字できる英数字・記号だけの短い文字か
fn plain(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_KEY && s.bytes().all(|c| (0x21..=0x7e).contains(&c))
}

/// 人が書いた行の名前として通してよい文字か（制御文字・書式の文字・行の区切りを含まず、UTF-16 で20まで）
fn label_ok(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty()
        && t.encode_utf16().count() <= MAX_LABEL_UNITS
        && !s.chars().any(|c| {
            c.is_control()
                || matches!(
                    c,
                    '\u{2028}' | '\u{2029}' | '\u{00ad}' | '\u{061c}' | '\u{180e}' | '\u{feff}'
                )
                || ('\u{200b}'..='\u{200f}').contains(&c)
                || ('\u{202a}'..='\u{202e}').contains(&c)
                || ('\u{2060}'..='\u{206f}').contains(&c)
                || ('\u{fff9}'..='\u{fffb}').contains(&c)
        })
}

fn depth(v: &Value) -> usize {
    match v {
        Value::Array(a) => 1 + a.iter().map(depth).max().unwrap_or(0),
        Value::Object(m) => 1 + m.values().map(depth).max().unwrap_or(0),
        _ => 0,
    }
}

/// 値の中の文字と鍵を確かめる（labels は行の名前を受ける設定か。受けるのは `label` の鍵の値だけ）
fn strings_ok(v: &Value, labels: bool, key: Option<&str>) -> bool {
    match v {
        Value::String(s) => plain(s) || (labels && key == Some("label") && label_ok(s)),
        Value::Array(a) => a.iter().all(|x| strings_ok(x, labels, key)),
        Value::Object(m) => m
            .iter()
            .all(|(k, x)| plain(k) && strings_ok(x, labels, Some(k))),
        Value::Null | Value::Bool(_) | Value::Number(_) => true,
    }
}

/// 案（`{ changes: [{ id, value, note? }] }`）の形の外側を確かめる。Err は AI に見せてよい理由
pub fn validate(proposal: &Value) -> Result<Vec<DisplayChange>, String> {
    let o = proposal
        .as_object()
        .ok_or("案の形が違います（{ changes: [...] }）。")?;
    if let Some(k) = o.keys().find(|k| k.as_str() != "changes") {
        return Err(format!(
            "案に知らない名前があります: {k}（書けるのは changes だけ）。"
        ));
    }
    let list = o
        .get("changes")
        .and_then(Value::as_array)
        .ok_or("changes に、変える設定を1件以上書いてください。")?;
    if list.is_empty() || list.len() > PROPOSABLE_IDS.len() {
        return Err(format!(
            "changes は1〜{}件です（同じ設定は1回だけ）。",
            PROPOSABLE_IDS.len()
        ));
    }
    let mut out: Vec<DisplayChange> = Vec::with_capacity(list.len());
    for (i, c) in list.iter().enumerate() {
        let c = c
            .as_object()
            .ok_or_else(|| format!("changes[{i}] の形が違います（{{ id, value, note? }}）。"))?;
        if let Some(k) = c
            .keys()
            .find(|k| !matches!(k.as_str(), "id" | "value" | "note"))
        {
            return Err(format!(
                "changes[{i}] に知らない名前があります: {k}（書けるのは id・value・note）。"
            ));
        }
        let id = c.get("id").and_then(Value::as_str).unwrap_or("").trim();
        if !PROPOSABLE_IDS.contains(&id) {
            return Err(format!(
                "changes[{i}] の設定（{id}）は、案を出せる設定ではありません。案を出せるのは {} です。",
                PROPOSABLE_IDS.join("・")
            ));
        }
        if out.iter().any(|x| x.id == id) {
            return Err(format!("{id} が2回あります（1つの設定には1つの案）。"));
        }
        let value = c
            .get("value")
            .ok_or_else(|| format!("{id} の value がありません。"))?;
        let bytes = serde_json::to_vec(value)
            .map(|b| b.len())
            .unwrap_or(usize::MAX);
        if bytes > MAX_VALUE_BYTES || depth(value) > MAX_DEPTH {
            return Err(format!("{id} の値が大きすぎます。"));
        }
        if !strings_ok(value, id == "input.living", None) {
            return Err(format!(
                "{id} の値に使えない文字があります（選べる値の鍵と、基本生活費の内訳の行の名前〔{MAX_LABEL_UNITS}文字まで。改行などの制御文字は使えない〕だけ）。"
            ));
        }
        let note = match c.get("note") {
            None | Some(Value::Null) => None,
            Some(Value::String(n)) => {
                if n.chars().count() > MAX_NOTE_CHARS {
                    return Err(format!("{id} の note は{MAX_NOTE_CHARS}文字までです。"));
                }
                Some(clean_line(n)).filter(|n| !n.is_empty())
            }
            Some(_) => return Err(format!("{id} の note は文字で書いてください。")),
        };
        out.push(DisplayChange {
            id: id.to_owned(),
            value: value.clone(),
            note,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn living(label: &str) -> Value {
        json!({ "changes": [{ "id": "input.living", "value": { "rows": [
            { "kind": "group", "label": label, "categories": ["food", "utilities"] },
            { "kind": "one", "category": "other" }
        ] } }] })
    }

    #[test]
    fn only_the_office_display_settings_are_accepted() {
        let ok = validate(&json!({ "changes": [
            { "id": "result.levers", "value": ["lever:retireAge", "lever:nisaMonthly"], "note": " NISA を\n出す " },
            { "id": "contingency.openScene", "value": "income" },
            // 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値（0213 の段C）
            { "id": "result.atAge", "value": 90 },
            { "id": "result.invPeriods", "value": null },
            { "id": "balance.guide", "value": { "basis": "living", "months": [3, 9], "risk": [5, 30], "debt": 40 } },
            { "id": "balance.points", "value": ["now", "age80"] }
        ] }))
        .unwrap();
        assert_eq!(ok.len(), 6);
        assert_eq!(ok[0].note.as_deref(), Some("NISA を 出す"));
        assert_eq!(ok[1].note, None);
        // 世帯だけの設定（この世帯で並べる時点・対策に足した項目）・読むだけの設定・知らない id
        for id in [
            "balance.columns",
            "result.addedItems",
            "features.combinedBs",
            "assumptions.inflation",
        ] {
            let e = validate(&json!({ "changes": [{ "id": id, "value": true }] })).unwrap_err();
            assert!(e.contains("案を出せる設定ではありません"), "{id}: {e}");
        }
        // 空・多すぎる・重複・知らない名前
        assert!(validate(&json!({ "changes": [] })).is_err());
        let many: Vec<Value> = (0..19)
            .map(|_| json!({ "id": "input.order", "value": [] }))
            .collect();
        assert!(validate(&json!({ "changes": many }))
            .unwrap_err()
            .contains("1〜18件"));
        let e = validate(&json!({ "changes": [
            { "id": "contingency.scenes", "value": ["death"] },
            { "id": "contingency.scenes", "value": ["income"] }
        ] }))
        .unwrap_err();
        assert!(e.contains("2回"), "{e}");
        assert!(validate(
            &json!({ "changes": [{ "id": "input.order", "value": [], "why": "x" }] })
        )
        .unwrap_err()
        .contains("why"));
        assert!(validate(&json!({ "changes": [{ "id": "input.order" }] }))
            .unwrap_err()
            .contains("value"));
        assert!(validate(&json!({ "changes": [], "title": "x" }))
            .unwrap_err()
            .contains("title"));
        // 理由の長さ
        let long = "あ".repeat(MAX_NOTE_CHARS + 1);
        assert!(validate(
            &json!({ "changes": [{ "id": "input.order", "value": [], "note": long }] })
        )
        .is_err());
    }

    #[test]
    fn labels_are_limited_to_twenty_plain_characters() {
        // 20文字ちょうどは通り、21文字は断る
        assert!(validate(&living(&"食".repeat(20))).is_ok());
        assert!(validate(&living(&"食".repeat(21))).is_err());
        // 制御文字・見えない書式の文字・行の区切りは通さない
        for bad in [
            "食費\n光熱",
            "食費\u{200b}",
            "食費\u{202e}",
            "食費\u{2028}",
            "食費\t",
        ] {
            assert!(validate(&living(bad)).is_err(), "{bad:?}");
        }
        // 行の名前のほかの所（鍵・内訳の種類）は英数字だけ。行の名前の形の文字も、行の名前を受けない設定では通さない
        let v = json!({ "changes": [{ "id": "result.levers", "value": ["対策"] }] });
        assert!(validate(&v).is_err());
        let v = json!({ "changes": [{ "id": "input.living", "value": { "rows": [{ "kind": "one", "category": "食費" }] } }] });
        assert!(validate(&v).is_err());
        let v = json!({ "changes": [{ "id": "input.items", "value": { "label": "名前" } }] });
        assert!(validate(&v).is_err());
        // 大きすぎる・深すぎる値
        let big: Vec<Value> = (0..3000).map(|_| json!("lever:retireAge")).collect();
        assert!(
            validate(&json!({ "changes": [{ "id": "result.levers", "value": big }] })).is_err()
        );
        let deep = json!({ "changes": [{ "id": "input.living", "value": [[[[[[[["x"]]]]]]]] }] });
        assert!(validate(&deep).is_err());
    }
}
