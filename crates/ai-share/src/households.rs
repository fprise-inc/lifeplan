//! AIが組み立てた新しい世帯の候補（接続口の道具 `propose_household`）。
//!
//! - 届いた候補は、アプリのメモリの中に承認待ちで置くだけ。世帯は作らない（世帯の一覧も変わらない）。FPが画面で中身を確かめて
//!   「世帯として作る」を押したときだけ、アプリ本体が世帯を作る。アプリを閉じると、作っていない候補は消える
//! - ここでは形の外側（知っている欄だけを読む・架空かお客さまか・題と推定したことの文字の長さ・入力の大きさと形の骨組み）を確かめる。
//!   入力の中身（欄・値・範囲）は、アプリ本体が入れる確かめ（`ShareRegistry::set_household_check`。計算エンジンのスキーマと同じ）で
//!   もう一度確かめる。文字の欄の番号らしい所を消す決まりは、画面の読み口（書類の候補と同じ `documents/privacy.ts`）の1か所で行う
//! - 世帯を渡していなくてよい（新しい世帯なので、お客さまの情報を AI から受け取るだけ）。AI接続口がオンのときだけ受け口が開いている

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 世帯の種類: 架空（セミナー・研修に使う。お客さまの情報を含まない）とお客さま
pub const KINDS: [&str; 2] = ["fictional", "client"];
/// 題の長さの上限（文字）
pub const MAX_TITLE_CHARS: usize = 60;
/// 推定したことの文の長さの上限（文字）
pub const MAX_NOTE_CHARS: usize = 1000;
/// 計算の入力の大きさの上限（JSON にしたときのバイト数。内部の値）
pub const MAX_INPUT_BYTES: usize = 512 * 1024;
/// 家族の人数の上限（内部の値。世帯の外の家族を含む）
pub const MAX_MEMBERS: usize = 30;
/// 入れ子の深さの上限（内部の値）
pub const MAX_DEPTH: usize = 64;
/// 承認待ちにしておける候補の数（内部の値）
pub const MAX_PENDING: usize = 5;
/// AIのアプリの名乗りの長さの上限（文字。画面と記録に出す）
const MAX_CONNECTOR_CHARS: usize = 80;

/// 承認待ちの新しい世帯の候補（届いたものを形だけ確かめて置く。信用しない。画面の読み口で確かめてから使う）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdCandidate {
    pub candidate_id: String,
    pub received_at: String,
    /// MCP のあいさつでAIのアプリが名乗った名前（自己申告。認証ではない）
    pub connector: Option<String>,
    /// AIが選んだ種類（`fictional`・`client`）。FPは作る前に画面で変えられる
    pub kind: String,
    /// AIが書いた題（指示ではない。画面では文字のまま出す）
    pub title: String,
    /// AIが書いた、推定したこと（指示ではない。無ければ None）
    pub note: Option<String>,
    /// 計算の入力（calculate の input と同じ形）
    pub input: Value,
}

/// 確かめた候補の中身（種類・題・推定したこと・入力）
pub(crate) struct Checked {
    pub kind: String,
    pub title: String,
    pub note: Option<String>,
    pub input: Value,
}

/// 文字を整える: 制御文字（改行・タブを含む）を空白にし、続く空白を1つにして、前後の空白を外す
pub(crate) fn clean_line(s: &str) -> String {
    let replaced: String = s
        .chars()
        .map(|c| {
            if c.is_control() || c == '\u{2028}' || c == '\u{2029}' {
                ' '
            } else {
                c
            }
        })
        .collect();
    replaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// AIのアプリの名乗りを、画面と記録に出す形にする（長すぎれば切る）
pub(crate) fn clean_connector(s: Option<&str>) -> Option<String> {
    let c = clean_line(s?);
    (!c.is_empty()).then(|| c.chars().take(MAX_CONNECTOR_CHARS).collect())
}

fn depth(v: &Value) -> usize {
    match v {
        Value::Array(a) => 1 + a.iter().map(depth).max().unwrap_or(0),
        Value::Object(m) => 1 + m.values().map(depth).max().unwrap_or(0),
        _ => 0,
    }
}

/// 候補の外側を確かめる。外れたら AI に見せてよい理由（`INVALID`。値・文字は入れない）
pub(crate) fn validate(proposal: &Value) -> Result<Checked, String> {
    let Value::Object(m) = proposal else {
        return Err("候補は物（JSON の object）にしてください".into());
    };
    // 知っている欄だけを読む（ほかの欄は捨てる）
    let kind = match m.get("kind").and_then(Value::as_str) {
        Some(k) if KINDS.contains(&k) => k.to_owned(),
        _ => return Err("kind は fictional（架空）か client（お客さま）にしてください".into()),
    };
    let title = match m.get("title").and_then(Value::as_str).map(clean_line) {
        Some(t) if !t.is_empty() && t.chars().count() <= MAX_TITLE_CHARS => t,
        Some(t) if !t.is_empty() => {
            return Err(format!("title は{MAX_TITLE_CHARS}文字までにしてください"))
        }
        _ => return Err("title（世帯の短い題）を入れてください".into()),
    };
    let note = match m.get("note") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            let n = clean_line(s);
            if n.chars().count() > MAX_NOTE_CHARS {
                return Err(format!("note は{MAX_NOTE_CHARS}文字までにしてください"));
            }
            (!n.is_empty()).then_some(n)
        }
        Some(_) => return Err("note は文字にしてください".into()),
    };
    let input = m.get("input").cloned().unwrap_or(Value::Null);
    if !input.is_object() {
        return Err("input は計算の入力（calculate の input と同じ形の物）にしてください".into());
    }
    let bytes = serde_json::to_vec(&input).map_or(usize::MAX, |b| b.len());
    if bytes > MAX_INPUT_BYTES {
        return Err(format!(
            "input が大きすぎます（{MAX_INPUT_BYTES} バイトまで）"
        ));
    }
    if depth(&input) > MAX_DEPTH {
        return Err("input の入れ子が深すぎます".into());
    }
    let members = input
        .get("household")
        .and_then(|h| h.get("members"))
        .and_then(Value::as_array);
    match members {
        Some(a) if !a.is_empty() && a.len() <= MAX_MEMBERS => {}
        Some(a) if !a.is_empty() => {
            return Err(format!(
                "家族（household.members）は{MAX_MEMBERS}人までです"
            ))
        }
        _ => return Err("input.household.members に家族を1人以上入れてください".into()),
    }
    Ok(Checked {
        kind,
        title,
        note,
        input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn proposal() -> Value {
        json!({
            "kind": "fictional",
            "title": "  セミナー用の\n架空の世帯 ",
            "note": "妻の年収は\t扶養の範囲で推定",
            "input": { "household": { "members": [{ "id": "x" }] } },
            "extra": "読まない欄"
        })
    }

    #[test]
    fn reads_known_fields_and_cleans_text() {
        let c = validate(&proposal()).unwrap();
        assert_eq!(c.kind, "fictional");
        assert_eq!(c.title, "セミナー用の 架空の世帯");
        assert_eq!(c.note.as_deref(), Some("妻の年収は 扶養の範囲で推定"));
        assert_eq!(c.input, proposal()["input"]);
    }

    #[test]
    fn refuses_bad_shapes() {
        let with = |k: &str, v: Value| {
            let mut p = proposal();
            p[k] = v;
            validate(&p).err().unwrap_or_default()
        };
        assert!(with("kind", json!("sample")).contains("kind"));
        assert!(with("kind", Value::Null).contains("kind"));
        assert!(with("title", json!("   ")).contains("title"));
        assert!(with("title", json!("あ".repeat(MAX_TITLE_CHARS + 1))).contains("60"));
        assert!(with("note", json!(3)).contains("note"));
        assert!(with("note", json!("あ".repeat(MAX_NOTE_CHARS + 1))).contains("1000"));
        assert!(with("input", json!([1])).contains("input"));
        assert!(with("input", json!({ "household": { "members": [] } })).contains("members"));
        let many = vec![json!({}); MAX_MEMBERS + 1];
        assert!(with("input", json!({ "household": { "members": many } })).contains("30"));
        let big = json!({ "household": { "members": [{}] }, "pad": "x".repeat(MAX_INPUT_BYTES) });
        assert!(with("input", big).contains("大きすぎ"));
        let mut deep = json!(1);
        for _ in 0..(MAX_DEPTH + 1) {
            deep = json!([deep]);
        }
        let deep = json!({ "household": { "members": [{}] }, "d": deep });
        assert!(with("input", deep).contains("深すぎ"));
        assert!(validate(&json!("x")).is_err());
        // 推定したことは省ける（空の文字も無いのと同じ）
        let mut p = proposal();
        p["note"] = json!(" ");
        assert_eq!(validate(&p).unwrap().note, None);
    }

    #[test]
    fn connector_names_are_cleaned() {
        assert_eq!(
            clean_connector(Some(" A\nB 1.0 ")).as_deref(),
            Some("A B 1.0")
        );
        assert_eq!(clean_connector(Some(" ")), None);
        assert_eq!(clean_connector(None), None);
        assert_eq!(
            clean_connector(Some(&"x".repeat(200)))
                .unwrap()
                .chars()
                .count(),
            80
        );
    }
}
