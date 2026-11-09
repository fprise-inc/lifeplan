//! 対応範囲の一覧（`search_coverage`・`get_coverage`。0183）。docs/coverage の YAML を engine のビルドが確かめて1つにした JSON
//! （engine/dist/coverage.json）を埋め込み、計算の決まり・近似・まだ対応していない物を探して返す。顧客の情報は含まない。
//!
//! 探し方: 日本語の問いを形態素に分けずに読むため、問いと項目の文の「2文字の並び」の重なりで点を付ける（ひらがなだけの並びは
//! 「している」「ですか」などの言い回しなので数えない）。名前・探す言葉が問いの中にそのまま入っていれば点を足す。

use crate::engine::assets::COVERAGE_JSON;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::sync::OnceLock;

/// 「まだ入っていない」と答えたときに添える、要望の送り方の案内（接続口からは送らない）
pub const FEEDBACK: &str = "この内容はまだファイナンシアの計算に入っていません。入れてほしいときは、アプリの上の帯の FP のメニュー（カバンのアイコン）の「ファイナンシアへ」→「要望・不具合を送る」から送れます（お知らせの一覧〔ベル〕の下にも同じ入口があります）。この接続口からは送れないので、FP がアプリから送ってください。";

/// 状態の言い方
pub fn status_label(s: &str) -> &'static str {
    match s {
        "included" => "入っている",
        "approximated" => "近似している",
        "notYet" => "まだ入っていない",
        _ => "",
    }
}

pub const STATUSES: [&str; 3] = ["included", "approximated", "notYet"];

struct Entry {
    area: String,
    area_title: String,
    def: Value,
    /// 探すための文（正規化した物と重み）
    fields: Vec<(String, u32)>,
    /// そのまま問いに入っていれば点を足す言葉（名前と探す言葉。正規化した物）
    names: Vec<String>,
}

struct List {
    version: String,
    areas: Vec<(String, String)>,
    entries: Vec<Entry>,
}

/// 文の正規化: 全角の英数字を半角に、英字を小文字に、空白と記号を外す
fn normalize(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            let c = match c {
                '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
                '\u{3000}' => ' ',
                _ => c,
            };
            if c.is_whitespace()
                || c.is_ascii_punctuation()
                || "、。・「」『』（）【】〔〕？！：；，．〜ー―‐…".contains(c)
            {
                // 長音の「ー」は語の中にあるので残す
                if c == 'ー' {
                    return Some(c);
                }
                None
            } else {
                Some(c.to_ascii_lowercase())
            }
        })
        .collect()
}

fn is_hiragana(c: char) -> bool {
    ('\u{3041}'..='\u{309F}').contains(&c)
}

/// 2文字の並び（ひらがなだけの並びは外す）
fn bigrams(s: &str) -> BTreeSet<String> {
    let cs: Vec<char> = s.chars().collect();
    cs.windows(2)
        .filter(|w| !(is_hiragana(w[0]) && is_hiragana(w[1])))
        .map(|w| w.iter().collect())
        .collect()
}

fn texts(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        // 名前つきの ID（入力項目・制度の値・表の行）は、ID と名前の両方で探せるようにする
        Value::Array(a) => a
            .iter()
            .flat_map(|x| match x.as_str() {
                Some(t) => vec![t.to_owned()],
                None => [&x["id"], &x["label"]]
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect(),
            })
            .collect(),
        _ => vec![],
    }
}

fn list() -> &'static List {
    static L: OnceLock<List> = OnceLock::new();
    L.get_or_init(|| {
        let doc: Value = serde_json::from_str(COVERAGE_JSON).unwrap_or(Value::Null);
        let mut areas = Vec::new();
        let mut entries = Vec::new();
        for a in doc["areas"].as_array().into_iter().flatten() {
            let area = a["area"].as_str().unwrap_or("").to_owned();
            let title = a["title"].as_str().unwrap_or("").to_owned();
            areas.push((area.clone(), title.clone()));
            for e in a["entries"].as_array().into_iter().flatten() {
                let mut fields = Vec::new();
                let mut add = |key: &str, w: u32| {
                    for t in texts(&e[key]) {
                        fields.push((normalize(&t), w));
                    }
                };
                add("title", 6);
                add("keywords", 6);
                add("summary", 2);
                add("fields", 2);
                add("rules", 2);
                add("items", 1);
                add("regulation", 1);
                add("how", 1);
                add("approximation", 1);
                add("reason", 1);
                add("instead", 1);
                fields.push((normalize(&title), 1));
                // 入力項目ID・制度の値ID がそのまま問いに入っていても当てる
                let ids = ["items", "regulation"].into_iter().flat_map(|k| {
                    e[k].as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|x| x["id"].as_str().map(str::to_owned))
                        .collect::<Vec<_>>()
                });
                let names: Vec<String> = texts(&e["title"])
                    .into_iter()
                    .chain(texts(&e["keywords"]))
                    .chain(ids)
                    .map(|t| normalize(&t))
                    .filter(|t| t.chars().count() >= 2)
                    .collect();
                entries.push(Entry {
                    area: area.clone(),
                    area_title: title.clone(),
                    def: e.clone(),
                    fields,
                    names,
                });
            }
        }
        List {
            version: doc["version"].as_str().unwrap_or("").to_owned(),
            areas,
            entries,
        }
    })
}

pub fn version() -> &'static str {
    &list().version
}

pub fn count() -> usize {
    list().entries.len()
}

/// 問いへの点（0 は当たらない）
fn score(e: &Entry, q: &str, grams: &BTreeSet<String>) -> u32 {
    if grams.is_empty() {
        return 0;
    }
    let mut hit = 0u32;
    for g in grams {
        let w = e
            .fields
            .iter()
            .filter(|(t, _)| t.contains(g.as_str()))
            .map(|(_, w)| *w)
            .max()
            .unwrap_or(0);
        hit += w;
    }
    // 重なりの割合（0〜600。問いの並びがすべて名前・探す言葉に入っていれば 600）
    let mut s = hit * 100 / u32::try_from(grams.len()).unwrap_or(1);
    // 名前・探す言葉が問いにそのまま入っている（長い言葉ほど点を足す。4つまで）
    let mut bonus: Vec<u32> = e
        .names
        .iter()
        .filter(|n| q.contains(n.as_str()))
        .map(|n| 100 + 40 * u32::try_from(n.chars().count().min(10)).unwrap_or(0))
        .collect();
    bonus.sort_unstable_by(|a, b| b.cmp(a));
    s += bonus.iter().take(4).sum::<u32>();
    s
}

fn brief(e: &Entry) -> Value {
    let status = e.def["status"].as_str().unwrap_or("");
    json!({
        "id": e.def["id"],
        "title": e.def["title"],
        "area": e.area_title,
        "status": status,
        "statusLabel": status_label(status),
        "summary": e.def["summary"],
    })
}

/// 探す。status で状態を絞れる。戻り値は点の高い順（最大 limit 件）
pub fn search(query: &str, status: Option<&str>, area: Option<&str>, limit: usize) -> Value {
    let q = normalize(query);
    let grams = bigrams(&q);
    let mut found: Vec<(u32, &Entry)> = list()
        .entries
        .iter()
        .filter(|e| status.is_none_or(|s| e.def["status"] == s))
        .filter(|e| area.is_none_or(|a| e.area == a))
        .map(|e| (score(e, &q, &grams), e))
        .filter(|(s, _)| *s >= 120)
        .collect();
    found.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.def["id"].as_str().cmp(&b.1.def["id"].as_str()))
    });
    // いちばん近い項目より大きく離れた物は出さない（4分の1未満）
    let best = found.first().map_or(0, |f| f.0);
    found.retain(|f| f.0 * 4 >= best);
    let matches: Vec<Value> = found
        .iter()
        .take(limit)
        .map(|(s, e)| {
            let mut b = brief(e);
            b["score"] = json!(s);
            b
        })
        .collect();
    let mut out = Map::new();
    out.insert("query".into(), json!(query));
    out.insert("coverageVersion".into(), json!(version()));
    out.insert("matches".into(), Value::Array(matches.clone()));
    if matches.is_empty() {
        out.insert(
            "note".into(),
            json!("対応範囲の一覧に当たる項目がありませんでした。言い方を変える（制度の名前・入力項目の名前・短い言葉）か、get_coverage（id なし）で分野ごとの一覧を見てください。それでも無ければ、まだ計算に入っていない可能性があります（入っていると推測で答えないでください）。"),
        );
        out.insert("feedback".into(), json!(FEEDBACK));
    } else {
        out.insert(
            "note".into(),
            json!("score は問いとの重なりの目安（大きいほど近い）。答える前に get_coverage で項目の中身（どう計算するか・近似の仕方と理由・関係する入力項目・根拠の制度）を読んでください。"),
        );
        if matches.iter().any(|m| m["status"] == "notYet") {
            out.insert("feedback".into(), json!(FEEDBACK));
        }
    }
    Value::Object(out)
}

/// 1つの項目の中身（無ければ None）
pub fn get(id: &str) -> Option<Value> {
    let l = list();
    let e = l.entries.iter().find(|e| e.def["id"] == id)?;
    let mut v = e.def.clone();
    let status = v["status"].as_str().unwrap_or("").to_owned();
    v["statusLabel"] = json!(status_label(&status));
    v["area"] = json!({ "id": e.area, "title": e.area_title });
    let related: Vec<Value> = v["related"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| l.entries.iter().find(|x| x.def["id"] == *r))
        .map(brief)
        .collect();
    v["related"] = Value::Array(related);
    v["coverageVersion"] = json!(l.version);
    v["note"] = json!("items は入力項目ID と名前、regulation は制度の値ID（get_regulation_value で値・出典を引ける）、rows はキャッシュフロー表の行（explain_value で数字の根拠を見られる）。");
    if status == "notYet" {
        v["feedback"] = json!(FEEDBACK);
    }
    Some(v)
}

/// 分野ごとの目次（項目の鍵・名前・状態だけ）
pub fn contents() -> Value {
    let l = list();
    let areas: Vec<Value> = l
        .areas
        .iter()
        .map(|(a, t)| {
            let es: Vec<Value> = l
                .entries
                .iter()
                .filter(|e| e.area == *a)
                .map(|e| json!({ "id": e.def["id"], "title": e.def["title"], "status": e.def["status"] }))
                .collect();
            json!({ "area": a, "title": t, "entries": es })
        })
        .collect();
    let n = |s: &str| l.entries.iter().filter(|e| e.def["status"] == s).count();
    json!({
        "coverageVersion": l.version,
        "statuses": { "included": "入っている", "approximated": "近似している", "notYet": "まだ入っていない" },
        "counts": { "all": count(), "included": n("included"), "approximated": n("approximated"), "notYet": n("notYet") },
        "areas": areas,
        "note": "全部を網羅した一覧ではありません。載っていない話題は、入っていると推測せず、FP に確かめるよう伝えてください。",
    })
}

/// 分野の鍵の一覧
pub fn area_ids() -> Vec<&'static str> {
    list().areas.iter().map(|(a, _)| a.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top(q: &str) -> String {
        search(q, None, None, 5)["matches"][0]["id"]
            .as_str()
            .unwrap_or("")
            .to_owned()
    }

    #[test]
    fn embedded_list_is_read() {
        assert!(count() >= 60);
        assert_eq!(version().len(), 12);
        assert!(area_ids().contains(&"tax"));
        for s in STATUSES {
            assert!(list().entries.iter().any(|e| e.def["status"] == s), "{s}");
        }
    }

    #[test]
    fn normalizes_text() {
        assert_eq!(normalize("ＩＤｅＣｏ の受け取り？"), "idecoの受け取り");
        assert!(!bigrams("している").contains("して"));
        assert!(bigrams("高額療養費").contains("療養"));
    }

    #[test]
    fn finds_common_questions() {
        assert_eq!(
            top("高額療養費は入っていますか"),
            "socialInsurance.highCostMedical"
        );
        assert_eq!(
            top("iDeCoの受け取り方と退職所得控除"),
            "investment.idecoPayout"
        );
        assert_eq!(top("児童手当"), "benefits.childAllowance");
        assert_eq!(
            top("住宅ローン控除はどう計算している？"),
            "tax.housingLoanCredit"
        );
        assert_eq!(
            top("働きながら年金をもらうと減る？（在職老齢年金）"),
            "pension.workingPension"
        );
        assert_eq!(top("遺族年金"), "pension.survivor");
        assert_eq!(top("相続税の目安はどう出している"), "inheritance.estimate");
        assert_eq!(top("所得金額調整控除"), "tax.incomeAdjustment");
        assert_eq!(
            top("医療費控除は入っている？"),
            "tax.medicalExpenseDeduction"
        );
        // 入力項目ID でも探せる
        assert!(search("insurance.premium", None, None, 5)["matches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "insurance.premium"));
    }

    #[test]
    fn unknown_topic_points_to_feedback() {
        let v = search("量子コンピュータの保守契約", None, None, 5);
        assert_eq!(v["matches"], json!([]));
        assert!(v["feedback"]
            .as_str()
            .unwrap()
            .contains("要望・不具合を送る"));
        let not_yet = list()
            .entries
            .iter()
            .find(|e| e.def["status"] == "notYet")
            .unwrap();
        let g = get(not_yet.def["id"].as_str().unwrap()).unwrap();
        assert!(g["feedback"]
            .as_str()
            .unwrap()
            .contains("要望・不具合を送る"));
        assert_eq!(g["statusLabel"], "まだ入っていない");
        assert!(get("no.such").is_none());
    }
}
