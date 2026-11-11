//! 年ごとの表（0209）: 比較の道具（compare）と同じ道で計算した通りごとの表から、選んだ行・年・家族の年齢の列の表を、CSV か Markdown の文で返す。
//! 表は同梱した画面の関数（app/src/connector/table.ts）で作る（画面の表と同じ年・同じ年齢・同じ行の数え方・同じ万円の丸め）。
//!
//! - 数字は AI から受け取らない（接続口が計算した数字だけを並べる）。受け取るのは行・年・家族・単位・形・並べ方の選び方と通りの名前だけ
//! - 表の下に、前提（物価上昇率・運用利回り）・相場などの想定・単位・計算基準月と「将来の結果を約束するものではない」旨の注が必ず入る
//! - お客さまの名前・物の ID は入れない（家族は呼び方〔ご本人・配偶者・第1子…〕だけ）

use crate::calc::Change;
use crate::compare::VariantArgs;
use crate::engine;
use crate::plan::PlanChange;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

/// 選べる行（table.ts の TABLE_ROWS と同じ。名前は compare の系列と同じ）
pub const ROWS: &[&str] = &[
    "income",
    "takeHome",
    "taxSi",
    "expense",
    "expenseBreakdown",
    "net",
    "financialAssets",
    "debt",
    "loanRepayment",
    "loanBalance",
    "loanInterest",
    "loanRate",
    "pension",
    "shortfall",
];
/// 単位: man（万円。四捨五入。既定）・yen（円）
pub const UNITS: &[&str] = &["man", "yen"];
/// 形: csv（既定）・markdown
pub const FORMATS: &[&str] = &["csv", "markdown"];
/// 通りが2つ以上のときの並べ方: byRow（行ごとに通りを列に並べる）・byVariant（通りごとに分ける）
pub const LAYOUTS: &[&str] = &["byRow", "byVariant"];
/// 何年おきの既定（compare の系列と同じ）
pub const DEFAULT_EVERY_YEARS: u8 = 5;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TableArgs {
    /// 基本の世帯: 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// 基本の世帯: FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// 基本の世帯: AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 基本の名前（既定「基本」。通りを並べたときの列・見出しに出る。お客さまの名前を書かない）
    pub label: Option<String>,
    /// 基本に当てる JSON Pointer の変更（compare と同じ）
    pub changes: Option<Vec<Change>>,
    /// 基本で動かす画面のプランの動かす項目（compare と同じ）
    pub plan_changes: Option<Vec<PlanChange>>,
    /// 基本のストレステストの型（compare と同じ）
    pub stress_test: Option<String>,
    /// 基本に重ねる「相場が下がった場合」の型（compare と同じ）
    #[schemars(extend("enum" = ["drop", "low", "minus1", null]))]
    pub market_stress: Option<String>,
    /// 並べる通り（compare の variants と同じ。8通りまで。省くと基本だけの表）。通りの label は列・見出しに出るので、お客さまの名前を書かない
    #[schemars(with = "Option<Vec<VariantArgs>>")]
    pub variants: Option<Vec<Value>>,
    /// 行（既定 income・taxSi・expense・net・financialAssets）: income（収入合計）・takeHome（手取り＝収入−税・社会保険料）・taxSi（税・社会保険料）・
    /// expense（支出。税・社会保険料を除く）・expenseBreakdown（支出の内訳。画面のキャッシュフロー表の支出の行ごと〔基本生活費・住居費・教育費・保険料…〕。
    /// 値のある行だけ）・net（年間収支）・financialAssets（金融資産残高）・debt（負債の残高の合計）・loanRepayment（住宅ローンの返済。年額）・
    /// loanBalance（住宅ローン残高。画面の表の行と同じ）・loanInterest（住宅ローンの利息。年額）・loanRate（その年の住宅ローンの金利。%）・
    /// pension（公的年金の世帯の合計。年額）・shortfall（資金の不足）。名前は compare の系列と同じ
    #[schemars(extend("items" = { "type": "string", "enum": ["income", "takeHome", "taxSi", "expense", "expenseBreakdown", "net", "financialAssets", "debt", "loanRepayment", "loanBalance", "loanInterest", "loanRate", "pension", "shortfall"] }))]
    pub rows: Option<Vec<String>>,
    /// 年齢の列にする家族（年齢の鍵: self・spouse・child1・child2…。compare の系列の ages の鍵と同じ）。省くと世帯の全員、[] なら年齢の列なし
    pub members: Option<Vec<String>>,
    /// この年から（含む）
    pub from_year: Option<i64>,
    /// この年まで（含む）
    pub to_year: Option<i64>,
    /// 何年おき（1〜10。既定5）。最初の年と最後の年はいつも入る。毎年の表は 1
    #[schemars(range(min = 1, max = 10))]
    pub every_years: Option<u8>,
    /// 単位: man（万円。万円未満は四捨五入。画面と同じ丸め。既定）か yen（円）
    #[schemars(extend("enum" = ["man", "yen", null]))]
    pub unit: Option<String>,
    /// 形: csv（既定。表計算ソフトに読み込める）か markdown（チャットや資料にそのまま貼れる表）
    #[schemars(extend("enum" = ["csv", "markdown", null]))]
    pub format: Option<String>,
    /// 通りが2つ以上のときの並べ方: byRow（行ごとに通りを列に並べる。比較しやすい。既定）か byVariant（通りごとに表を分ける。CSV は先頭の「通り」の列で
    /// 縦に積む）。通りに別の世帯があるときの既定は byVariant（byRow の年齢の列は基本の世帯）
    #[schemars(extend("enum" = ["byRow", "byVariant", null]))]
    pub layout: Option<String>,
    /// true なら CSV の頭に BOM（U+FEFF）を付ける（日本語の Windows の Excel でファイルを開いたときに文字化けさせない。既定 false）
    pub bom: Option<bool>,
    /// true なら表の下の注に「ファイナンシアで試算」の旨を入れる（既定 false）
    pub credit: Option<bool>,
}

/// 選んだ形（行・単位・形・並べ方・何年おき）
#[derive(Debug)]
pub struct Chosen {
    pub rows: Vec<String>,
    pub unit: String,
    pub format: String,
    pub layout: Option<String>,
    pub every: u8,
}

/// 表の選び方を確かめる
pub fn check(a: &TableArgs) -> Result<Chosen, String> {
    let rows = a.rows.clone().unwrap_or_default();
    let bad: Vec<&String> = rows
        .iter()
        .filter(|r| !ROWS.contains(&r.as_str()))
        .collect();
    if !bad.is_empty() {
        return Err(format!(
            "rows に選べるのは {} です（{}）。",
            ROWS.join("・"),
            bad.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join("・")
        ));
    }
    let pick = |v: &Option<String>, allowed: &[&str], name: &str| -> Result<String, String> {
        let s = v.clone().unwrap_or_else(|| allowed[0].to_owned());
        if allowed.contains(&s.as_str()) {
            Ok(s)
        } else {
            Err(format!("{name} は {} のどれかです。", allowed.join("・")))
        }
    };
    let unit = pick(&a.unit, UNITS, "unit")?;
    let format = pick(&a.format, FORMATS, "format")?;
    let layout = match &a.layout {
        None => None,
        Some(_) => Some(pick(&a.layout, LAYOUTS, "layout")?),
    };
    let every = a.every_years.unwrap_or(DEFAULT_EVERY_YEARS);
    if !(1..=10).contains(&every) {
        return Err("every_years は 1〜10 にしてください。".to_owned());
    }
    if let Some(ms) = &a.members {
        if ms.len() > 20 || ms.iter().any(|m| m.is_empty() || m.len() > 16) {
            return Err(
                "members は年齢の鍵（self・spouse・child1…）を20個までにしてください。".to_owned(),
            );
        }
    }
    Ok(Chosen {
        rows,
        unit,
        format,
        layout,
        every,
    })
}

/// 通りの相場などの想定の文（compare の通りの marketStress の文か、ストレステストの型の文。グラフの注と同じ）
pub fn stress_of(r: &Value) -> Option<String> {
    if let Some(l) = r["marketStress"]["label"].as_str() {
        return Some(l.to_owned());
    }
    r["stressTest"]
        .as_str()
        .map(|s| crate::chart::stress_text(s).to_owned())
}

/// 同梱した画面の関数で表を作る（重いので、呼ぶ側は spawn_blocking の中で）。戻り値は table.ts の答え（status・text・layout・rows・years・notes）
pub fn build(args: &Value) -> Result<Value, String> {
    let out = engine::table(&args.to_string())?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 通り1つ（table.ts の TableVariant）: 名前・計算の前の処理を当てる前の要求・表示の形の出力の表と、要約のうち住宅ローンの利息と金利（loans）
pub fn variant(label: &Value, request: &Value, out: &Value, stress: Option<String>) -> Value {
    let mut v = json!({
        "label": label.as_str().unwrap_or(""),
        "request": request,
        "result": { "table": out["table"], "summary": { "loans": out["summary"]["loans"] } },
    });
    if v["result"]["summary"]["loans"].is_null() {
        v["result"]["summary"] = json!({});
    }
    if let Some(s) = stress {
        v["stress"] = json!(s);
    }
    v
}

/// 表の答えに添える説明（表の文の前に置く。短く）
pub const NOTE: &str = "表の下の「※」の行（前提・相場などの想定・単位・試算の時点と、将来の結果を約束するものではない旨）は表の一部です。表を見せる・貼る・グラフにするときも必ず添え、数字は変えずに使ってください。";

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: Value) -> TableArgs {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn choices_are_checked() {
        let c = check(&args(json!({ "sample_household_id": "x" }))).unwrap();
        assert_eq!(
            (c.unit.as_str(), c.format.as_str(), c.every),
            ("man", "csv", 5)
        );
        assert!(c.rows.is_empty() && c.layout.is_none());
        let c = check(&args(json!({ "rows": ["takeHome", "expenseBreakdown"], "unit": "yen", "format": "markdown", "layout": "byVariant", "every_years": 1 }))).unwrap();
        assert_eq!(c.rows, ["takeHome", "expenseBreakdown"]);
        assert_eq!(c.layout.as_deref(), Some("byVariant"));
        assert!(check(&args(json!({ "rows": ["nope"] })))
            .unwrap_err()
            .contains("nope"));
        assert!(check(&args(json!({ "unit": "sen" }))).is_err());
        assert!(check(&args(json!({ "format": "xlsx" }))).is_err());
        assert!(check(&args(json!({ "layout": "wide" }))).is_err());
        assert!(check(&args(json!({ "every_years": 11 }))).is_err());
        assert!(check(&args(json!({ "members": [""] }))).is_err());
        // 行の名前は table.ts と同じ並び（compare の系列の名前を使い回す）
        for r in [
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
        ] {
            assert!(ROWS.contains(&r), "{r}");
            assert!(crate::answer::FIELDS.contains(&r), "{r}");
        }
    }

    #[test]
    fn variants_carry_only_the_table_and_loans() {
        let out = json!({ "header": { "baseMonth": "2026-10" }, "table": [{ "row": "cf.net", "year": 2027, "amount": 1 }], "summary": { "loans": [], "insurance": [1] } });
        let v = variant(
            &json!("基本"),
            &json!({ "input": {} }),
            &out,
            Some("相場".into()),
        );
        assert_eq!(v["result"]["summary"], json!({ "loans": [] }));
        assert_eq!(v["stress"], "相場");
        let v = variant(&json!("基本"), &json!({}), &json!({ "table": [] }), None);
        assert_eq!(v["result"]["summary"], json!({}));
        assert!(v.get("stress").is_none());
        assert_eq!(
            stress_of(&json!({ "marketStress": { "key": "drop", "label": "退職の直後に下がる" } }))
                .as_deref(),
            Some("退職の直後に下がる")
        );
        assert!(stress_of(&json!({ "stressTest": "inflationSpike" }))
            .unwrap()
            .contains("インフレ"));
        assert_eq!(stress_of(&json!({})), None);
    }
}
