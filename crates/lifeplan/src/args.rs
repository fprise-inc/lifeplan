//! 道具の引数の名前の確かめ。知らない名前の引数（`planChanges`・`fromYear` のような書き間違い）を黙って捨てず、名前を挙げて断り、
//! 近い名前を添える（独立した点検の直し。0015 の追記）。
//!
//! - 確かめるのは、道具の入力の形（JSON Schema）の `properties` に無い一番上の名前と、入力の形が `additionalProperties: false` の
//!   中の物（振る項目 `vary`・境目探しの条件 `condition`・プランの変更の1件 `plan_changes[i]`）の名前。どの道具も同じ確かめを通る
//!   （server.rs の `call_tool`）。プランの変更の1件の `note`（propose_scenario の changes から写したときの理由）は受けて使わない
//! - 通り（`variants`）の中の名前は、今までどおり通りごとに理由を返す（ほかの通りは計算する）ので、ここでは見ない（`unknown_in` で、
//!   通りの入力の形と同じ確かめ・同じ書き方の文にする）
//! - 引数の形そのもの（必須・型）は、今までどおり rmcp の読み取りに任せる

use serde_json::{Map, Value};

/// 引数を取らない道具の入力の形（知らない名前を受けない。rmcp の既定の空の形に additionalProperties: false を足した物）
pub fn no_args_schema() -> std::sync::Arc<Map<String, Value>> {
    let mut o = Map::new();
    o.insert("type".into(), Value::from("object"));
    o.insert("properties".into(), Value::Object(Map::new()));
    o.insert("additionalProperties".into(), Value::Bool(false));
    std::sync::Arc::new(o)
}

/// 通りごとに理由を返すので、この確かめでは中を見ない引数
const PER_ROW: &[&str] = &["variants"];

/// 引数（arguments）のうち、入力の形に無い名前があれば、名前を挙げた日本語の理由。無ければ None
pub fn unknown_message(
    schema: &Map<String, Value>,
    args: Option<&Map<String, Value>>,
) -> Option<String> {
    let args = args?;
    let mut found: Vec<(String, Vec<String>)> = Vec::new();
    walk(schema, schema, args, "", true, &mut found);
    if found.is_empty() {
        return None;
    }
    Some(message(&found))
}

/// 1つの物（obj）の名前を、その入力の形（node）の properties と照らす。top は道具の引数の一番上か
fn walk(
    root: &Map<String, Value>,
    node: &Map<String, Value>,
    obj: &Map<String, Value>,
    path: &str,
    top: bool,
    found: &mut Vec<(String, Vec<String>)>,
) {
    let props = node.get("properties").and_then(Value::as_object);
    let mut allowed: Vec<String> = props
        .map(|p| p.keys().cloned().collect())
        .unwrap_or_default();
    allowed.sort();
    for (k, v) in obj {
        let Some(sub) = props.and_then(|p| p.get(k)) else {
            found.push((format!("{path}{k}"), allowed.clone()));
            continue;
        };
        if top && PER_ROW.contains(&k.as_str()) {
            continue;
        }
        // 中の物の形が決まっている（additionalProperties: false）ときだけ、中の名前も確かめる（並びは1件ずつ）
        match v {
            Value::Object(o) => {
                if let Some(inner) = strict_object(root, sub) {
                    walk(root, inner, o, &format!("{path}{k}."), false, found);
                }
            }
            Value::Array(list) => {
                if let Some(inner) = items_of(root, sub).and_then(|i| strict_object(root, i)) {
                    for (i, x) in list.iter().enumerate() {
                        if let Value::Object(o) = x {
                            walk(root, inner, o, &format!("{path}{k}[{i}]."), false, found);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// 並びの入力の形（$ref・anyOf を開いた物）の要素の形
fn items_of<'a>(root: &'a Map<String, Value>, s: &'a Value) -> Option<&'a Value> {
    let o = s.as_object()?;
    if let Some(i) = o.get("items") {
        return Some(i);
    }
    if let Some(r) = o.get("$ref").and_then(Value::as_str) {
        return items_of(root, root.get("$defs")?.get(r.strip_prefix("#/$defs/")?)?);
    }
    ["anyOf", "oneOf"]
        .iter()
        .filter_map(|k| o.get(*k).and_then(Value::as_array))
        .flatten()
        .find_map(|x| items_of(root, x))
}

/// 入力の形（$ref・anyOf の null との組を開いた物）が、名前の決まった物（additionalProperties: false）なら、その形
fn strict_object<'a>(root: &'a Map<String, Value>, s: &'a Value) -> Option<&'a Map<String, Value>> {
    let o = s.as_object()?;
    if let Some(r) = o.get("$ref").and_then(Value::as_str) {
        let name = r.strip_prefix("#/$defs/")?;
        return strict_object(root, root.get("$defs")?.get(name)?);
    }
    for k in ["anyOf", "oneOf"] {
        if let Some(list) = o.get(k).and_then(Value::as_array) {
            return list.iter().find_map(|x| strict_object(root, x));
        }
    }
    (o.get("additionalProperties") == Some(&Value::Bool(false))).then_some(o)
}

/// 名前をそろえた形（小文字にし、下線・ハイフン・空白を外す。planChanges と plan_changes を同じにする）
fn folded(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '_' | '-' | ' '))
        .flat_map(char::to_lowercase)
        .collect()
}

/// 文字の数で数えた編集の距離
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur.push(sub.min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}

/// 知らない名前に近い、使える名前（書き方の違いだけ → 1〜2文字の違い → 名前の一部、の順。見つからなければ None）
pub fn closest<'a>(name: &str, allowed: &'a [String]) -> Option<&'a str> {
    let f = folded(name);
    if f.is_empty() {
        return None;
    }
    if let Some(a) = allowed.iter().find(|a| folded(a) == f) {
        return Some(a);
    }
    let near = allowed
        .iter()
        .map(|a| (distance(&folded(a), &f), a))
        .filter(|(d, _)| *d <= 2 && *d < f.chars().count())
        .min_by_key(|(d, _)| *d);
    if let Some((_, a)) = near {
        return Some(a);
    }
    if f.chars().count() >= 4 {
        return allowed
            .iter()
            .filter(|a| {
                let fa = folded(a);
                fa.contains(&f) || f.contains(&fa)
            })
            .min_by_key(|a| a.len())
            .map(String::as_str);
    }
    None
}

/// 理由の文（知らない名前ごとに近い名前を添え、使える名前を並べる）
fn message(found: &[(String, Vec<String>)]) -> String {
    let (parts, names) = described(found, "この道具の引数");
    let mut m = format!("知らない引数の名前があるため、この呼び出しは何もしていません: {parts}。");
    // 一番上の名前の書き方: 答えの書き方（planChanges・keyFigures）につられて書いたときの案内
    if found
        .iter()
        .any(|(p, _)| p.chars().any(|c| c.is_ascii_uppercase()))
    {
        m.push_str("引数の名前は下線で区切ります（例 plan_changes・from_year・at_ages。答えの planChanges・keyFigures のような書き方とは違います）。");
    }
    if found
        .iter()
        .any(|(p, a)| p == "base" && a.iter().any(|x| x == "variants"))
    {
        m.push_str("基本の世帯と基本に当てる変更は、base の中ではなく引数の一番上（sample_household_id・plan_changes など）に書きます。");
    }
    m.push_str(&names);
    m
}

/// 知らない名前の並び（近い名前つき）と、使える名前の文（同じ物の中の名前は1回だけ。一番上の物は top と呼ぶ）
fn described(found: &[(String, Vec<String>)], top: &str) -> (String, String) {
    let parts: Vec<String> = found
        .iter()
        .map(|(path, allowed)| {
            let leaf = path.rsplit('.').next().unwrap_or(path);
            let prefix = &path[..path.len() - leaf.len()];
            match closest(leaf, allowed) {
                Some(c) => format!("{path}（{prefix}{c} のことですか）"),
                None => path.clone(),
            }
        })
        .collect();
    let mut m = String::new();
    let mut shown: Vec<String> = Vec::new();
    for (path, allowed) in found {
        let leaf = path.rsplit('.').next().unwrap_or(path);
        let at = path[..path.len() - leaf.len()]
            .trim_end_matches('.')
            .to_owned();
        if shown.contains(&at) {
            continue;
        }
        let names = if allowed.is_empty() {
            "（引数はありません）".to_owned()
        } else {
            allowed.join("・")
        };
        if at.is_empty() {
            m.push_str(&format!("{top}: {names}。"));
        } else {
            m.push_str(&format!("{at} に書ける名前: {names}。"));
        }
        shown.push(at);
    }
    (parts.join("・"), m)
}

/// 通り1つ（compare・chart・table の variants の1件）の知らない名前の理由。schema は通りの入力の形（一番上の確かめと同じ照らし方・
/// 同じ書き方。通りの中の plan_changes の1件も見る）。無ければ None
pub fn unknown_in(what: &str, obj: &Value, schema: &Map<String, Value>) -> Option<String> {
    let o = obj.as_object()?;
    let mut found: Vec<(String, Vec<String>)> = Vec::new();
    walk(schema, schema, o, "", false, &mut found);
    if found.is_empty() {
        return None;
    }
    let (parts, names) = described(&found, &format!("{what}に書ける名前"));
    Some(format!(
        "{what}に知らない名前があるため、この{what}は計算していません: {parts}。{names}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn names(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn closest_names() {
        let a = names(&[
            "sample_household_id",
            "plan_changes",
            "from_year",
            "to_year",
            "every_years",
            "at_ages",
            "variants",
        ]);
        assert_eq!(closest("planChanges", &a), Some("plan_changes"));
        assert_eq!(closest("fromYear", &a), Some("from_year"));
        assert_eq!(closest("everyYears", &a), Some("every_years"));
        assert_eq!(closest("atAges", &a), Some("at_ages"));
        assert_eq!(closest("plan_change", &a), Some("plan_changes"));
        assert_eq!(closest("variant", &a), Some("variants"));
        assert_eq!(closest("household", &a), Some("sample_household_id"));
        assert_eq!(closest("base", &a), None);
        assert_eq!(closest("x", &a), None);
    }

    #[test]
    fn unknown_top_and_strict_inner_names() {
        let schema = json!({
            "type": "object",
            "properties": {
                "plan_changes": { "type": ["array", "null"], "items": { "$ref": "#/$defs/PlanChange" } },
                "vary": { "$ref": "#/$defs/Vary" },
                "variants": { "type": "array", "items": { "$ref": "#/$defs/Vary" } },
                "input": { "type": ["object", "null"] }
            },
            "$defs": {
                "Vary": { "type": "object", "additionalProperties": false, "properties": { "target": {}, "item": {} } },
                "PlanChange": { "type": "object", "properties": { "target": {} } }
            }
        });
        let s = schema.as_object().unwrap();
        let ok = json!({ "plan_changes": [{ "anything": 1 }], "vary": { "target": "a", "item": "b" }, "input": { "anything": 1 }, "variants": [{ "nope": 1 }] });
        assert_eq!(unknown_message(s, ok.as_object()), None);
        let bad = json!({ "planChanges": [], "vary": { "target": "a", "itme": "b" } });
        let m = unknown_message(s, bad.as_object()).unwrap();
        assert!(
            m.contains("planChanges（plan_changes のことですか）"),
            "{m}"
        );
        assert!(m.contains("vary.itme（vary.item のことですか）"), "{m}");
        assert!(m.contains("下線で区切ります"), "{m}");
        assert!(
            m.contains("この道具の引数: input・plan_changes・variants・vary"),
            "{m}"
        );
        assert!(m.contains("vary に書ける名前: item・target"), "{m}");
        // 引数の無い道具
        let none = json!({ "type": "object", "properties": {} });
        let m = unknown_message(none.as_object().unwrap(), json!({ "x": 1 }).as_object()).unwrap();
        assert!(m.contains("（引数はありません）"), "{m}");
        assert_eq!(
            unknown_message(none.as_object().unwrap(), json!({}).as_object()),
            None
        );
    }

    #[test]
    fn unknown_in_a_variant() {
        let schema = json!({
            "type": "object", "additionalProperties": false,
            "properties": { "label": {}, "plan_changes": { "type": ["array", "null"], "items": { "$ref": "#/$defs/PlanChange" } } },
            "$defs": { "PlanChange": { "type": "object", "additionalProperties": false, "properties": { "target": {}, "item": {}, "value": {}, "note": {} } } }
        });
        let a = schema.as_object().unwrap();
        assert_eq!(unknown_in("通り", &json!({ "label": "x" }), a), None);
        let ok =
            json!({ "plan_changes": [{ "target": "t", "item": "i", "value": 1, "note": "理由" }] });
        assert_eq!(unknown_in("通り", &ok, a), None);
        let m = unknown_in(
            "通り",
            &json!({ "plan_changes": [{ "target": "t", "item": "i", "vlaue": 1 }] }),
            a,
        )
        .unwrap();
        assert!(
            m.contains("plan_changes[0].vlaue（plan_changes[0].value のことですか）"),
            "{m}"
        );
        assert!(
            m.contains("plan_changes[0] に書ける名前: item・note・target・value"),
            "{m}"
        );
        let m = unknown_in("通り", &json!({ "label": "x", "planChanges": [] }), a).unwrap();
        assert!(
            m.contains("planChanges（plan_changes のことですか）"),
            "{m}"
        );
    }
}
