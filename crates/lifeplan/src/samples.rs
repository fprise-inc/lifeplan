//! 架空の見本の世帯（data/modelHouseholds。CC0。実在の顧客ではない）。

use crate::engine::assets::HOUSEHOLDS;
use serde_json::{json, Value};

fn parse(json: &str) -> Value {
    serde_json::from_str(json).unwrap_or(Value::Null)
}

/// 構成員の続柄・性別と、計算基準の年の年末の満年齢（0003）
fn members(input: &Value) -> Vec<Value> {
    let base_year: i64 = input["baseMonth"]
        .as_str()
        .and_then(|s| s.get(..4))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    input["household"]["members"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|m| {
            let birth_year: Option<i64> = m["birth"]["birthYearMonth"]
                .as_str()
                .and_then(|s| s.get(..4))
                .and_then(|s| s.parse().ok());
            json!({
                "kind": m["kind"],
                "sex": m["sex"],
                "age": birth_year.map(|y| base_year - y),
            })
        })
        .collect()
}

pub fn list() -> Value {
    let households: Vec<Value> = HOUSEHOLDS
        .iter()
        .map(|(id, desc, json)| {
            let req = parse(json);
            let input = &req["input"];
            json!({
                "id": id,
                "description": desc,
                "baseMonth": input["baseMonth"],
                "endYear": input["endYear"],
                "members": members(input),
            })
        })
        .collect();
    json!({
        "notice": "すべて架空の世帯です（実在の顧客ではありません）。get_sample_household で計算の入力を取り出し、calculate で計算できます。",
        "households": households,
    })
}

/// 見本の世帯の計算の入力（エンジンへの要求の `input`）
pub fn input(id: &str) -> Option<Value> {
    HOUSEHOLDS
        .iter()
        .find(|(i, _, _)| *i == id)
        .map(|(_, _, json)| parse(json)["input"].clone())
}

pub fn get(id: &str) -> Option<Value> {
    let (_, desc, _) = HOUSEHOLDS.iter().find(|(i, _, _)| *i == id)?;
    Some(json!({
        "id": id,
        "description": desc,
        "notice": "架空の世帯です。input はエンジンへの要求の input の形（設計記録 0008）で、calculate の input にそのまま渡せます。",
        "input": input(id)?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_all_model_households_with_descriptions() {
        let v = list();
        let hs = v["households"].as_array().unwrap();
        assert_eq!(hs.len(), HOUSEHOLDS.len());
        let s = hs
            .iter()
            .find(|h| h["id"] == "salariedCoupleTwoKids")
            .unwrap();
        assert!(s["description"]
            .as_str()
            .unwrap()
            .contains("会社員の夫婦と子2人"));
        assert_eq!(s["members"][0]["kind"], "self");
        assert_eq!(s["members"][0]["age"], 45);
        assert!(get("salariedCoupleTwoKids").unwrap()["input"]["household"].is_object());
        assert!(get("nope").is_none());
    }
}
