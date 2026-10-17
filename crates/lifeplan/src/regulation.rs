//! 制度の値の参照（`get_regulation_value`）。埋め込んだ制度データのパック（engine/dist/regulation）から、
//! 値・出典・適用期間を返す。計算エンジンの行の選び方（0007 の8: 最新の版で知っている決定済みの行・`appliesTo: null` は同じ条件の次の行の前日まで）に合わせる。
//! 案（proposed）の行は返さない。

use crate::engine::assets::PACKS;
use serde_json::{json, Value};
use std::sync::OnceLock;

struct Entry {
    pack_id: String,
    pack_version: String,
    def: Value,
}

fn values() -> &'static Vec<Entry> {
    static V: OnceLock<Vec<Entry>> = OnceLock::new();
    V.get_or_init(|| {
        let mut out = Vec::new();
        for p in PACKS {
            let Ok(pack) = serde_json::from_str::<Value>(p) else {
                continue;
            };
            let pack_id = pack["pack"]["packId"].as_str().unwrap_or("").to_owned();
            let pack_version = pack["pack"]["version"].as_str().unwrap_or("").to_owned();
            for v in pack["values"].as_array().into_iter().flatten() {
                out.push(Entry {
                    pack_id: pack_id.clone(),
                    pack_version: pack_version.clone(),
                    def: v.clone(),
                });
            }
        }
        out
    })
}

/// 前日（YYYY-MM-DD）
fn previous_day(date: &str) -> Option<String> {
    let mut it = date.split('-').map(|s| s.parse::<i64>().ok());
    let (y, m, d) = (it.next()??, it.next()??, it.next()??);
    if d > 1 {
        return Some(format!("{y:04}-{m:02}-{:02}", d - 1));
    }
    let (y2, m2) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
    let leap = (y2 % 4 == 0 && y2 % 100 != 0) || y2 % 400 == 0;
    let last = match m2 {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    Some(format!("{y2:04}-{m2:02}-{last:02}"))
}

/// その日に当たる行（条件・管轄の組ごとに1つ）
fn entries_on(def: &Value, as_of: &str) -> Vec<Value> {
    let known: Vec<&Value> = def["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|e| e["status"] == "enacted" && e["supersededIn"].is_null())
        .collect();
    let group = |e: &Value| format!("{}|{}", e["conditions"], e["jurisdiction"]);
    let mut out = Vec::new();
    for e in &known {
        let from = e["appliesFrom"].as_str().unwrap_or("");
        let to = match e["appliesTo"].as_str() {
            Some(t) => Some(t.to_owned()),
            None => known
                .iter()
                .filter(|o| group(o) == group(e))
                .filter_map(|o| o["appliesFrom"].as_str())
                .filter(|f| *f > from)
                .min()
                .and_then(previous_day),
        };
        if from <= as_of && to.as_deref().is_none_or(|t| as_of <= t) {
            let sources: Vec<Value> = e["sources"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|s| {
                    json!({
                        "type": s["type"],
                        "url": s.get("url"),
                        "locator": s.get("locator"),
                        "lawNumber": s.get("lawNumber"),
                        "quote": s.get("quote"),
                        "retrievedAt": s.get("retrievedAt"),
                    })
                })
                .collect();
            out.push(json!({
                "value": e["value"],
                "appliesFrom": from,
                "appliesTo": to,
                "conditions": e["conditions"],
                "jurisdiction": e["jurisdiction"],
                "enforcedOn": e.get("enforcedOn"),
                "checked": e["approval"]["method"],
                "sources": sources,
            }));
        }
    }
    out
}

/// IDで1つ引く。無ければ None
pub fn lookup(id: &str, as_of: &str) -> Option<Value> {
    let e = values().iter().find(|e| e.def["id"] == id)?;
    let d = &e.def;
    Some(json!({
        "id": id,
        "title": d["title"],
        "kind": d["kind"],
        "unit": d.get("unit"),
        "rounding": d.get("rounding"),
        "asOf": as_of,
        "pack": { "packId": e.pack_id, "version": e.pack_version },
        "entries": entries_on(d, as_of),
        "note": "entries はその日に当たる行（条件・管轄ごと）。checked が reviewed なら原本で確かめた値、それ以外は確認待ち。値の単位は unit、率は10進の文字列。",
    }))
}

/// 名前か ID に語を含む値の一覧（名前の短いものから。最大 limit 件）
pub fn search(query: &str, limit: usize) -> Vec<Value> {
    let q = query.to_lowercase();
    let mut found: Vec<&Entry> = values()
        .iter()
        .filter(|e| {
            let id = e.def["id"].as_str().unwrap_or("").to_lowercase();
            let title = e.def["title"].as_str().unwrap_or("").to_lowercase();
            q.split_whitespace()
                .all(|w| id.contains(w) || title.contains(w))
        })
        .collect();
    found.sort_by_key(|e| {
        e.def["title"]
            .as_str()
            .map_or(usize::MAX, |t| t.chars().count())
    });
    found
        .into_iter()
        .take(limit)
        .map(|e| json!({ "id": e.def["id"], "title": e.def["title"], "kind": e.def["kind"], "pack": e.pack_id }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previous_day_works() {
        assert_eq!(previous_day("2026-03-01").as_deref(), Some("2026-02-28"));
        assert_eq!(previous_day("2028-03-01").as_deref(), Some("2028-02-29"));
        assert_eq!(previous_day("2026-01-01").as_deref(), Some("2025-12-31"));
        assert_eq!(previous_day("2026-06-15").as_deref(), Some("2026-06-14"));
    }

    #[test]
    fn finds_values_with_sources() {
        let v = lookup("forestEnvironmentTax.amount", "2026-10-01").unwrap();
        assert_eq!(v["entries"][0]["value"], 1000);
        assert!(v["entries"][0]["sources"]
            .as_array()
            .is_some_and(|s| !s.is_empty()));
        assert!(lookup("no.such.value", "2026-10-01").is_none());
        assert!(!search("森林環境税", 10).is_empty());
    }
}
