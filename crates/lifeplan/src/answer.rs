//! 計算の答えの足し引き（0194）: calculate の答え（calc::shape の形）に、エンジンが計算しているのに落ちていた数字（必要保障額・相続税の目安）と、
//! 年ごとの家族の年齢・主な数字（画面の「プランを比較」と同じ数え方。同梱した画面の関数 summarize で数える）を足し、
//! AI が選んだ大きさ（何年おき・どの数字だけ・省く物）に絞る。何も選ばなければ、今までの答えに足すだけ（今までの項目は変えない）

use crate::calc::OutputMode;
use crate::engine;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// summary の年ごとの数字（fields で選べる物）
pub const FIELDS: &[&str] = &[
    "income",
    "taxSi",
    "expense",
    "net",
    "financialAssets",
    "debt",
    "shortfall",
    "loanRepayment",
    "loanBalance",
    "loanInterest",
    "loanRate",
    "takeHome",
    "pension",
    "incomeSalary",
    "incomeBusiness",
    "incomePension",
    "incomeCorporatePension",
    "incomeRetirement",
    "incomeBenefit",
    "incomeRealEstate",
    "incomeOther",
    "expenseLiving",
    "expenseSurplus",
    "expenseHousing",
    "expenseEducation",
    "expenseInsurance",
    "expenseLumpSum",
    "expenseCar",
    "expenseCare",
    "expenseRealEstate",
    "expenseOther",
    "nisaContribution",
    "nisaBalance",
];

/// 年ごとの収支の内訳（0207）: fields・series で選んだときだけ返す（既定の答えの大きさは変えない）。同梱した画面の関数（summary.ts の flowYearsOf）で、
/// 画面のキャッシュフロー表の行と同じ当て方で数える。pension は公的年金の年額、income〜 は収入の内訳で全部足すと income（0211）、expense〜 は
/// 支出（税・社会保険料を除く）の内訳で、全部足すと expense。nisaContribution は NISAへの積立（年額）、nisaBalance は NISA の残高（年末。0211）
pub const FLOW_FIELDS: &[&str] = &[
    "pension",
    "incomeSalary",
    "incomeBusiness",
    "incomePension",
    "incomeCorporatePension",
    "incomeRetirement",
    "incomeBenefit",
    "incomeRealEstate",
    "incomeOther",
    "expenseLiving",
    "expenseSurplus",
    "expenseHousing",
    "expenseEducation",
    "expenseInsurance",
    "expenseLumpSum",
    "expenseCar",
    "expenseCare",
    "expenseRealEstate",
    "expenseOther",
    "nisaContribution",
    "nisaBalance",
];

/// 年ごとの住宅ローンの数字（0203。利息と金利は 0205）: fields・series で選んだときだけ返す（既定の答えの大きさは変えない）。同梱した画面の関数
/// （summary.ts の loanYearsOf）で数える。loanRate は10進の文字か null（返済の無い年・金利の違う住宅ローンを2本以上返している年）
pub const LOAN_FIELDS: &[&str] = &["loanRepayment", "loanBalance", "loanInterest", "loanRate"];

/// 答えから省ける物
pub const OMITS: &[&str] = &[
    "notices",
    "packs",
    "totals",
    "insurance",
    "ages",
    "years",
    "keyFigures",
    "protection",
    "protectionDetail",
    "inheritanceTax",
    "pension",
    "loanInterest",
];

/// 何年おきの上限
pub const MAX_EVERY_YEARS: u8 = 10;
/// 「○歳時点の金融資産」の年齢の数の上限
pub const MAX_AT_AGES: usize = 5;

/// 答えの大きさの選択（calculate の every_years・fields・omit・at_ages）
#[derive(Debug, Clone, Default)]
pub struct Options {
    every: u8,
    fields: Option<BTreeSet<String>>,
    omit: BTreeSet<String>,
    at_ages: Vec<u8>,
}

impl Options {
    pub fn new(
        every_years: Option<u8>,
        fields: Option<&[String]>,
        omit: Option<&[String]>,
        at_ages: Option<&[u8]>,
    ) -> Result<Self, String> {
        let every = every_years.unwrap_or(1);
        if !(1..=MAX_EVERY_YEARS).contains(&every) {
            return Err(format!(
                "every_years は 1〜{MAX_EVERY_YEARS} にしてください。"
            ));
        }
        let pick = |list: &[String], allowed: &[&str], name: &str| {
            let bad: Vec<&String> = list
                .iter()
                .filter(|x| !allowed.contains(&x.as_str()))
                .collect();
            if bad.is_empty() {
                Ok(list.iter().cloned().collect::<BTreeSet<String>>())
            } else {
                Err(format!(
                    "{name} に選べるのは {} です（{}）。",
                    allowed.join("・"),
                    bad.iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join("・")
                ))
            }
        };
        let fields = match fields {
            Some(f) => Some(pick(f, FIELDS, "fields")?),
            None => None,
        };
        let omit = pick(omit.unwrap_or(&[]), OMITS, "omit")?;
        let at_ages = at_ages.unwrap_or(&[]).to_vec();
        if at_ages.len() > MAX_AT_AGES || at_ages.iter().any(|a| *a > 120) {
            return Err(format!(
                "at_ages は 0〜120 の年齢を {MAX_AT_AGES}個までにしてください。"
            ));
        }
        Ok(Self {
            every,
            fields,
            omit,
            at_ages,
        })
    }

    fn omits(&self, k: &str) -> bool {
        self.omit.contains(k)
    }

    /// 主な数字に年金の見込み（65歳からの月額）を入れるか（写しの要求をもう1〜2回計算するので、omit の pension で省ける。0199）
    fn wants_pension(&self) -> bool {
        !self.omits("keyFigures") && !self.omits("pension")
    }

    /// 年ごとの住宅ローンの数字を選んだか（0203）
    fn wants_loans(&self) -> bool {
        self.fields
            .as_ref()
            .is_some_and(|f| LOAN_FIELDS.iter().any(|k| f.contains(*k)))
    }

    /// fields・series でその数字を選んだか
    fn wants(&self, k: &str) -> bool {
        self.fields.as_ref().is_some_and(|f| f.contains(k))
    }

    /// 年ごとの収支の内訳を選んだか（0207）
    fn wants_flows(&self) -> bool {
        self.fields
            .as_ref()
            .is_some_and(|f| FLOW_FIELDS.iter().any(|k| f.contains(*k)))
    }

    /// 同梱した画面の関数（年齢・主な数字）を動かす要るか（年齢も主な数字も、人の鍵を添える物も要らなければ動かさない）
    fn needs_summary(&self, out: &Value) -> bool {
        self.wants_loans()
            || self.wants_flows()
            || !self.omits("ages")
            || !self.omits("keyFigures")
            || (!self.omits("protection") && out.get("protection").is_some())
            || (!self.omits("inheritanceTax") && out.get("inheritanceTax").is_some())
    }
}

/// 年齢と主な数字（同梱した画面の関数で数える。重いので、呼ぶ側は spawn_blocking の中で）。
/// out は表示の形の計算の出力、request は計算の前の処理を当てる前の要求、office は計算の前の処理に渡す事務所の推定の値。
/// 要らないとき・エンジンの誤りのときは Null
pub fn summary(
    out: &Value,
    request: &Value,
    opts: &Options,
    office: &Value,
) -> Result<Value, String> {
    if out.get("error").is_some() || !opts.needs_summary(out) {
        return Ok(Value::Null);
    }
    let mut args = Map::new();
    if !opts.at_ages.is_empty() {
        args.insert("atAges".into(), json!(opts.at_ages));
    }
    if opts.wants_pension() {
        args.insert("pension".into(), pension_results(request, office)?);
    }
    let args = Value::Object(args);
    let s = engine::summarize(&out.to_string(), &request.to_string(), &args.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

/// 年金の見込みの写しの要求（画面の比較の表の年金の行と同じ。0075・0199）を、画面と同じく計算の前の処理を当てて計算した結果
/// （`{ std, claimed }`。写しが無い・計算できないときは null）
fn pension_results(request: &Value, office: &Value) -> Result<Value, String> {
    let reqs: Value = serde_json::from_str(&engine::pension_requests(&request.to_string())?)
        .map_err(|e| e.to_string())?;
    let run = |r: &Value| -> Result<Value, String> {
        if r.is_null() {
            return Ok(Value::Null);
        }
        let p: Value = serde_json::from_str(&engine::prepare(&r.to_string(), &office.to_string())?)
            .map_err(|e| e.to_string())?;
        let out = engine::run_preview(&p["request"])?;
        Ok(if out.get("error").is_some() {
            Value::Null
        } else {
            out
        })
    };
    Ok(json!({ "std": run(&reqs["std"])?, "claimed": run(&reqs["claimed"])? }))
}

/// 何年おきに選ぶ年（最初の年と最後の年はいつも入る）
fn chosen_years(years: &BTreeSet<i64>, every: u8) -> BTreeSet<i64> {
    let (Some(first), Some(last)) = (years.first(), years.last()) else {
        return BTreeSet::new();
    };
    years
        .iter()
        .copied()
        .filter(|y| (y - first) % i64::from(every) == 0 || y == last)
        .collect()
}

/// 構成員の ID に年齢の鍵（self・spouse・child1 …）を添える
fn who(keys: &Value, id: &Value) -> Value {
    id.as_str()
        .and_then(|i| keys.get(i))
        .cloned()
        .unwrap_or(Value::Null)
}

/// 必要保障額の推移（エンジンの出力の protection）を、選んだ年に絞り、人に年齢の鍵を添える。detail が false なら内訳（breakdown・coverageBy）を省く
fn protection(p: &Value, keys: &Value, keep: &dyn Fn(i64) -> bool, detail: bool) -> Value {
    let mut p = p.clone();
    if let Some(members) = p["members"].as_array_mut() {
        for m in members {
            let w = who(keys, &m["member"]);
            if !w.is_null() {
                m["who"] = w;
            }
            let s = who(keys, &m["survivor"]);
            if !s.is_null() {
                m["survivorWho"] = s;
            }
            if let Some(ys) = m["years"].as_array_mut() {
                ys.retain(|y| y["year"].as_i64().is_some_and(keep));
                if !detail {
                    for y in ys.iter_mut().filter_map(Value::as_object_mut) {
                        y.remove("breakdown");
                        y.remove("coverageBy");
                    }
                }
            }
        }
    }
    p
}

/// 相続税の目安（エンジンの出力の inheritanceTax）の亡くなる人・相続人に年齢の鍵を添える
fn inheritance(t: &Value, keys: &Value) -> Value {
    let mut t = t.clone();
    if let Some(points) = t["points"].as_array_mut() {
        for p in points {
            let w = who(keys, &p["decedent"]);
            if !w.is_null() {
                p["decedentWho"] = w;
            }
            for list in ["heirs", "byHeir"] {
                if let Some(hs) = p[list].as_array_mut() {
                    for h in hs {
                        let w = who(keys, &h["member"]);
                        if !w.is_null() {
                            h["who"] = w;
                        }
                    }
                }
            }
        }
    }
    t
}

/// calc::shape の答えに足し、選んだ大きさに絞る。out はエンジンの出力、summary は [`summary`] の答え
pub fn finish(shaped: &mut Value, out: &Value, summary: &Value, mode: OutputMode, opts: &Options) {
    let Some(r) = shaped.as_object_mut() else {
        return;
    };
    let ages = &summary["ages"];
    let keys = &summary["memberKeys"];
    let with_ages = !opts.omits("ages") && ages.is_object();
    if with_ages {
        r.insert("members".into(), summary["members"].clone());
    }
    // 年: summary の years・table の行（どちらも from_year・to_year で絞った後）から選ぶ
    let list_key = match mode {
        OutputMode::Summary => "years",
        OutputMode::Table => "table",
    };
    let all: BTreeSet<i64> = r
        .get(list_key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x["year"].as_i64()).collect())
        .unwrap_or_default();
    // 年が1つも無い（行の絞り込みに当たらない）ときは、必要保障額の年は絞らない
    let chosen = chosen_years(&all, opts.every);
    let keep = |y: i64| all.is_empty() || chosen.contains(&y);
    if let Some(list) = r.get_mut(list_key).and_then(Value::as_array_mut) {
        list.retain(|x| x["year"].as_i64().is_some_and(keep));
    }
    match mode {
        OutputMode::Summary => {
            if let Some(list) = r.get_mut("years").and_then(Value::as_array_mut) {
                let loans = &summary["loanYears"];
                let flows = &summary["flowYears"];
                for y in list {
                    let Some(o) = y.as_object_mut() else { continue };
                    // 手取り（収入 − 税・社会保険料。主な数字の生涯の手取りの合計と同じ数え方。選んだときだけ。0207）
                    if opts.wants("takeHome") {
                        let num = |k: &str| o.get(k).and_then(Value::as_i64).unwrap_or(0);
                        let take_home = num("income") - num("taxSi");
                        o.insert("takeHome".into(), json!(take_home));
                    }
                    // 年ごとの収支の内訳は、選んだときだけ（0207）
                    if opts.wants_flows() {
                        let year = o.get("year").and_then(Value::as_i64).unwrap_or(0);
                        let f = &flows[year.to_string()];
                        for k in FLOW_FIELDS {
                            o.insert((*k).into(), json!(f[*k].as_i64().unwrap_or(0)));
                        }
                    }
                    // 年ごとの住宅ローンの数字は、選んだときだけ（0203）
                    if opts.wants_loans() {
                        let year = o.get("year").and_then(Value::as_i64).unwrap_or(0);
                        let l = &loans[year.to_string()];
                        for k in LOAN_FIELDS {
                            let v = if *k == "loanRate" {
                                l[*k].as_str().map_or(Value::Null, |s| json!(s))
                            } else {
                                json!(l[*k].as_i64().unwrap_or(0))
                            };
                            o.insert((*k).into(), v);
                        }
                    }
                    if let Some(f) = &opts.fields {
                        o.retain(|k, _| k == "year" || f.contains(k));
                    }
                    if with_ages {
                        let year = o.get("year").and_then(Value::as_i64).unwrap_or(0);
                        if let Some(a) = ages.get(year.to_string()) {
                            o.insert("ages".into(), a.clone());
                        }
                    }
                }
            }
            if opts.omits("years") {
                r.remove("years");
            }
        }
        OutputMode::Table => {
            if with_ages {
                let list: Vec<Value> = chosen
                    .iter()
                    .copied()
                    .filter_map(|y| {
                        let a = ages.get(y.to_string())?.as_object()?;
                        let mut m = Map::new();
                        m.insert("year".into(), json!(y));
                        m.extend(a.clone());
                        Some(Value::Object(m))
                    })
                    .collect();
                r.insert("ages".into(), Value::Array(list));
            }
            if let Some(s) = r.get_mut("summary").and_then(Value::as_object_mut) {
                if opts.omits("insurance") {
                    s.remove("insurance");
                }
                // ローンごとの年ごとの利息と金利（エンジンの要約の loans。0205）
                if opts.omits("loanInterest") {
                    s.remove("loans");
                }
            }
        }
    }
    if !opts.omits("keyFigures") && summary["keyFigures"].is_object() {
        let mut kf = summary["keyFigures"].clone();
        // 住宅ローンの利息の合計（0205）は omit の loanInterest で省ける
        if opts.omits("loanInterest") {
            if let Some(o) = kf.as_object_mut() {
                o.remove("loanInterest");
            }
        }
        r.insert("keyFigures".into(), kf);
    }
    if !opts.omits("protection") {
        if let Some(p) = out.get("protection") {
            let detail = !opts.omits("protectionDetail");
            r.insert("protection".into(), protection(p, keys, &keep, detail));
        }
    }
    if !opts.omits("inheritanceTax") {
        if let Some(t) = out.get("inheritanceTax") {
            r.insert("inheritanceTax".into(), inheritance(t, keys));
        }
    }
    for k in ["notices", "packs", "totals"] {
        if opts.omits(k) {
            r.remove(k);
        }
    }
}

/// 数字の根拠（explain_value）の答えから省ける物
pub const EXPLAIN_OMITS: &[&str] = &["sources", "params", "message"];

pub fn check_explanation_omit(omit: &[String]) -> Result<(), String> {
    let bad: Vec<&str> = omit
        .iter()
        .map(String::as_str)
        .filter(|x| !EXPLAIN_OMITS.contains(x))
        .collect();
    if bad.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "omit に選べるのは {} です（{}）。",
            EXPLAIN_OMITS.join("・"),
            bad.join("・")
        ))
    }
}

/// 数字の根拠の答えから、選んだ物を省く（中身は画面の根拠と同じまま、項目を落とすだけ）。
/// sources は制度の値の出典の文、params は使った制度の値（と同じ並びの ids.regulation）、message は読み方の案内
pub fn trim_explanation(v: &mut Value, omit: &[String]) {
    let has = |k: &str| omit.iter().any(|x| x == k);
    if has("params") {
        if let Some(e) = v["evidence"].as_object_mut() {
            e.remove("params");
        }
        if let Some(i) = v["ids"].as_object_mut() {
            i.remove("regulation");
        }
    } else if has("sources") {
        if let Some(ps) = v["evidence"]["params"].as_array_mut() {
            for p in ps {
                if let Some(o) = p.as_object_mut() {
                    o.remove("source");
                }
            }
        }
    }
    if has("message") {
        if let Some(o) = v.as_object_mut() {
            o.remove("message");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calc::{shape, TableFilter};

    fn out() -> Value {
        let mut table = vec![];
        for y in 2027..=2040 {
            table.push(
                json!({ "row": "cf.income.salary", "year": y, "amount": 100, "member": "m1" }),
            );
            table.push(json!({ "row": "cf.balance.financial", "year": y, "amount": 1000 - y }));
        }
        json!({
            "header": { "baseMonth": "2026-10", "endYear": 2040, "notices": [{ "code": "N_X", "ids": [] }], "data": [{ "packId": "p", "version": "1" }] },
            "table": table,
            "summary": { "totals": { "income": 1 }, "insurance": [{ "year": 2030 }] },
            "protection": { "method": "accumulation", "members": [{ "member": "m1", "survivor": "m2", "years": (2027..=2040).map(|y| json!({ "year": y, "need": 1, "breakdown": {}, "coverageBy": [] })).collect::<Vec<_>>() }] },
            "inheritanceTax": { "points": [{ "point": "now", "decedent": "m1", "totalTax": 0, "heirs": [{ "member": "m2" }], "byHeir": [{ "member": "m2" }] }], "notIncluded": [] },
        })
    }

    fn summary_answer() -> Value {
        let ages: Map<String, Value> = (2027..=2040)
            .map(|y| {
                (
                    y.to_string(),
                    json!({ "self": y - 1980, "spouse": y - 1982 }),
                )
            })
            .collect();
        json!({
            "members": [{ "key": "self", "label": "ご本人" }, { "key": "spouse", "label": "配偶者" }],
            "ages": ages,
            "memberKeys": { "m1": "self", "m2": "spouse" },
            "keyFigures": { "lifetimeTakeHome": 1 },
        })
    }

    fn all_years() -> TableFilter {
        TableFilter {
            rows: vec![],
            from_year: None,
            to_year: None,
        }
    }

    #[test]
    fn adds_without_changing_the_old_answer() {
        let o = out();
        let old = shape(&o, OutputMode::Summary, &all_years());
        let mut got = old.clone();
        finish(
            &mut got,
            &o,
            &summary_answer(),
            OutputMode::Summary,
            &Options::default_for_test(),
        );
        for (k, v) in old.as_object().unwrap() {
            if k == "years" {
                continue;
            }
            assert_eq!(&got[k], v, "{k}");
        }
        // 年ごとの数字は今までのまま、年齢が足される
        let y0 = &got["years"][0];
        assert_eq!(y0["ages"], json!({ "self": 47, "spouse": 45 }));
        let mut without = y0.clone();
        without.as_object_mut().unwrap().remove("ages");
        assert_eq!(without, old["years"][0]);
        assert_eq!(got["members"][0]["key"], "self");
        assert_eq!(got["keyFigures"]["lifetimeTakeHome"], 1);
        assert_eq!(got["protection"]["members"][0]["who"], "self");
        assert_eq!(got["protection"]["members"][0]["survivorWho"], "spouse");
        assert_eq!(got["inheritanceTax"]["points"][0]["decedentWho"], "self");
        assert_eq!(
            got["inheritanceTax"]["points"][0]["heirs"][0]["who"],
            "spouse"
        );
        assert_eq!(
            got["inheritanceTax"]["points"][0]["byHeir"][0]["who"],
            "spouse"
        );
        assert!(got["protection"]["members"][0]["years"][0]["breakdown"].is_object());
        assert!(!got.to_string().contains("memberKeys"));
    }

    #[test]
    fn narrows_by_every_years_fields_and_omit() {
        let o = out();
        let mut got = shape(&o, OutputMode::Summary, &all_years());
        let opts = Options::new(
            Some(5),
            Some(&["financialAssets".to_owned()]),
            Some(&[
                "notices".to_owned(),
                "packs".to_owned(),
                "ages".to_owned(),
                "protectionDetail".to_owned(),
            ]),
            None,
        )
        .unwrap();
        finish(&mut got, &o, &summary_answer(), OutputMode::Summary, &opts);
        let years: Vec<i64> = got["years"]
            .as_array()
            .unwrap()
            .iter()
            .map(|y| y["year"].as_i64().unwrap())
            .collect();
        assert_eq!(years, [2027, 2032, 2037, 2040]);
        assert_eq!(
            got["years"][0],
            json!({ "year": 2027, "financialAssets": 1000 - 2027 })
        );
        assert!(got.get("notices").is_none() && got.get("packs").is_none());
        assert!(got.get("members").is_none());
        let p: Vec<i64> = got["protection"]["members"][0]["years"]
            .as_array()
            .unwrap()
            .iter()
            .map(|y| y["year"].as_i64().unwrap())
            .collect();
        assert_eq!(p, years);
        assert_eq!(
            got["protection"]["members"][0]["years"][0],
            json!({ "year": 2027, "need": 1 })
        );

        // table: 行・年齢を同じ年に絞り、保険の年ごとの要約を省ける
        let mut t = shape(&o, OutputMode::Table, &all_years());
        let opts = Options::new(Some(5), None, Some(&["insurance".to_owned()]), None).unwrap();
        finish(&mut t, &o, &summary_answer(), OutputMode::Table, &opts);
        let ys: BTreeSet<i64> = t["table"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["year"].as_i64().unwrap())
            .collect();
        assert_eq!(ys.into_iter().collect::<Vec<_>>(), years);
        assert_eq!(t["ages"].as_array().unwrap().len(), years.len());
        assert_eq!(
            t["ages"][0],
            json!({ "year": 2027, "self": 47, "spouse": 45 })
        );
        assert!(t["summary"].get("insurance").is_none());
        assert!(t["summary"]["totals"].is_object());
    }

    #[test]
    fn loan_interest_and_rate_are_chosen_and_omitted() {
        let o = out();
        let mut s = summary_answer();
        s["keyFigures"]["loanInterest"] = json!(7807);
        s["loanYears"] = json!({ "2027": { "loanRepayment": 100, "loanBalance": 900, "loanInterest": 10, "loanRate": "0.0065" }, "2028": { "loanRepayment": 100, "loanBalance": 800, "loanInterest": 9, "loanRate": null } });
        // 選んだときだけ年ごとに入る（金利は10進の文字か null）
        let mut got = shape(&o, OutputMode::Summary, &all_years());
        let opts = Options::new(
            None,
            Some(&["loanInterest".to_owned(), "loanRate".to_owned()]),
            None,
            None,
        )
        .unwrap();
        finish(&mut got, &o, &s, OutputMode::Summary, &opts);
        assert_eq!(got["years"][0]["loanInterest"], 10);
        assert_eq!(got["years"][0]["loanRate"], "0.0065");
        assert!(got["years"][1]["loanRate"].is_null());
        assert!(got["years"][0].get("loanRepayment").is_none());
        assert_eq!(got["keyFigures"]["loanInterest"], 7807);
        // 既定では年ごとに入れない
        let mut plain = shape(&o, OutputMode::Summary, &all_years());
        finish(
            &mut plain,
            &o,
            &s,
            OutputMode::Summary,
            &Options::default_for_test(),
        );
        assert!(plain["years"][0].get("loanInterest").is_none());
        // omit の loanInterest で、主な数字の利息の合計と、table の要約のローンごとの数字を省く
        let mut t = shape(&o, OutputMode::Table, &all_years());
        t["summary"]["loans"] = json!([{ "object": "x" }]);
        let opts = Options::new(None, None, Some(&["loanInterest".to_owned()]), None).unwrap();
        finish(&mut t, &o, &s, OutputMode::Table, &opts);
        assert!(t["keyFigures"].get("loanInterest").is_none());
        assert!(t["summary"].get("loans").is_none());
        assert_eq!(t["keyFigures"]["lifetimeTakeHome"], 1);
    }

    #[test]
    fn rejects_unknown_choices() {
        assert!(Options::new(Some(0), None, None, None).is_err());
        assert!(Options::new(Some(11), None, None, None).is_err());
        let e = Options::new(None, Some(&["nope".to_owned()]), None, None).unwrap_err();
        assert!(e.contains("financialAssets") && e.contains("nope"), "{e}");
        assert!(Options::new(None, None, Some(&["x".to_owned()]), None).is_err());
        assert!(Options::new(None, None, None, Some(&[121])).is_err());
        assert!(Options::new(None, None, None, Some(&[60, 65, 70, 75, 80, 85])).is_err());
    }

    impl Options {
        fn default_for_test() -> Self {
            Options::new(None, None, None, None).unwrap()
        }
    }
}
