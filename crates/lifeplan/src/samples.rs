//! 架空の見本の世帯（data/modelHouseholds。CC0。実在の顧客ではない）。
//!
//! 一覧（list_sample_households）は FP 向けに短くする（0199）: アプリの見本の棚にある見本だけを、棚と同じ名前・見本番号・目印
//! （家族の形・年代・絞り込みの項目と、そこから決める場面の目印。app/src/connector/samples.ts を JSON にした物）で返し、目印で絞れる。
//! 棚に無いモデル世帯は、制度の計算を確かめるための開発の試験用の見本として「開発の試験用」の目印を付け、既定では出さない。

use crate::engine::assets::{HOUSEHOLDS, SAMPLES_JSON};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::OnceLock;

/// 開発の試験用の見本の目印
pub const TEST_TAG: &str = "開発の試験用";

/// 合算BS の見本の目印と、その見本に添える一言（会社の数字は計算の入力ではないので、接続口からは見えない。0197）
const COMBINED_BS_TAG: &str = "合算BS";
const COMBINED_BS_NOTE: &str = "会社の数字（合算BS）は、アプリの画面でこの見本を開くと見られます。この接続口で計算するのは家計の側だけです。";

const NOTICE: &str = "すべて架空の世帯です（実在の顧客ではありません）。アプリの見本の棚と同じ名前・目印です。get_sample_household で計算の入力を取り出すか、calculate の sample_household_id に id を渡して計算できます。tags で目印を絞れます（目印の一部でもよい）。家を買う・子が生まれるなどの場面は、近い見本に get_input_recipe の手本を重ねて作れます。";

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct ListSamplesArgs {
    /// 目印で絞る（例 ["子育て"]・["シニア", "収益不動産"]）。どの目印にも当てはまる見本だけを返す。目印の一部でもよい（「介護」は「親の介護・相続」に当たる）。使える目印は答えの tags
    pub tags: Option<Vec<String>>,
    /// 開発の試験用の見本（制度の計算を確かめるための世帯。表が短い物が多い）も出すか。既定は出さない。tags に「開発の試験用」を入れても出る
    pub include_test: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ShelfSample {
    id: String,
    no: String,
    title: String,
    tags: Vec<String>,
}

/// アプリの見本の棚の見本（見本番号の順）
fn shelf() -> &'static [ShelfSample] {
    static SHELF: OnceLock<Vec<ShelfSample>> = OnceLock::new();
    SHELF.get_or_init(|| serde_json::from_str(SAMPLES_JSON).unwrap_or_default())
}

fn parse(json: &str) -> Value {
    serde_json::from_str(json).unwrap_or(Value::Null)
}

/// 構成員の続柄・性別と、計算基準の年の年末の満年齢（0003）を1行で（例「ご本人 男45歳・配偶者 女43歳・子 男15歳」）
fn members(input: &Value) -> String {
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
            let kind = match m["kind"].as_str().unwrap_or("") {
                "self" => "ご本人",
                "spouse" => "配偶者",
                "child" => "子",
                "parent" => "親",
                "grandchild" => "孫",
                "sibling" => "きょうだい",
                "grandparent" => "祖父母",
                _ => "家族",
            };
            let sex = match m["sex"].as_str() {
                Some("male") => " 男",
                Some("female") => " 女",
                _ => "",
            };
            let age = m["birth"]["birthYearMonth"]
                .as_str()
                .and_then(|s| s.get(..4))
                .and_then(|s| s.parse::<i64>().ok())
                .map(|y| match base_year - y {
                    a if a < 0 => "（生まれる前）".to_owned(),
                    a => format!("{a}歳"),
                })
                .unwrap_or_default();
            format!("{kind}{sex}{age}")
        })
        .collect::<Vec<_>>()
        .join("・")
}

/// 計算の期間（例「2026-10〜2071年」）
fn period(input: &Value) -> String {
    format!(
        "{}〜{}年",
        input["baseMonth"].as_str().unwrap_or(""),
        input["endYear"]
    )
}

/// 開発の試験用の見本の短い名前（data/modelHouseholds/README.md の説明から、括弧の中・記号を除いた最初の文。長ければ切る）
fn short_title(desc: &str) -> String {
    let mut plain = String::new();
    let mut depth = 0usize;
    for c in desc.chars() {
        match c {
            '（' | '(' => depth += 1,
            '）' | ')' => depth = depth.saturating_sub(1),
            '`' => {}
            _ if depth == 0 => plain.push(c),
            _ => {}
        }
    }
    let first = plain.split('。').next().unwrap_or("");
    let first = first.replace(": ", "：").replace(':', "：");
    let chars: Vec<char> = first.trim().chars().collect();
    if chars.len() > 40 {
        format!("{}…", chars[..40].iter().collect::<String>())
    } else {
        chars.iter().collect()
    }
}

/// 目印が当てはまるか（見本の目印か名前の一部。大文字・小文字・前後の空白は問わない）
fn matches(want: &str, tags: &[String], title: &str) -> bool {
    let w = want.trim().to_lowercase();
    w.is_empty()
        || title.to_lowercase().contains(&w)
        || tags.iter().any(|t| t.to_lowercase().contains(&w))
}

struct Entry {
    id: &'static str,
    no: Option<&'static str>,
    title: String,
    tags: Vec<String>,
    json: &'static str,
}

fn entries() -> Vec<Entry> {
    let mut out: Vec<Entry> = shelf()
        .iter()
        .filter_map(|s| {
            let (id, _, json) = HOUSEHOLDS.iter().find(|(i, _, _)| *i == s.id)?;
            Some(Entry {
                id,
                no: Some(s.no.as_str()),
                title: s.title.clone(),
                tags: s.tags.clone(),
                json,
            })
        })
        .collect();
    for (id, desc, json) in HOUSEHOLDS {
        if !shelf().iter().any(|s| s.id == *id) {
            out.push(Entry {
                id,
                no: None,
                title: short_title(desc),
                tags: vec![TEST_TAG.to_owned()],
                json,
            });
        }
    }
    out
}

pub fn list(args: &ListSamplesArgs) -> Value {
    let wants: Vec<&str> = args
        .tags
        .iter()
        .flatten()
        .map(|s| s.as_str())
        .filter(|s| !s.trim().is_empty())
        .collect();
    let with_test =
        args.include_test.unwrap_or(false) || wants.iter().any(|w| TEST_TAG.contains(w.trim()));
    let all = entries();
    let mut tags: Vec<&str> = Vec::new();
    for e in all.iter().filter(|e| with_test || e.no.is_some()) {
        for t in &e.tags {
            if !tags.contains(&t.as_str()) {
                tags.push(t);
            }
        }
    }
    let households: Vec<Value> = all
        .iter()
        .filter(|e| with_test || e.no.is_some())
        .filter(|e| wants.iter().all(|w| matches(w, &e.tags, &e.title)))
        .map(|e| {
            let input = &parse(e.json)["input"];
            let mut h = json!({
                "id": e.id,
                "title": e.title,
                "tags": e.tags,
                "members": members(input),
                "period": period(input),
            });
            if let Some(no) = e.no {
                h["no"] = json!(no);
            }
            if e.tags.iter().any(|t| t == COMBINED_BS_TAG) {
                h["note"] = json!(COMBINED_BS_NOTE);
            }
            h
        })
        .collect();
    let hidden = if with_test {
        0
    } else {
        all.iter().filter(|e| e.no.is_none()).count()
    };
    let mut notice = NOTICE.to_owned();
    if hidden > 0 {
        notice.push_str(&format!(
            "ほかに開発の試験用の見本が{hidden}件あります（制度の計算を確かめるための世帯で、表が短い物が多い。include_test: true で出ます）。"
        ));
    }
    if households.is_empty() {
        notice.push_str("当てはまる見本がありません。tags の目印を減らすか、get_input_guide で架空の世帯を組み立ててください。");
    }
    json!({
        "notice": notice,
        "tags": tags,
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
    let mut v = json!({
        "id": id,
        "description": desc,
        "notice": "架空の世帯です。input はエンジンへの要求の input の形（設計記録 0008）で、calculate の input にそのまま渡せます。",
        "input": input(id)?,
    });
    match shelf().iter().find(|s| s.id == id) {
        Some(s) => {
            v["title"] = json!(s.title);
            v["tags"] = json!(s.tags);
            if s.tags.iter().any(|t| t == COMBINED_BS_TAG) {
                v["note"] = json!(COMBINED_BS_NOTE);
            }
        }
        None => v["tags"] = json!([TEST_TAG]),
    }
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &Value) -> Vec<String> {
        v["households"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["id"].as_str().unwrap().to_owned())
            .collect()
    }

    fn pick(tags: &[&str]) -> Vec<String> {
        ids(&list(&ListSamplesArgs {
            tags: Some(tags.iter().map(|s| (*s).to_owned()).collect()),
            include_test: None,
        }))
    }

    #[test]
    fn lists_only_the_shelf_by_default_and_small() {
        let v = list(&ListSamplesArgs::default());
        let hs = v["households"].as_array().unwrap();
        assert_eq!(hs.len(), shelf().len());
        assert!(shelf().len() >= 15, "{}", shelf().len());
        // 数KB に収める（0199。前は約30KB）
        let bytes = v.to_string().len();
        assert!(bytes <= 8 * 1024, "{bytes}");
        let s = hs
            .iter()
            .find(|h| h["id"] == "salariedCoupleTwoKids")
            .unwrap();
        assert_eq!(s["title"], "会社員の夫婦と子2人");
        assert_eq!(s["no"], "3-4-01");
        assert!(s["members"].as_str().unwrap().starts_with("ご本人 男45歳"));
        let tags: Vec<&str> = s["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        for t in ["夫婦と子", "40代", "会社員", "教育費", "子育て"] {
            assert!(tags.contains(&t), "{t}: {tags:?}");
        }
        // 開発の試験用は既定で出さず、数だけ伝える
        assert!(!ids(&v).contains(&"single25".to_owned()));
        assert!(v["notice"].as_str().unwrap().contains("開発の試験用"));
        assert!(!v["tags"].as_array().unwrap().iter().any(|t| t == TEST_TAG));
        // 開発者向けの説明（設計の日付・ファイルの場所）を出さない
        let text = v.to_string();
        assert!(
            !text.contains("2026-10-21") && !text.contains(".json"),
            "{text}"
        );
        assert!(get("salariedCoupleTwoKids").unwrap()["input"]["household"].is_object());
        assert!(get("nope").is_none());
    }

    #[test]
    fn filters_by_tags() {
        let singles = pick(&["単身"]);
        assert!(!singles.is_empty());
        assert!(singles.iter().all(|id| id.starts_with("sampleSingle")));
        assert!(pick(&["シニア"]).contains(&"sampleSeniorCouple".to_owned()));
        assert!(pick(&["シニア"]).contains(&"sampleSeniorRental".to_owned()));
        // 目印の一部（「介護」は「親の介護・相続」）
        assert_eq!(pick(&["介護"]), pick(&["相続"]));
        assert!(pick(&["介護"]).contains(&"sampleParentsCare".to_owned()));
        // 全部に当てはまる物だけ
        assert_eq!(
            pick(&["シニア", "収益不動産"]),
            vec!["sampleSeniorRental".to_owned()]
        );
        assert!(pick(&["自営業"]).contains(&"sampleSelfEmployedFamily".to_owned()));
        assert!(pick(&["役員"]).contains(&"sampleExecutive".to_owned()));
        // 合算BS の見本: 会社の数字は画面で見られることだけを添え、コードの話は出さない
        let v = list(&ListSamplesArgs {
            tags: Some(vec!["合算BS".into()]),
            include_test: None,
        });
        assert_eq!(ids(&v), vec!["sampleOwnerCompany".to_owned()]);
        let text = v.to_string();
        assert!(text.contains("アプリの画面でこの見本を開くと見られます"));
        assert!(!text.contains("コード"), "{text}");
        let got = get("sampleOwnerCompany").unwrap();
        assert!(got["note"].is_string());
        assert!(!got["note"].as_str().unwrap().contains("コード"));
        // 当てはまらないとき
        let none = list(&ListSamplesArgs {
            tags: Some(vec!["宇宙飛行士".into()]),
            include_test: None,
        });
        assert!(ids(&none).is_empty());
        assert!(none["notice"]
            .as_str()
            .unwrap()
            .contains("当てはまる見本がありません"));
    }

    #[test]
    fn test_samples_on_request() {
        let all = list(&ListSamplesArgs {
            tags: None,
            include_test: Some(true),
        });
        let hs = all["households"].as_array().unwrap();
        assert_eq!(hs.len(), HOUSEHOLDS.len());
        let s = hs.iter().find(|h| h["id"] == "single25").unwrap();
        assert_eq!(s["tags"], json!([TEST_TAG]));
        assert_eq!(s["title"], "単身・25歳・会社員");
        let h = hs.iter().find(|h| h["id"] == "housingPurchase").unwrap();
        assert!(h["title"].as_str().unwrap().contains("購入"), "{h}");
        assert!(s.get("no").is_none());
        // 試験用を出しても、名前は短い
        for h in hs {
            assert!(h["title"].as_str().unwrap().chars().count() <= 41, "{h}");
        }
        // 目印で選ぶと試験用だけ
        let only = pick(&[TEST_TAG]);
        assert_eq!(only.len(), HOUSEHOLDS.len() - shelf().len());
        assert!(only.contains(&"single25".to_owned()));
        assert_eq!(get("single25").unwrap()["tags"], json!([TEST_TAG]));
    }
}
