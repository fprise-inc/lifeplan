//! 比べる道具（compare）の入出力の形と、答えのまとめ方。1回の呼び出しで、基本と最大8通り（基本に重ねるプランの変更・見本の世帯・
//! FPが渡した世帯・AIが組み立てた入力）を計算し、通りごとの主な数字（calculate の keyFigures と同じ。画面の「プランを比べる」と同じ数え方）と、
//! 基本との差、選んだ数字の年ごとの系列だけを返す。
//!
//! 計算そのもの（プランの変更 → 計算の前の処理 → 計算 → 主な数字）は calculate と同じ道（server.rs の compute）を通り、ここには書かない。
//! 渡された世帯は calculate と同じくアプリ本体に頼む（同意・期限・縮約・記録はアプリ本体だけ。server.rs の base_input）。

use crate::calc::Change;
use crate::plan::PlanChange;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Map, Value};

/// 基本のほかに並べられる通りの数
pub const MAX_VARIANTS: usize = 8;
/// 同時に計算する数の上限（通りごとに新しい固めた実行環境を作る。1つ 128MB まで。CPU の数の半分までにする）
pub const MAX_PARALLEL: usize = 4;
/// 系列の既定の間隔（何年おき）
pub const DEFAULT_EVERY_YEARS: u8 = 5;
/// 系列の既定の数字
pub const DEFAULT_SERIES: &[&str] = &["financialAssets"];
/// 画面の資産運用のタブの「相場が下がった場合」の型（app/src/workspace/invest/present.ts の STRESS_KEYS と同じ並び。0199）
pub const MARKET_STRESSES: &[&str] = &["drop", "low", "minus1"];

/// 1通りの計算では使わない答えの項目（主な数字・年齢・系列だけを取る）
pub const OMIT: &[&str] = &["notices", "packs", "protection", "inheritanceTax"];

/// 通り1つ（基本に重ねるか、別の世帯か）
#[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VariantArgs {
    /// 通りの名前（答えにそのまま出す。例: 「退職を63歳に」「物価2%」）。省くと「通り1」…
    pub label: Option<String>,
    /// 別の見本の世帯で比べる（list_sample_households の ID）。世帯（sample_household_id・share_id・input）を書かない通りは、基本の世帯に、基本の
    /// changes・plan_changes を当てた上に、この通りの changes・plan_changes を重ねる
    pub sample_household_id: Option<String>,
    /// 別の、FPが渡した世帯で比べる（list_shared_households の共有 ID。アプリが起動していて共有が期限内のときだけ。読むとアプリの「AIに渡した記録」に残る）
    pub share_id: Option<String>,
    /// 別の、AIが組み立てた入力で比べる（calculate の input と同じ形）
    pub input: Option<Value>,
    /// この通りで当てる JSON Pointer の変更（calculate の changes と同じ）
    pub changes: Option<Vec<Change>>,
    /// この通りで動かす画面のプランの動かす項目（calculate の plan_changes と同じ。list_plan_items の target・item と値）
    pub plan_changes: Option<Vec<PlanChange>>,
    /// この通りのストレステストの型（calculate の stress_test と同じ。基本に重ねる通りで stress_test も market_stress も省くと基本と同じ）
    pub stress_test: Option<String>,
    /// この通りに重ねる、アプリの画面の資産運用のタブの「相場が下がった場合」の型: drop（退職の直後に株などが下がる）・low（取り崩しを
    /// 始めてから〔取り崩しの予定が無ければ退職から〕しばらく利回りが低いまま）・minus1（利回りがずっと想定より1%低い）。画面と同じく、
    /// プランの変更を当てた後に重ねる（下がる幅・年数は画面と同じ既定）。stress_test とは一緒に使えない
    #[schemars(extend("enum" = ["drop", "low", "minus1", null]))]
    pub market_stress: Option<String>,
}

impl VariantArgs {
    /// 世帯を書いた数（0 なら基本に重ねる）
    pub fn households(&self) -> usize {
        [
            self.sample_household_id.is_some(),
            self.share_id.is_some(),
            self.input.is_some(),
        ]
        .iter()
        .filter(|x| **x)
        .count()
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CompareArgs {
    /// 基本の世帯: 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// 基本の世帯: FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// 基本の世帯: AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 基本の名前（既定「基本」）
    pub label: Option<String>,
    /// 基本に当てる JSON Pointer の変更（calculate の changes と同じ。基本に重ねる通りにも当たる）
    pub changes: Option<Vec<Change>>,
    /// 基本で動かす画面のプランの動かす項目（calculate の plan_changes と同じ。基本に重ねる通りにも当たる）
    pub plan_changes: Option<Vec<PlanChange>>,
    /// 基本のストレステストの型（calculate の stress_test と同じ）
    pub stress_test: Option<String>,
    /// 基本に重ねる、アプリの画面の「相場が下がった場合」の型（通りの market_stress と同じ。stress_test とは一緒に使えない）
    #[schemars(extend("enum" = ["drop", "low", "minus1", null]))]
    pub market_stress: Option<String>,
    /// 並べる通り（8通りまで。9通り目から後は計算せず理由を返す）。通りごとに、世帯を書かなければ基本に重ね、書けばその世帯で計算する
    #[schemars(with = "Vec<VariantArgs>")]
    pub variants: Vec<Value>,
    /// 年ごとの系列に返す数字（既定 ["financialAssets"]。calculate の fields と同じ: income・taxSi・expense・net・financialAssets・debt・shortfall・
    /// loanRepayment〔住宅ローンの返済。年額〕・loanBalance〔住宅ローン残高〕・loanInterest〔住宅ローンの利息。年額〕・loanRate〔その年の住宅ローンの
    /// 金利。10進の文字。返済の無い年・金利の違う住宅ローンを2本以上返している年は null〕）
    #[schemars(extend("items" = { "type": "string", "enum": ["income", "taxSi", "expense", "net", "financialAssets", "debt", "shortfall", "loanRepayment", "loanBalance", "loanInterest", "loanRate"] }))]
    pub series: Option<Vec<String>>,
    /// 系列の何年おき（1〜10。既定5）。画面の表の最初の年と最後の年はいつも入る
    #[schemars(range(min = 1, max = 10))]
    pub every_years: Option<u8>,
    /// keyFigures の「○歳時点の金融資産」の本人の年齢（5つまで。既定 [95]＝アプリの画面の既定）
    pub at_ages: Option<Vec<u8>>,
    /// false なら、系列に家族の年齢（ages）と members を付けない（答えが通りごとに約0.7KB小さくなる）。既定 true
    pub ages: Option<bool>,
    /// 系列のこの年から（含む）
    pub from_year: Option<i64>,
    /// 系列のこの年まで（含む）
    pub to_year: Option<i64>,
}

/// 通りの世帯の出どころ（答えの from）
pub fn source_of(v: &VariantArgs, on_base: bool) -> Value {
    if on_base {
        return json!({ "onBase": true });
    }
    if let Some(id) = &v.sample_household_id {
        json!({ "sampleHouseholdId": id })
    } else if let Some(id) = &v.share_id {
        json!({ "shareId": id })
    } else {
        json!({ "input": true })
    }
}

/// ストレステストの型を確かめる（エンジンの型と画面の「相場が下がった場合」の型は、どちらか1つ）
pub fn check_stress(stress_test: Option<&str>, market: Option<&str>) -> Result<(), String> {
    if stress_test.is_some() && market.is_some() {
        return Err(
            "stress_test と market_stress は、1つの通りにどちらか1つだけ書いてください。"
                .to_owned(),
        );
    }
    match market {
        Some(m) if !MARKET_STRESSES.contains(&m) => Err(format!(
            "market_stress は {} のどれかです（{m}）。",
            MARKET_STRESSES.join("・")
        )),
        _ => Ok(()),
    }
}

/// 2つの並びをつなぐ（基本の変更の後に通りの変更）
pub fn joined<T: Clone>(a: Option<&[T]>, b: Option<&[T]>) -> Vec<T> {
    a.unwrap_or(&[])
        .iter()
        .chain(b.unwrap_or(&[]))
        .cloned()
        .collect()
}

/// 資産が尽きる年の基本との違い（画面の比較の表の「資産が尽きる年」の差の文と同じ。plans/compare.ts の compareTable）
pub fn depletion_change(this: Option<i64>, base: Option<i64>) -> Value {
    match (this, base) {
        (None, None) => Value::Null,
        (None, Some(_)) => json!("尽きなくなる"),
        (Some(_), None) => json!("尽きるようになる"),
        (Some(t), Some(b)) if t == b => json!("±0年"),
        (Some(t), Some(b)) => {
            json!(format!(
                "{}{}年",
                if t > b { "+" } else { "▲" },
                (t - b).abs()
            ))
        }
    }
}

fn depletion_year(k: &Value) -> Option<i64> {
    k["depletion"]["year"].as_i64()
}

/// 主な数字の基本との差（この通り − 基本。円）。資産が尽きる年は画面の比較の表と同じ文
pub fn diff(this: &Value, base: &Value) -> Value {
    let num = |k: &Value, path: &[&str]| -> i64 {
        path.iter()
            .fold(k, |v, p| &v[*p])
            .as_i64()
            .unwrap_or_default()
    };
    let at: Vec<Value> = this["assetsAtAge"]
        .as_array()
        .map(|a| {
            a.iter()
                .enumerate()
                .map(|(i, x)| {
                    let b = &base["assetsAtAge"][i];
                    json!({ "age": x["age"], "amount": x["amount"].as_i64().unwrap_or_default() - b["amount"].as_i64().unwrap_or_default() })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut d = Map::new();
    d.insert("assetsAtAge".into(), Value::Array(at));
    d.insert(
        "depletion".into(),
        depletion_change(depletion_year(this), depletion_year(base)),
    );
    // 年金の見込みの月額の差（どちらかに無ければ null）
    for (key, field) in [
        ("pensionMonthly", "monthly"),
        ("pensionClaimedMonthly", "claimedMonthly"),
    ] {
        let v = match (
            this["pension"][field].as_i64(),
            base["pension"][field].as_i64(),
        ) {
            (Some(t), Some(b)) => json!(t - b),
            _ => Value::Null,
        };
        if this.get("pension").is_some() || base.get("pension").is_some() {
            d.insert(key.into(), v);
        }
    }
    for (key, path) in [
        ("minimumAmount", &["minimum", "amount"][..]),
        ("lifetimeTakeHome", &["lifetimeTakeHome"][..]),
        ("lifetimeExpense", &["lifetimeExpense"][..]),
        ("loanRepayment", &["loanRepayment"][..]),
    ] {
        d.insert(key.into(), json!(num(this, path) - num(base, path)));
    }
    // 住宅ローンの利息の合計の差（0205。どちらかにあるときだけ）
    if this.get("loanInterest").is_some() || base.get("loanInterest").is_some() {
        d.insert(
            "loanInterest".into(),
            json!(num(this, &["loanInterest"]) - num(base, &["loanInterest"])),
        );
    }
    Value::Object(d)
}

/// プランの変更の当てはめを、比べる答えの形に縮める（名前・前・後・当てたか）
pub fn plan_rows(rows: &Value) -> Value {
    match rows.as_array() {
        Some(list) => Value::Array(
            list.iter()
                .map(|r| json!({ "label": r["label"], "from": r["from"], "to": r["to"], "status": r["status"] }))
                .collect(),
        ),
        None => Value::Null,
    }
}

/// 比べる答えに添える説明
pub const NOTE: &str = "results の1つ目が基本、2つ目からが通りです。keyFigures は calculate の keyFigures と同じ（アプリの「プランを比べる」と同じ数え方）、diff は基本との差（この通り − 基本。円。depletion は画面の比較の表と同じ文。pensionMonthly は65歳からの年金の世帯の月額の差。loanInterest は住宅ローンの利息の合計の差）、series は選んだ数字の年ごとの系列（画面の表に出す年から、年末の残高・年額。ages は家族の年齢で、鍵は members）。from.onBase は基本の世帯に基本と通りの変更を重ねた通りです。marketStress は重ねた画面の「相場が下がった場合」の型です。keyFigures.pension は65歳からの年金の月額（世帯の合計と人ごと。今の水準＝賃金・物価の伸びとマクロ経済スライドを外した額。画面の比較の表の年金の行と同じ）です。status が error の通りは計算しておらず、reason に理由と直し方があります（ほかの通りは計算しています）。試したプランの変更は、そのまま propose_scenario の changes に渡せます（渡された世帯のとき）。";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depletion_text_is_the_screen_text() {
        assert_eq!(depletion_change(None, None), Value::Null);
        assert_eq!(depletion_change(None, Some(2050)), json!("尽きなくなる"));
        assert_eq!(
            depletion_change(Some(2050), None),
            json!("尽きるようになる")
        );
        assert_eq!(depletion_change(Some(2050), Some(2050)), json!("±0年"));
        assert_eq!(depletion_change(Some(2072), Some(2050)), json!("+22年"));
        assert_eq!(depletion_change(Some(2048), Some(2050)), json!("▲2年"));
    }

    #[test]
    fn stresses_are_one_of_the_kinds() {
        assert!(check_stress(None, None).is_ok());
        assert!(check_stress(Some("inflationSpike"), None).is_ok());
        assert!(check_stress(None, Some("drop")).is_ok());
        assert!(check_stress(None, Some("x"))
            .unwrap_err()
            .contains("drop・low・minus1"));
        assert!(check_stress(Some("inflationSpike"), Some("low"))
            .unwrap_err()
            .contains("どちらか1つ"));
    }

    #[test]
    fn diff_is_this_minus_base() {
        let base = json!({ "assetsAtAge": [{ "age": 95, "amount": 100 }], "depletion": { "year": 2050 }, "minimum": { "amount": -5 },
            "lifetimeTakeHome": 10, "lifetimeExpense": 20, "loanRepayment": 0 });
        let this = json!({ "assetsAtAge": [{ "age": 95, "amount": 250 }], "depletion": null, "minimum": { "amount": 7 },
            "lifetimeTakeHome": 15, "lifetimeExpense": 18, "loanRepayment": 3 });
        assert_eq!(
            diff(&this, &base),
            json!({ "assetsAtAge": [{ "age": 95, "amount": 150 }], "depletion": "尽きなくなる", "minimumAmount": 12,
                "lifetimeTakeHome": 5, "lifetimeExpense": -2, "loanRepayment": 3 })
        );
        // 住宅ローンの利息の合計の差（0205）
        let mut b = base.clone();
        let mut t = this.clone();
        b["loanInterest"] = json!(2_800_000);
        t["loanInterest"] = json!(4_100_000);
        assert_eq!(diff(&t, &b)["loanInterest"], 1_300_000);
    }

    #[test]
    fn variants_join_and_count_households() {
        let v: VariantArgs = serde_json::from_value(json!({ "label": "x" })).unwrap();
        assert_eq!(v.households(), 0);
        assert_eq!(source_of(&v, true), json!({ "onBase": true }));
        let v: VariantArgs =
            serde_json::from_value(json!({ "sample_household_id": "a", "input": {} })).unwrap();
        assert_eq!(v.households(), 2);
        assert!(serde_json::from_value::<VariantArgs>(json!({ "nope": 1 })).is_err());
        assert_eq!(joined(Some(&[1, 2][..]), Some(&[3][..])), vec![1, 2, 3]);
        assert_eq!(joined::<i32>(None, None), Vec::<i32>::new());
    }
}
