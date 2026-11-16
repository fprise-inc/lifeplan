//! 表示の設定を AI接続口に渡すときの切り出し（get_display_settings。0213）。読むだけで、何も書かない。
//!
//! - 事務所の既定値（`office_display_of`）: 事務所データの `defaults` のうち、値も計算も変えない見せ方の欄だけを、名前で選んで写す
//!   （入力項目の並び `layout`・新しい世帯で出す入力項目 `items`・基本生活費の内訳の並べ方 `living`・対策に最初から出す項目 `levers`・
//!   万一のタブの想定の前提 `premises` と場面の帯 `scenes`・結果のタブと資産と負債のタブの表示の設定の事務所の既定値 `display`〔0213 の段C〕・
//!   合算BS を使うか `features.combinedBs`）。AI の案を反映する前の値（`displayHistory`）は写さない。計算の結果を変える欄
//!   （前提条件の標準値・必要保障額の数え方・介護・相続の見込み・不動産の評価の割合・表の最後の年齢・FP顧問料の料金表・推定の値）、
//!   名前・ロゴ・色（branding）、ヒアリングのひな形と話題は、ここを通らない（知らない欄も通さない）
//! - 渡された世帯（`household_display_of`）: 世帯ファイルの本文のうち、結果のタブ・資産と負債のタブの表示の設定（`display`）、
//!   入力項目の選び方（`household.itemChoice`）、対策に足した項目（`workspace.shownItems`）だけ。値は数・真偽・短い英数字の文字だけを通す
//!   （人が書いた文章が入る経路を作らない）。対策に足した項目の鍵の中の物の ID は、共有ごとの仮の ID に置き換える（`with_pseudonyms`）

use crate::reduce::{is_uuid, Pseudonyms};
use serde_json::{json, Map, Value};

/// 事務所データの `defaults` から写す、見せ方だけの欄
pub const OFFICE_DISPLAY_KEYS: [&str; 7] = [
    "layout", "items", "living", "levers", "premises", "scenes", "display",
];

/// 事務所の既定値の見せ方だけの欄の、機能を有効にするコードで使えるようになる機能（`features` の中で写す物）
pub const DISPLAY_FEATURES: [&str; 1] = ["combinedBs"];

/// 渡された世帯から読む見せ方の区画（AIに渡した記録の項目）
pub const HOUSEHOLD_DISPLAY_ITEMS: [&str; 4] = [
    "display.result",
    "display.balance",
    "household.itemChoice",
    "workspace.shownItems",
];

/// 事務所データの `defaults`（アプリ本体が復号した物）から、見せ方だけの欄を切り出す。`active` は今使える機能（機能を有効にするコード）。
/// 答えは `{ layout?, items?, living?, levers?, premises?, scenes?, display?, features: { combinedBs }, featureCodes: [使える機能] }`
pub fn office_display_of(defaults: &Value, active: &[String]) -> Value {
    let mut out = Map::new();
    for k in OFFICE_DISPLAY_KEYS {
        if let Some(v) = defaults.get(k).filter(|v| v.is_object()) {
            out.insert(k.to_owned(), v.clone());
        }
    }
    let mut features = Map::new();
    for f in DISPLAY_FEATURES {
        let on = defaults
            .get("features")
            .and_then(|x| x.get(f))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        features.insert(f.to_owned(), json!(on));
    }
    out.insert("features".into(), Value::Object(features));
    let codes: Vec<&str> = DISPLAY_FEATURES
        .iter()
        .copied()
        .filter(|f| active.iter().any(|a| a == f))
        .collect();
    out.insert("featureCodes".into(), json!(codes));
    Value::Object(out)
}

/// 文字の上限（見せ方の値は列挙の鍵・決まった年などの短い英数字だけ）
const MAX_TEXT: usize = 40;
/// 対策に足した項目の鍵の上限（動かす項目の鍵。物の ID と入力の欄の道を含む）
const MAX_KEY: usize = 200;
const MAX_ITEMS: usize = 200;
const MAX_DEPTH: usize = 6;

/// 印字できる英数字・記号だけの短い文字か（日本語・空白・改行を含む文字は通さない）
fn plain(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|c| (0x21..=0x7e).contains(&c))
}

/// 見せ方の値を、数・真偽・null・短い英数字の文字と、その並び・入れ物だけにする（ほかは落とす）
fn clean(v: &Value, depth: usize) -> Option<Value> {
    match v {
        Value::Null | Value::Bool(_) | Value::Number(_) => Some(v.clone()),
        Value::String(s) => plain(s, MAX_TEXT).then(|| v.clone()),
        Value::Array(a) if depth < MAX_DEPTH => Some(Value::Array(
            a.iter()
                .take(MAX_ITEMS)
                .filter_map(|x| clean(x, depth + 1))
                .collect(),
        )),
        Value::Object(m) if depth < MAX_DEPTH => Some(Value::Object(
            m.iter()
                .filter(|(k, _)| plain(k, MAX_TEXT))
                .filter_map(|(k, x)| clean(x, depth + 1).map(|x| (k.clone(), x)))
                .collect(),
        )),
        _ => None,
    }
}

/// 世帯ファイルの本文から、見せ方の区画だけを切り出す（共有の元に持つ。物の ID は元のまま）
pub fn household_display_of(body: &Map<String, Value>) -> Value {
    let display = body
        .get("display")
        .and_then(|d| clean(d, 0))
        .unwrap_or_else(|| json!({}));
    let item_choice = body
        .get("household")
        .and_then(|h| h.get("itemChoice"))
        .and_then(|c| clean(c, 0))
        .unwrap_or(Value::Null);
    let shown: Vec<Value> = body
        .get("workspace")
        .and_then(|w| w.get("shownItems"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter(|s| plain(s, MAX_KEY))
                .take(MAX_ITEMS)
                .map(|s| json!(s))
                .collect()
        })
        .unwrap_or_default();
    json!({ "display": display, "itemChoice": item_choice, "shownItems": shown })
}

/// 鍵の中の物の ID（乱数ID の形の部分）を、共有ごとの仮の ID に置き換える。この共有の世帯に無い ID を含む鍵は None（渡さない）
fn pseudonymize_key(key: &str, p: &Pseudonyms) -> Option<String> {
    let mut out = String::with_capacity(key.len());
    let mut i = 0;
    while i < key.len() {
        if let Some(cand) = key.get(i..i + 36) {
            if is_uuid(cand) {
                out.push_str(p.alias_of(cand)?);
                i += 36;
                continue;
            }
        }
        let c = key[i..].chars().next()?;
        out.push(c);
        i += c.len_utf8();
    }
    Some(out)
}

/// 共有の元の見せ方の区画を、AIに渡す形にする（対策に足した項目の鍵の物の ID を仮の ID に。置き換えられない鍵は落とす）
pub fn with_pseudonyms(raw: &Value, p: &Pseudonyms) -> Value {
    let mut v = raw.clone();
    let shown: Vec<Value> = raw["shownItems"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter_map(|k| pseudonymize_key(k, p))
                .map(Value::String)
                .collect()
        })
        .unwrap_or_default();
    v["shownItems"] = Value::Array(shown);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_display_cuts_only_the_display_keys() {
        let defaults = json!({
            "layout": { "order": ["work", "family"] },
            "items": { "hidden": ["rental"] },
            "levers": { "shown": ["lever:nisaMonthly"] },
            "premises": {}, "scenes": { "open": "income" },
            "living": { "rows": [{ "kind": "one", "category": "food", "label": "食費（自炊と外食）" }] },
            "display": { "result": { "atAge": 90 }, "balance": { "moneyThree": { "months": 3 } } },
            "displayHistory": { "result.atAge": [{ "value": 95, "at": "2026-11-15T00:00:00Z", "reason": "ai" }] },
            "assumptions": { "inflation": "0.02" },
            "estimates": { "noFill": ["livingExpense.monthly"] },
            "protection": { "horizon": { "kind": "age", "age": 90 } },
            "care": { "selfAndSpouse": "fill" }, "inheritLikelihood": "uncertain", "realEstateRatio": "0.7",
            "endAge": 95, "fee": { "oneTime": 1 }, "changedOn": "2026-11-01",
            "branding": { "name": "事務所" }, "hearingTemplates": [{ "name": "x" }], "hearingTopics": ["相談"],
            "features": { "combinedBs": true, "other": true },
        });
        let v = office_display_of(&defaults, &["combinedBs".to_owned()]);
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "display",
                "featureCodes",
                "features",
                "items",
                "layout",
                "levers",
                "living",
                "premises",
                "scenes"
            ]
        );
        assert_eq!(v["features"], json!({ "combinedBs": true }));
        assert_eq!(v["featureCodes"], json!(["combinedBs"]));
        // コードが無ければ使える機能は空。設定の値はそのまま（効くかは画面と同じくコードで決まる）
        let v = office_display_of(&defaults, &[]);
        assert_eq!(v["featureCodes"], json!([]));
        assert_eq!(v["features"]["combinedBs"], true);
        // 欄の無い事務所データ
        assert_eq!(
            office_display_of(&json!({}), &[]),
            json!({ "features": { "combinedBs": false }, "featureCodes": [] })
        );
    }

    #[test]
    fn household_display_keeps_only_short_plain_values() {
        let id = "11111111-2222-4333-8444-555555555555";
        let body = json!({
            "household": { "itemChoice": { "hidden": ["rental"], "levels": { "work": "detail" } }, "request": { "input": {} }, "notes": "メモ" },
            "workspace": { "shownItems": [format!("loan:{id}:rate"), "inv:rate", "ご相談のメモ", "a b"], "band": ["x"] },
            "display": { "result": { "metrics": ["takeHome"], "atAge": 90, "layout": "side", "note": "自由な文" },
                         "balance": { "guide": { "months": [3, 9], "risk": [10, 40], "debt": 50 }, "columns": [{ "year": 2040 }, { "point": "now" }] } },
            "proposals": [{ "name": "プランB" }],
        });
        let v = household_display_of(body.as_object().unwrap());
        assert_eq!(v["itemChoice"], body["household"]["itemChoice"]);
        assert_eq!(
            v["shownItems"],
            json!([format!("loan:{id}:rate"), "inv:rate"])
        );
        assert_eq!(v["display"]["result"]["atAge"], 90);
        assert!(v["display"]["result"].get("note").is_none());
        assert_eq!(v["display"]["balance"]["columns"][0]["year"], 2040);
        assert!(v.get("proposals").is_none() && v.get("household").is_none());
        // 物の ID は共有の仮の ID に。共有の世帯に無い ID の鍵は落とす
        let input = json!({ "household": { "debts": [{ "id": id }] } });
        let p = Pseudonyms::for_input(&input);
        let alias = p.alias_of(id).unwrap().to_owned();
        let shared = with_pseudonyms(
            &json!({ "shownItems": [format!("loan:{id}:rate"), "loan:99999999-2222-4333-8444-555555555555:rate", "mix"] }),
            &p,
        );
        assert_eq!(
            shared["shownItems"],
            json!([format!("loan:{alias}:rate"), "mix"])
        );
    }
}
