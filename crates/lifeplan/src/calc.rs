//! 計算の道具の中身: 入力に変更（JSON Patch の一部）を当て、計算し、AIが読みやすい大きさにまとめる。

use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// 変更の上限（1回の計算で当てる数）
pub const MAX_CHANGES: usize = 200;

/// ストレステストの型（0005 の追記・0008 の7）
pub const STRESS_TESTS: &[&str] = &[
    "marketDropAtRetirement",
    "inflationSpike",
    "rateRise",
    "incomeDrop",
];

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
pub struct Change {
    /// `replace`（今の値を置き換える）・`add`（物の項目を足す／配列に足す。末尾は `-`）・`remove`（消す）
    pub op: String,
    /// 計算の入力（`input`）の中の場所（JSON Pointer。例: `/assumptions/inflation`、`/household/members/0/birth/birthYearMonth`）
    pub path: String,
    /// 新しい値（`remove` では使わない）
    #[serde(default)]
    pub value: Option<Value>,
}

fn parse_pointer(path: &str) -> Result<Vec<String>, String> {
    if path.is_empty() {
        return Err("path が空です（入力全体は置き換えられません）".into());
    }
    let rest = path
        .strip_prefix('/')
        .ok_or_else(|| format!("path は / で始めてください: {path}"))?;
    Ok(rest
        .split('/')
        .map(|s| s.replace("~1", "/").replace("~0", "~"))
        .collect())
}

fn parent_mut<'a>(
    root: &'a mut Value,
    tokens: &[String],
    path: &str,
) -> Result<&'a mut Value, String> {
    let mut cur = root;
    for t in tokens {
        cur = match cur {
            Value::Object(m) => m.get_mut(t),
            Value::Array(a) => t.parse::<usize>().ok().and_then(|i| a.get_mut(i)),
            _ => None,
        }
        .ok_or_else(|| format!("path の途中が見つかりません: {path}"))?;
    }
    Ok(cur)
}

/// 変更を順に当てる（1つでも当たらなければ、何も当てずに Err）
pub fn apply_changes(input: &Value, changes: &[Change]) -> Result<Value, String> {
    if changes.len() > MAX_CHANGES {
        return Err(format!("変更は{MAX_CHANGES}件までにしてください"));
    }
    let mut out = input.clone();
    for (i, c) in changes.iter().enumerate() {
        let n = i + 1;
        let tokens = parse_pointer(&c.path).map_err(|e| format!("{n}件目: {e}"))?;
        let (last, parents) = tokens
            .split_last()
            .ok_or_else(|| format!("{n}件目: path が空です"))?;
        let parent = parent_mut(&mut out, parents, &c.path).map_err(|e| format!("{n}件目: {e}"))?;
        let need_value = || {
            c.value
                .clone()
                .ok_or_else(|| format!("{n}件目: value がありません"))
        };
        match (c.op.as_str(), parent) {
            ("replace", Value::Object(m)) => {
                if !m.contains_key(last) {
                    return Err(format!("{n}件目: 置き換える項目がありません: {}", c.path));
                }
                m.insert(last.clone(), need_value()?);
            }
            ("replace", Value::Array(a)) => {
                let slot = last
                    .parse::<usize>()
                    .ok()
                    .and_then(|i| a.get_mut(i))
                    .ok_or_else(|| format!("{n}件目: 置き換える要素がありません: {}", c.path))?;
                *slot = need_value()?;
            }
            ("add", Value::Object(m)) => {
                m.insert(last.clone(), need_value()?);
            }
            ("add", Value::Array(a)) => {
                let v = need_value()?;
                if last == "-" {
                    a.push(v);
                } else {
                    let i = last
                        .parse::<usize>()
                        .ok()
                        .filter(|i| *i <= a.len())
                        .ok_or_else(|| format!("{n}件目: 配列の位置が違います: {}", c.path))?;
                    a.insert(i, v);
                }
            }
            ("remove", Value::Object(m)) => {
                m.remove(last)
                    .ok_or_else(|| format!("{n}件目: 消す項目がありません: {}", c.path))?;
            }
            ("remove", Value::Array(a)) => {
                let i = last
                    .parse::<usize>()
                    .ok()
                    .filter(|i| *i < a.len())
                    .ok_or_else(|| format!("{n}件目: 消す要素がありません: {}", c.path))?;
                a.remove(i);
            }
            ("replace" | "add" | "remove", _) => {
                return Err(format!(
                    "{n}件目: path の親が物でも配列でもありません: {}",
                    c.path
                ));
            }
            (op, _) => {
                return Err(format!(
                    "{n}件目: op は replace・add・remove のどれかです（{op}）"
                ))
            }
        }
    }
    Ok(out)
}

/// 出力の形
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// 年ごとの合計（収入・税と社会保険料・支出・収支・金融資産・負債・不足）と見出しの知らせ
    Summary,
    /// キャッシュフロー表の行そのもの（行の接頭辞と年で絞れる）
    Table,
}

pub struct TableFilter {
    pub rows: Vec<String>,
    pub from_year: Option<i64>,
    pub to_year: Option<i64>,
}

fn in_years(y: i64, f: &TableFilter) -> bool {
    f.from_year.is_none_or(|a| y >= a) && f.to_year.is_none_or(|b| y <= b)
}

/// エンジンの出力（表示の形）を、AIに返す形にまとめる
pub fn shape(out: &Value, mode: OutputMode, filter: &TableFilter) -> Value {
    let header = &out["header"];
    let notices: Vec<Value> = header["notices"]
        .as_array()
        .map(|a| a.iter().take(100).cloned().collect())
        .unwrap_or_default();
    let packs: Vec<Value> = header["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| json!({ "packId": p["packId"], "version": p["version"] }))
                .collect()
        })
        .unwrap_or_default();
    let mut result = Map::new();
    result.insert("baseMonth".into(), header["baseMonth"].clone());
    result.insert("endYear".into(), header["endYear"].clone());
    result.insert("packs".into(), Value::Array(packs));
    result.insert("notices".into(), Value::Array(notices));
    result.insert("totals".into(), out["summary"]["totals"].clone());
    let table = out["table"].as_array().cloned().unwrap_or_default();
    match mode {
        OutputMode::Summary => {
            let mut years: BTreeMap<i64, [i64; 7]> = BTreeMap::new();
            for r in &table {
                let (Some(row), Some(year), Some(amount)) =
                    (r["row"].as_str(), r["year"].as_i64(), r["amount"].as_i64())
                else {
                    continue;
                };
                if !in_years(year, filter) {
                    continue;
                }
                let e = years.entry(year).or_insert([0; 7]);
                let slot = if row.starts_with("cf.income.") {
                    0
                } else if row.starts_with("cf.taxSi.") {
                    1
                } else if row.starts_with("cf.expense.") {
                    2
                } else if row == "cf.net" {
                    3
                } else if row == "cf.balance.financial" {
                    4
                } else if row.starts_with("cf.balance.debt.") {
                    5
                } else if row == "cf.balance.shortfall" {
                    6
                } else {
                    continue;
                };
                e[slot] += amount;
            }
            let list: Vec<Value> = years
                .into_iter()
                .map(|(y, v)| {
                    json!({
                        "year": y, "income": v[0], "taxSi": v[1], "expense": v[2], "net": v[3],
                        "financialAssets": v[4], "debt": v[5], "shortfall": v[6],
                    })
                })
                .collect();
            result.insert("unit".into(), json!("円（年額・年末の残高）"));
            result.insert("years".into(), Value::Array(list));
            let other: Vec<&String> = out["summary"]
                .as_object()
                .map(|m| m.keys().filter(|k| *k != "totals").collect())
                .unwrap_or_default();
            result.insert("moreInSummary".into(), json!(other));
        }
        OutputMode::Table => {
            let rows: Vec<Value> = table
                .into_iter()
                .filter(|r| {
                    let row = r["row"].as_str().unwrap_or("");
                    let year = r["year"].as_i64().unwrap_or(0);
                    in_years(year, filter)
                        && (filter.rows.is_empty()
                            || filter.rows.iter().any(|p| row.starts_with(p.as_str())))
                })
                .collect();
            result.insert("unit".into(), json!("円"));
            result.insert("table".into(), Value::Array(rows));
            result.insert("summary".into(), out["summary"].clone());
        }
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(op: &str, path: &str, value: Option<Value>) -> Change {
        Change {
            op: op.into(),
            path: path.into(),
            value,
        }
    }

    #[test]
    fn applies_changes_in_order() {
        let input = json!({ "a": { "b": 1 }, "list": [1, 2] });
        let out = apply_changes(
            &input,
            &[
                c("replace", "/a/b", Some(json!(5))),
                c("add", "/a/c", Some(json!("x"))),
                c("add", "/list/-", Some(json!(3))),
                c("remove", "/list/0", None),
                c("add", "/a~1b", Some(json!(true))),
            ],
        )
        .unwrap();
        assert_eq!(
            out,
            json!({ "a": { "b": 5, "c": "x" }, "list": [2, 3], "a/b": true })
        );
        assert!(apply_changes(&input, &[c("replace", "/a/zz", Some(json!(1)))]).is_err());
        assert!(apply_changes(&input, &[c("move", "/a/b", None)]).is_err());
        assert!(apply_changes(&input, &[c("replace", "", Some(json!(1)))]).is_err());
        assert!(apply_changes(&input, &[c("replace", "/a/b", None)]).is_err());
    }
}
