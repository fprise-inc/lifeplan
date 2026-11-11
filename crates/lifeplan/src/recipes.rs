//! よくある場面の部品の手本（0196）: 家を買う・子が生まれる・退職・繰上返済・NISA と iDeCo を始める・万一の想定。
//!
//! 世帯の入力（見本の世帯・渡された世帯・AI が組み立てた入力）を読み、その世帯の構成員・物の ID と配列の位置に合わせた
//! 変更（calculate の changes。JSON Pointer の add・replace・remove）を返す。関係する欄も一緒にそろえる（家なら頭金・諸費用・
//! 入居・住宅ローン・ローン控除の住宅の情報、子なら親子の関係・教育の目標・子の生活費）。世帯のデータは変えない（読むだけ）。
//! 手本の changes は、見本の世帯に当てて計算が通ることをテストで確かめる。

use crate::calc::{self, Change};
use crate::guide::new_uuid;
use serde_json::{json, Map, Value};

pub struct Recipe {
    pub key: &'static str,
    pub title: &'static str,
    pub params: &'static [(&'static str, &'static str)],
}

pub const RECIPES: &[Recipe] = &[
    Recipe {
        key: "buyHome",
        title: "家を買う（頭金・諸費用・入居・住宅ローン・住宅ローン控除の住宅の情報・固定資産税・修繕費。今の住まいはその前の月で住み終わり、持ち家なら売る）",
        params: &[
            ("at", "購入・入居の月 YYYY-MM（既定は計算基準月の1年後）"),
            ("price", "物件価格（円。既定 40000000）"),
            ("downPayment", "頭金（円。既定は価格の1割）"),
            ("costs", "諸費用（円。既定は新築で価格の5%、中古で7%）"),
            ("loan", "借入額（円。既定は価格−頭金。0 ならローンなし）"),
            ("rate", "金利（率の文字。既定 \"0.009\"）"),
            ("rateType", "variable・fixed・fixedPeriod（既定 variable）"),
            ("termMonths", "返済の月数（既定 420＝35年）"),
            ("newBuild", "新築か（真偽。既定 true）"),
            ("style", "house・condo（既定 house）"),
            ("propertyType", "住宅ローン控除の住宅の種類 certified・zeh・energySaving・other（既定 zeh。2028年以後の新築の省エネ基準適合住宅は控除の対象外になるため）"),
            ("propertyTax", "固定資産税・都市計画税の年額（円。既定は価格の0.3%）"),
            ("maintenance", "修繕費・管理費の月額（円。既定 house 15000・condo 30000）"),
            ("member", "名義の人（続柄の鍵 self・spouse か構成員の UUID。既定 self）"),
            ("sellCurrent", "今の持ち家を住み終わりの月に売るか（真偽。既定 true）"),
        ],
    },
    Recipe {
        key: "newChild",
        title: "子が生まれる（子の構成員・親子の関係・教育の目標・子の生活費。児童手当はエンジンが入れる）",
        params: &[
            ("birth", "生まれる月 YYYY-MM（既定は計算基準月の10か月後）"),
            ("sex", "female・male（既定 female）"),
            ("course", "進路 public（幼稚園〜高校は公立・大学は国立で自宅）・standard（幼稚園〜高校は公立・大学は私立の文科系で自宅）・private（幼稚園・中学・高校・大学が私立）（既定 standard）"),
            ("nursery", "0〜2歳に保育所を使うか（真偽。既定 false）"),
            ("living", "子の分の生活費の月額（円。既定 30000。独立の前の月まで。0 なら足さない）"),
        ],
    },
    Recipe {
        key: "retire",
        title: "退職の年齢を変える（画面の「働く最後の年齢」と同じく、働き方の期間・ご本人なら退職の段階の生活費・積立の終わりを一緒に動かす。再雇用は入れない）",
        params: &[
            ("member", "退職する人（続柄の鍵 self・spouse か構成員の UUID。既定 self）"),
            ("age", "働く最後の年齢（その年齢に達する月の前の月まで働く。既定 60）"),
            ("lastMonth", "働く最後の月 YYYY-MM（age の代わりに。書くと age は使わない）"),
        ],
    },
    Recipe {
        key: "prepayment",
        title: "繰上返済を足す",
        params: &[
            ("debt", "負債の UUID（既定は最初の住宅ローン、無ければ最初の負債）"),
            ("at", "繰上返済の月 YYYY-MM（既定は計算基準月の5年後）"),
            ("amount", "繰上返済の額（円。既定 1000000）"),
            ("mode", "shortenTerm（期間短縮）・reducePayment（返済額軽減）（既定 shortenTerm）"),
            ("fee", "手数料（円。既定 0）"),
        ],
    },
    Recipe {
        key: "startNisaIdeco",
        title: "NISA と iDeCo を始める（その人の NISA・iDeCo の口座が無ければ作り、積立を足す。積立の終わりは空＝退職の月まで）",
        params: &[
            ("member", "積み立てる人（続柄の鍵か構成員の UUID。既定 self）"),
            ("from", "積立を始める月 YYYY-MM（既定は計算基準月の翌月）"),
            ("nisaMonthly", "NISA のつみたて投資枠の月額（円。既定 30000。0 なら足さない）"),
            ("nisaGrowthMonthly", "NISA の成長投資枠の月額（円。既定 0）"),
            ("idecoMonthly", "iDeCo の掛金の月額（円。既定 20000。0 なら足さない。限度額はエンジンが確かめる）"),
        ],
    },
    Recipe {
        key: "contingency",
        title: "万一の想定（死亡・障害・就業不能。1件まで。今の想定があれば置き換える）",
        params: &[
            ("kind", "death・disability・incapacity（既定 death）"),
            ("member", "対象の人（続柄の鍵か構成員の UUID。既定 self）"),
            ("occurs", "起きる月 YYYY-MM（既定は計算基準月の5年後）"),
            ("grade", "障害等級 1〜3（disability のとき。既定 2）"),
            ("funeral", "整理資金（円。death のとき。既定 2000000）"),
            ("protection", "必要保障額の推移（/protection）も足すか（真偽。既定 false）"),
        ],
    },
];

pub fn list() -> Value {
    let list: Vec<Value> = RECIPES
        .iter()
        .map(|r| {
            let params: Map<String, Value> = r
                .params
                .iter()
                .map(|(k, d)| ((*k).to_owned(), json!(d)))
                .collect();
            json!({ "recipe": r.key, "title": r.title, "params": params })
        })
        .collect();
    json!({
        "recipes": list,
        "note": "recipe と世帯（sample_household_id・share_id・input のどれか1つ）を渡すと、その世帯の ID と配列の位置に合わせた changes を返します。params は省けます（既定の値を答えの params に出します）。"
    })
}

/// 手本を当てた結果
pub struct Built {
    pub changes: Vec<Value>,
    pub notes: Vec<String>,
    pub used: Map<String, Value>,
    /// changes を当てた後の入力
    pub input: Value,
}

// ---------- 年月 ----------

fn ym_n(s: &str) -> Option<i64> {
    let (y, m) = s.split_once('-')?;
    let (y, m): (i64, i64) = (y.parse().ok()?, m.parse().ok()?);
    (s.len() == 7 && (1..=12).contains(&m)).then_some(y * 12 + m - 1)
}

fn n_ym(n: i64) -> String {
    format!("{:04}-{:02}", n.div_euclid(12), n.rem_euclid(12) + 1)
}

fn add_months(s: &str, k: i64) -> String {
    ym_n(s).map(|n| n_ym(n + k)).unwrap_or_else(|| s.to_owned())
}

fn box_yen(v: i64) -> Value {
    json!({ "value": v, "state": "confirmed", "origin": { "kind": "manual" } })
}

/// 時点を年月にする（{at}・{event}・{memberAge} の分かる物だけ）
fn at_of(input: &Value, tp: &Value) -> Option<String> {
    if let Some(a) = tp.get("at").and_then(Value::as_str) {
        return Some(a.to_owned());
    }
    if let Some(e) = tp.get("event").and_then(Value::as_str) {
        let ev = input["household"]["events"]
            .as_array()?
            .iter()
            .find(|x| x["id"] == e)?;
        return at_of(input, &ev["at"]);
    }
    if let Some(ma) = tp.get("memberAge") {
        let m = member_by_id(input, ma["member"].as_str()?)?;
        let birth = ym_n(m["birth"]["birthYearMonth"].as_str()?)?;
        let years = ma["years"].as_i64()?;
        let months = ma["months"].as_i64().unwrap_or(0);
        return Some(n_ym(birth + years * 12 + months));
    }
    None
}

fn members(input: &Value) -> Vec<&Value> {
    input["household"]["members"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

fn member_by_id<'a>(input: &'a Value, id: &str) -> Option<&'a Value> {
    members(input).into_iter().find(|m| m["id"] == id)
}

// ---------- 引数 ----------

struct Params<'a> {
    v: &'a Map<String, Value>,
    used: Map<String, Value>,
}

impl<'a> Params<'a> {
    fn raw(&self, k: &str) -> Option<&'a Value> {
        self.v.get(k).filter(|x| !x.is_null())
    }
    fn ym(&mut self, k: &str, default: String) -> Result<String, String> {
        let v = match self.raw(k) {
            Some(x) => {
                let s = x.as_str().unwrap_or("");
                if ym_n(s).is_none() {
                    return Err(format!(
                        "params の {k} は年月 \"YYYY-MM\" の文字にしてください。"
                    ));
                }
                s.to_owned()
            }
            None => default,
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    fn yen(&mut self, k: &str, default: i64) -> Result<i64, String> {
        let v = match self.raw(k) {
            Some(x) => x.as_i64().filter(|n| *n >= 0).ok_or_else(|| {
                format!("params の {k} は円の整数（0以上。万円にしない）にしてください。")
            })?,
            None => default,
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    fn int(&mut self, k: &str, default: i64, min: i64, max: i64) -> Result<i64, String> {
        let v = match self.raw(k) {
            Some(x) => x
                .as_i64()
                .filter(|n| (min..=max).contains(n))
                .ok_or_else(|| format!("params の {k} は {min}〜{max} の整数にしてください。"))?,
            None => default,
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    fn rate(&mut self, k: &str, default: &str) -> Result<String, String> {
        let v = match self.raw(k) {
            Some(Value::String(s)) if s.parse::<f64>().is_ok() && !s.contains(['e', 'E']) => {
                s.clone()
            }
            Some(_) => {
                return Err(format!(
                    "params の {k} は率の文字（例 \"0.009\"）にしてください。"
                ))
            }
            None => default.to_owned(),
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    fn choice(&mut self, k: &str, default: &str, options: &[&str]) -> Result<String, String> {
        let v = match self.raw(k) {
            Some(x) => {
                let s = x.as_str().unwrap_or("");
                if !options.contains(&s) {
                    return Err(format!(
                        "params の {k} は {} のどれかです。",
                        options.join("・")
                    ));
                }
                s.to_owned()
            }
            None => default.to_owned(),
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    fn flag(&mut self, k: &str, default: bool) -> Result<bool, String> {
        let v = match self.raw(k) {
            Some(x) => x
                .as_bool()
                .ok_or_else(|| format!("params の {k} は true か false にしてください。"))?,
            None => default,
        };
        self.used.insert(k.into(), json!(v));
        Ok(v)
    }
    /// 人: 続柄の鍵（self・spouse・child1…）か構成員の UUID
    fn member<'b>(
        &mut self,
        input: &'b Value,
        k: &str,
        default: &str,
    ) -> Result<&'b Value, String> {
        let want = match self.raw(k) {
            Some(x) => x
                .as_str()
                .ok_or_else(|| format!("params の {k} は続柄の鍵（self・spouse・child1…）か構成員の UUID にしてください。"))?
                .to_owned(),
            None => default.to_owned(),
        };
        let all = members(input);
        let found = all
            .iter()
            .copied()
            .find(|m| m["id"] == want.as_str())
            .or_else(|| {
                let (kind, n) = match want.strip_prefix("child") {
                    Some(rest) if !rest.is_empty() => ("child", rest.parse::<usize>().ok()?),
                    _ => (want.as_str(), 1),
                };
                all.iter()
                    .copied()
                    .filter(|m| m["kind"] == kind)
                    .nth(n.checked_sub(1)?)
            });
        let m = found.ok_or_else(|| {
            format!("この世帯に {want} の構成員がいません（params の {k} に続柄の鍵か構成員の UUID を）。")
        })?;
        self.used.insert(k.into(), json!(want));
        Ok(m)
    }
}

// ---------- 変更を積む ----------

struct Work {
    w: Value,
    changes: Vec<Value>,
}

impl Work {
    fn apply(&mut self, op: &str, path: &str, value: Option<Value>) -> Result<(), String> {
        let c = Change {
            op: op.to_owned(),
            path: path.to_owned(),
            value: value.clone(),
        };
        self.w = calc::apply_changes(&self.w, &[c])?;
        let mut j = json!({ "op": op, "path": path });
        if let Some(v) = value {
            j["value"] = v;
        }
        self.changes.push(j);
        Ok(())
    }
    /// 配列に1件足す（配列が無ければ配列ごと足す）
    fn push(&mut self, array_path: &str, item: Value) -> Result<(), String> {
        if self.w.pointer(array_path).is_some_and(Value::is_array) {
            self.apply("add", &format!("{array_path}/-"), Some(item))
        } else {
            self.apply("add", array_path, Some(json!([item])))
        }
    }
    fn list(&self, path: &str) -> Vec<Value> {
        self.w
            .pointer(path)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }
}

fn base_month(input: &Value) -> Result<String, String> {
    input["baseMonth"]
        .as_str()
        .filter(|s| ym_n(s).is_some())
        .map(str::to_owned)
        .ok_or_else(|| "入力に baseMonth（YYYY-MM）がありません。".to_owned())
}

/// 手本を世帯に当てる。input は世帯の入力（calculate の input と同じ形）、params は手本ごとの引数
pub fn build(key: &str, input: &Value, params: &Value) -> Result<Built, String> {
    let recipe = RECIPES.iter().find(|r| r.key == key).ok_or_else(|| {
        format!(
            "手本 {key} はありません。{} のどれかです（recipe を省くと一覧）。",
            RECIPES.iter().map(|r| r.key).collect::<Vec<_>>().join("・")
        )
    })?;
    let empty = Map::new();
    let pm = match params {
        Value::Null => &empty,
        Value::Object(m) => m,
        _ => return Err("params は物（JSON の object）にしてください。".into()),
    };
    if let Some(bad) = pm
        .keys()
        .find(|k| !recipe.params.iter().any(|(p, _)| p == k))
    {
        return Err(format!(
            "params の {bad} はこの手本にありません。使える params: {}",
            recipe
                .params
                .iter()
                .map(|(p, _)| *p)
                .collect::<Vec<_>>()
                .join("・")
        ));
    }
    if !input["household"].is_object() {
        return Err(
            "入力に household がありません（get_input_guide の skeleton を手本に）。".into(),
        );
    }
    let mut p = Params {
        v: pm,
        used: Map::new(),
    };
    let mut work = Work {
        w: input.clone(),
        changes: Vec::new(),
    };
    let notes = match key {
        "buyHome" => buy_home(input, &mut p, &mut work)?,
        "newChild" => new_child(input, &mut p, &mut work)?,
        "retire" => retire(input, &mut p, &mut work)?,
        "prepayment" => prepayment(input, &mut p, &mut work)?,
        "startNisaIdeco" => start_nisa_ideco(input, &mut p, &mut work)?,
        "contingency" => contingency(input, &mut p, &mut work)?,
        _ => unreachable!(),
    };
    Ok(Built {
        changes: work.changes,
        notes,
        used: p.used,
        input: work.w,
    })
}

fn buy_home(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let base = base_month(input)?;
    let at = p.ym("at", add_months(&base, 12))?;
    if at <= base {
        return Err("params の at は計算基準月より後の月にしてください（もう住んでいる家は residences と debts に今の残高で入れます）。".into());
    }
    let price = p.yen("price", 40_000_000)?;
    let down = p.yen("downPayment", price / 10)?;
    let new_build = p.flag("newBuild", true)?;
    let cost_rate = if new_build { 5 } else { 7 };
    let costs = p.yen("costs", (price * cost_rate / 100 + 5_000) / 10_000 * 10_000)?;
    if down > price {
        return Err("頭金が物件価格より大きくなっています。".into());
    }
    let loan = p.yen("loan", price - down)?;
    let rate = p.rate("rate", "0.009")?;
    let rate_type = p.choice(
        "rateType",
        "variable",
        &["variable", "fixed", "fixedPeriod"],
    )?;
    let term = p.int("termMonths", 420, 1, 600)?;
    let style = p.choice("style", "house", &["house", "condo"])?;
    let ptype = p.choice(
        "propertyType",
        "zeh",
        &["certified", "zeh", "energySaving", "other"],
    )?;
    let tax = p.yen("propertyTax", (price * 3 / 1000 + 5_000) / 10_000 * 10_000)?;
    let maint = p.yen(
        "maintenance",
        if style == "condo" { 30_000 } else { 15_000 },
    )?;
    let owner = p.member(input, "member", "self")?;
    let owner_id = owner["id"].clone();
    let sell = p.flag("sellCurrent", true)?;
    let mut notes = Vec::new();

    // 今の住まいは、購入の前の月で住み終わり
    let before = add_months(&at, -1);
    for (i, r) in w.list("/household/residences").iter().enumerate() {
        let ends_later = match &r["to"] {
            Value::Null => true,
            tp => at_of(input, tp).is_some_and(|t| t >= at),
        };
        let starts_before = at_of(input, &r["from"]).is_none_or(|f| f < at);
        if ends_later && starts_before {
            w.apply(
                "replace",
                &format!("/household/residences/{i}/to"),
                Some(json!({ "at": before })),
            )?;
            if r["kind"] == "own" {
                if sell && r.get("sale").is_none() {
                    w.apply(
                        "add",
                        &format!("/household/residences/{i}/sale"),
                        Some(json!({})),
                    )?;
                    notes.push(format!("今の持ち家（/household/residences/{i}）は {before} で住み終わり、その月に評価額で売ります（sale。売却の費用は目安の割合。この家の住宅ローンは売ったときに返します。譲渡所得の税は計算しないので、かかるなら額を sale.tax に）。売らないなら sellCurrent: false"));
                } else {
                    notes.push(format!(
                        "今の持ち家（/household/residences/{i}）は {before} で住み終わりにしました"
                    ));
                }
            } else {
                notes.push(format!(
                    "今の賃貸（/household/residences/{i}）は {before} で住み終わりにしました"
                ));
            }
        }
    }
    let move_in = new_uuid();
    w.push(
        "/household/events",
        json!({ "id": move_in, "kind": "moveIn", "at": { "at": at } }),
    )?;
    let home = new_uuid();
    let built_year: i64 = at[..4].parse().unwrap_or(2030);
    w.push(
        "/household/residences",
        json!({
            "id": home, "kind": "own", "from": { "event": move_in }, "to": null, "style": style,
            "purchase": { "price": price, "downPayment": down, "costs": costs, "newBuild": new_build },
            "propertyTax": { "annual": box_yen(tax), "growth": "0" },
            "maintenance": { "monthly": box_yen(maint), "growth": "0.01" },
            "ownership": [{ "member": owner_id, "share": "1" }],
            "valuation": { "structure": if style == "condo" { "rc" } else { "wood" }, "builtYear": if new_build { built_year } else { built_year - 15 } }
        }),
    )?;
    notes.push(format!("頭金 {down}円と諸費用 {costs}円は {at} に金融資産から出ます（足りないと不足の行に出ます）。固定資産税・修繕費は目安です"));
    if loan > 0 {
        let mut repayment = json!({ "method": "equalPayment", "termMonths": term });
        if rate_type == "variable" {
            repayment["variableRules"] = json!({ "fiveYear": true, "cap125": true });
        }
        w.push(
            "/household/debts",
            json!({
                "id": new_uuid(), "kind": "mortgage", "debtors": [{ "member": owner_id, "role": "primary" }],
                "principal": loan, "start": { "at": at },
                "rateSchedule": [{ "from": { "at": at }, "type": rate_type, "rate": rate }],
                "repayment": repayment, "prepayments": [],
                "creditLife": { "covered": [owner_id], "ratio": "1", "events": ["death"] },
                "housing": { "residence": home, "moveIn": move_in, "propertyType": ptype, "newBuild": new_build, "acquisitionCost": price, "ownership": [{ "member": owner_id, "share": "1" }] }
            }),
        )?;
        notes.push(format!("住宅ローン {loan}円（{rate_type}・年利 {rate}・{term}か月・元利均等・返済は借入の翌月から・団信は死亡）。住宅ローン控除は住宅の種類 {ptype} と入居の年で判定します（答えの知らせに N_NOT_ELIGIBLE が出たら控除の対象外）"));
    } else {
        notes.push("ローンなし（現金で買う）".into());
    }
    Ok(notes)
}

/// 学年の4月（その年度に入学する年）: 1〜3月生まれは前の年度の学年
fn school_start(birth: &str, age: i64) -> String {
    let n = ym_n(birth).unwrap_or(0);
    let (y, m) = (n.div_euclid(12), n.rem_euclid(12) + 1);
    let y0 = if m <= 3 { y - 1 } else { y };
    format!("{:04}-04", y0 + age + 1)
}

fn new_child(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let base = base_month(input)?;
    let birth = p.ym("birth", add_months(&base, 10))?;
    let sex = p.choice("sex", "female", &["female", "male"])?;
    let course = p.choice("course", "standard", &["public", "standard", "private"])?;
    let nursery = p.flag("nursery", false)?;
    let living = p.yen("living", 30_000)?;
    let parents: Vec<Value> = members(input)
        .into_iter()
        .filter(|m| m["kind"] == "self" || m["kind"] == "spouse")
        .map(|m| m["id"].clone())
        .collect();
    if parents.is_empty() {
        return Err("この世帯に本人（kind が self）の構成員がいません。".into());
    }
    // 大学を出た翌月の4月に独立（世帯を離れる）
    let leaves = school_start(&birth, 22);
    let child = new_uuid();
    w.push(
        "/household/members",
        json!({ "id": child, "kind": "child", "birth": { "birthYearMonth": birth, "bornOnFirst": false }, "sex": sex, "joins": null, "leaves": { "at": leaves }, "expected": false }),
    )?;
    for parent in &parents {
        w.push(
            "/household/relations",
            json!({ "type": "parentOf", "parent": parent, "child": child }),
        )?;
    }
    let mut stages = Vec::new();
    if nursery {
        stages.push(json!({ "stage": "nursery" }));
    }
    let (kg, js, hs, uni) = match course.as_str() {
        "public" => (
            "public",
            "public",
            "public",
            json!({ "stage": "university", "sector": "national", "living": "home" }),
        ),
        "private" => (
            "private",
            "private",
            "private",
            json!({ "stage": "university", "sector": "private", "field": "humanities", "living": "home" }),
        ),
        _ => (
            "public",
            "public",
            "public",
            json!({ "stage": "university", "sector": "private", "field": "humanities", "living": "home" }),
        ),
    };
    stages.push(json!({ "stage": "kindergarten", "sector": kg }));
    stages.push(json!({ "stage": "elementary", "sector": "public" }));
    stages.push(json!({ "stage": "juniorHigh", "sector": js }));
    stages.push(json!({ "stage": "highSchool", "sector": hs }));
    stages.push(uni);
    w.push(
        "/household/goals",
        json!({ "id": new_uuid(), "kind": "education", "owner": child, "education": { "stages": stages } }),
    )?;
    let mut notes = vec![
        format!("子（{birth} 生まれ）を足し、本人と配偶者との親子の関係を足しました。{leaves} に独立（世帯を離れる）とします"),
        format!("教育の目標（{course}）: 費用は統計の目安で入ります。学校を決めたら goals の stages を直します"),
        "児童手当はエンジンが自動で入れます。出産・育児休業での収入の変化は入れていません（働き方の期間の type leave で入れます）".into(),
    ];
    if living > 0 {
        w.push(
            "/household/livingExpenses",
            json!({ "id": new_uuid(), "mode": "total", "from": { "at": birth }, "to": { "at": add_months(&leaves, -1) }, "monthly": box_yen(living) }),
        )?;
        notes.push(format!("子の分の生活費 月{living}円を、生まれた月から独立の前の月まで、別の生活費の行で足しました（今の生活費の行は変えていません）"));
    }
    Ok(notes)
}

fn retire(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let m = p.member(input, "member", "self")?;
    let mid = m["id"].as_str().unwrap_or("").to_owned();
    let birth = m["birth"]["birthYearMonth"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    let (last, stage_at) = if p.raw("lastMonth").is_some() {
        let lm = p.ym("lastMonth", String::new())?;
        (lm.clone(), add_months(&lm, 1))
    } else {
        let age = p.int("age", 60, 18, 90)?;
        if ym_n(&birth).is_none() {
            return Err(
                "その人の生年月が入力にありません（lastMonth で月を指定してください）。".into(),
            );
        }
        let reach = add_months(&birth, age * 12);
        (add_months(&reach, -1), reach)
    };
    let periods = w.list("/household/employmentPeriods");
    let mine: Vec<(usize, Value)> = periods
        .iter()
        .enumerate()
        .filter(|(_, e)| e["member"] == mid.as_str())
        .map(|(i, e)| (i, e.clone()))
        .collect();
    if mine.is_empty() {
        return Err("この人の働き方の期間（employmentPeriods）がありません。".into());
    }
    let old_end = mine
        .iter()
        .filter_map(|(_, e)| at_of(input, &e["to"]))
        .max();
    // その月より後に始まる期間は外し（後ろから）、またぐ期間はその月で終える
    let mut removed = 0;
    for (i, e) in mine.iter().rev() {
        if at_of(input, &e["from"]).is_some_and(|f| f > last) {
            w.apply("remove", &format!("/household/employmentPeriods/{i}"), None)?;
            removed += 1;
        }
    }
    let periods = w.list("/household/employmentPeriods");
    let kept: Vec<usize> = periods
        .iter()
        .enumerate()
        .filter(|(_, e)| e["member"] == mid.as_str())
        .map(|(i, _)| i)
        .collect();
    let mut last_end: Option<String> = None;
    for i in &kept {
        let e = &periods[*i];
        let to = at_of(input, &e["to"]);
        let end = match &to {
            None => {
                w.apply(
                    "replace",
                    &format!("/household/employmentPeriods/{i}/to"),
                    Some(json!({ "at": last })),
                )?;
                last.clone()
            }
            Some(t) if *t > last => {
                w.apply(
                    "replace",
                    &format!("/household/employmentPeriods/{i}/to"),
                    Some(json!({ "at": last })),
                )?;
                last.clone()
            }
            Some(t) => t.clone(),
        };
        last_end = last_end.max(Some(end));
    }
    // もっと長く働く: 最後の期間をその月まで延ばす
    if let Some(le) = &last_end {
        if *le < last {
            if let Some(i) = kept
                .iter()
                .copied()
                .find(|i| at_of(input, &periods[*i]["to"]).as_deref() == Some(le.as_str()))
            {
                w.apply(
                    "replace",
                    &format!("/household/employmentPeriods/{i}/to"),
                    Some(json!({ "at": last })),
                )?;
            }
        }
    }
    let mut notes = vec![format!(
        "{last} まで働く（働き方の期間を終える・延ばす。{removed}件の後の期間を外した）"
    )];
    if m["kind"] == "self" {
        for (i, l) in w.list("/household/livingExpenses").iter().enumerate() {
            for (j, s) in l["stages"].as_array().into_iter().flatten().enumerate() {
                if s["label"] == "retirement" {
                    w.apply(
                        "replace",
                        &format!("/household/livingExpenses/{i}/stages/{j}/at"),
                        Some(json!({ "at": stage_at })),
                    )?;
                    notes.push(format!("生活費の退職の段階を {stage_at} からにしました"));
                }
            }
        }
    }
    if let Some(oe) = old_end {
        for (i, a) in w.list("/household/accounts").iter().enumerate() {
            if a["owner"] != mid.as_str() {
                continue;
            }
            for (j, c) in a["contributions"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                if at_of(input, &c["to"]).as_deref() == Some(oe.as_str()) {
                    w.apply(
                        "replace",
                        &format!("/household/accounts/{i}/contributions/{j}/to"),
                        Some(json!({ "at": last })),
                    )?;
                    notes.push(format!("積立（/household/accounts/{i}/contributions/{j}）の終わりを {last} にしました"));
                }
            }
        }
    }
    notes.push("退職金（retirementBenefits）は働き方の期間の終わりに合わせて入ります。再雇用・年金の受け取り開始は変えていません（必要なら changes で直します）".into());
    Ok(notes)
}

fn prepayment(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let base = base_month(input)?;
    let debts = w.list("/household/debts");
    if debts.is_empty() {
        return Err("この世帯には負債（debts）がありません（家を買う手本 buyHome を先に当てるか、ローンを入れてから）。".into());
    }
    let i = match p.raw("debt") {
        Some(x) => {
            let id = x.as_str().unwrap_or("");
            p.used.insert("debt".into(), json!(id));
            debts
                .iter()
                .position(|d| d["id"] == id)
                .ok_or_else(|| format!("負債 {id} はこの世帯にありません。"))?
        }
        None => debts
            .iter()
            .position(|d| d["kind"] == "mortgage")
            .unwrap_or(0),
    };
    let at = p.ym("at", add_months(&base, 60))?;
    let amount = p.yen("amount", 1_000_000)?;
    let mode = p.choice("mode", "shortenTerm", &["shortenTerm", "reducePayment"])?;
    let fee = p.yen("fee", 0)?;
    w.push(
        &format!("/household/debts/{i}/prepayments"),
        json!({ "at": { "at": at }, "amount": amount, "mode": mode, "fee": fee }),
    )?;
    Ok(vec![format!(
        "/household/debts/{i} に {at} の繰上返済 {amount}円（{mode}）を足しました。返済が終わった後の月や残高より多い額は、エンジンが残高までにします"
    )])
}

fn start_nisa_ideco(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let base = base_month(input)?;
    let m = p.member(input, "member", "self")?;
    let mid = m["id"].clone();
    let from = p.ym("from", add_months(&base, 1))?;
    let nisa = p.yen("nisaMonthly", 30_000)?;
    let growth = p.yen("nisaGrowthMonthly", 0)?;
    let ideco = p.yen("idecoMonthly", 20_000)?;
    let as_of = add_months(&base, -1);
    let mut notes = Vec::new();
    let mut nisa_rows = Vec::new();
    if nisa > 0 {
        nisa_rows.push(json!({ "from": { "at": from }, "to": null, "monthly": nisa }));
    }
    if growth > 0 {
        nisa_rows.push(
            json!({ "from": { "at": from }, "to": null, "monthly": growth, "tranche": "growth" }),
        );
    }
    if !nisa_rows.is_empty() {
        let accounts = w.list("/household/accounts");
        match accounts
            .iter()
            .position(|a| a["kind"] == "nisa" && a["owner"] == mid)
        {
            Some(i) => {
                for r in nisa_rows {
                    w.push(&format!("/household/accounts/{i}/contributions"), r)?;
                }
                notes.push(format!("今の NISA（/household/accounts/{i}）に {from} からの積立を足しました（今の積立があれば、その上に足します）"));
            }
            None => {
                w.push(
                    "/household/accounts",
                    json!({ "id": new_uuid(), "kind": "nisa", "owner": mid, "marketValue": box_yen(0), "costBasis": box_yen(0), "asOf": as_of, "contributions": nisa_rows }),
                )?;
                notes.push(format!(
                    "NISA の口座（残高0円）を作り、{from} からの積立を足しました"
                ));
            }
        }
    }
    if ideco > 0 {
        let row = json!({ "from": { "at": from }, "to": null, "monthly": ideco });
        let accounts = w.list("/household/accounts");
        match accounts
            .iter()
            .position(|a| a["kind"] == "ideco" && a["owner"] == mid)
        {
            Some(i) => {
                w.push(&format!("/household/accounts/{i}/contributions"), row)?;
                notes.push(format!(
                    "今の iDeCo（/household/accounts/{i}）に {from} からの掛金を足しました"
                ));
            }
            None => {
                w.push(
                    "/household/accounts",
                    json!({ "id": new_uuid(), "kind": "ideco", "owner": mid, "marketValue": box_yen(0), "asOf": as_of, "enrolledSince": from, "contributions": [row] }),
                )?;
                notes.push(format!("iDeCo の口座（残高0円・{from} から加入）を作り、掛金を足しました。受け取り方（payout）は省いたので、エンジンの既定で受け取ります"));
            }
        }
    }
    if nisa == 0 && growth == 0 && ideco == 0 {
        return Err("nisaMonthly・nisaGrowthMonthly・idecoMonthly がどれも0です。".into());
    }
    notes.push("積立・掛金は家計から出ます（金融資産のうち預金が減り、NISA・iDeCo が増えます）。利回りは前提の運用利回りか、口座の expectedReturn で決まります".into());
    Ok(notes)
}

fn contingency(input: &Value, p: &mut Params, w: &mut Work) -> Result<Vec<String>, String> {
    let base = base_month(input)?;
    let kind = p.choice("kind", "death", &["death", "disability", "incapacity"])?;
    let m = p.member(input, "member", "self")?;
    let occurs = p.ym("occurs", add_months(&base, 60))?;
    let mut c =
        json!({ "id": new_uuid(), "kind": kind, "member": m["id"], "occurs": { "at": occurs } });
    match kind.as_str() {
        "death" => {
            let funeral = p.yen("funeral", 2_000_000)?;
            c["survivor"] = json!({ "funeral": funeral });
        }
        "disability" => {
            let grade = p.int("grade", 2, 1, 3)?;
            c["grade"] = json!(grade);
        }
        _ => {}
    }
    let protection = p.flag("protection", false)?;
    let exists = w.w.get("contingencies").is_some();
    w.apply(
        if exists { "replace" } else { "add" },
        "/contingencies",
        Some(json!([c])),
    )?;
    let mut notes = vec![format!(
        "万一の想定（{kind}・{occurs}）を /contingencies に入れました{}。遺族年金・団信・保険金などはエンジンが入れます",
        if exists { "（今の想定と置き換え）" } else { "" }
    )];
    if protection {
        let ids: Vec<Value> = members(input)
            .into_iter()
            .filter(|x| x["kind"] == "self" || x["kind"] == "spouse")
            .map(|x| x["id"].clone())
            .collect();
        let op = if w.w.get("protection").is_some() {
            "replace"
        } else {
            "add"
        };
        w.apply(
            op,
            "/protection",
            Some(json!({ "members": ids, "method": "accumulation" })),
        )?;
        notes.push("必要保障額の推移（積み上げ方式）を /protection に入れました（計算の答えの保障の数字に出ます）".into());
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_and_school_years() {
        assert_eq!(add_months("2026-10", 3), "2027-01");
        assert_eq!(add_months("2026-01", -1), "2025-12");
        // 2027年5月生まれは 2034年4月に小学校、2027年2月生まれは 2033年4月
        assert_eq!(school_start("2027-05", 6), "2034-04");
        assert_eq!(school_start("2027-02", 6), "2033-04");
        assert_eq!(school_start("2027-05", 22), "2050-04");
    }

    #[test]
    fn unknown_recipe_and_params_are_explained() {
        let input = crate::guide::skeleton();
        assert!(build("nope", &input, &Value::Null)
            .err()
            .unwrap()
            .contains("buyHome"));
        let e = build("buyHome", &input, &json!({ "prise": 1 }))
            .err()
            .unwrap();
        assert!(e.contains("price"), "{e}");
        let e = build("buyHome", &input, &json!({ "price": "4000万円" }))
            .err()
            .unwrap();
        assert!(e.contains("円の整数"), "{e}");
    }

    #[test]
    fn recipes_wire_ids_of_the_household() {
        let input = crate::guide::skeleton();
        let b = build("newChild", &input, &json!({ "birth": "2027-06" })).unwrap();
        let child = b.input["household"]["members"][2]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            b.input["household"]["relations"].as_array().unwrap().len(),
            3
        );
        assert_eq!(b.input["household"]["goals"][0]["owner"], child.as_str());
        assert_eq!(
            b.input["household"]["livingExpenses"][1]["to"]["at"],
            "2050-03"
        );
        let h = build("buyHome", &b.input, &Value::Null).unwrap();
        assert_eq!(h.input["household"]["residences"][0]["to"]["at"], "2027-09");
        let debt = &h.input["household"]["debts"][0];
        assert_eq!(
            debt["housing"]["residence"],
            h.input["household"]["residences"][1]["id"]
        );
        assert_eq!(debt["principal"], 36_000_000);
        let pp = build("prepayment", &h.input, &json!({ "amount": 2_000_000 })).unwrap();
        assert_eq!(pp.changes[0]["path"], "/household/debts/0/prepayments/-");
        let r = build("retire", &input, &json!({ "age": 65 })).unwrap();
        assert_eq!(
            r.input["household"]["employmentPeriods"][0]["to"]["at"],
            "2053-04"
        );
        assert_eq!(
            r.input["household"]["livingExpenses"][0]["stages"][0]["at"]["at"],
            "2053-05"
        );
        let r = build("retire", &input, &json!({ "age": 60 })).unwrap();
        assert_eq!(
            r.input["household"]["employmentPeriods"][0]["to"]["at"],
            "2048-04"
        );
    }
}
