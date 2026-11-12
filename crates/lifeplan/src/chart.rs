//! 比較した答えのグラフ（0203）: 比較の道具（compare）と同じ道で計算した通りごとの数字から、画面のグラフと同じ見た目の SVG を同梱した画面の関数
//! （app/src/connector/chart.ts）で作り、PNG にもする（MCP の image の中身。AI のアプリでそのまま見える）。
//!
//! - 数字は AI から受け取らない（compare と同じく接続口が計算した数字だけを描く）。受け取るのは通りの名前・グラフの種類・題・色の明るさだけ
//! - compare の系列（series）は、どれも1つの折れ線のグラフにできる（series の名前を選ぶ）。支出の内訳は expenseBreakdown の棒（0207）
//! - 「ファイナンシアで試算」の出典は credit を true にしたときだけ入れる（既定は入れない）。前提の注（物価・運用利回り・相場の想定）・試算の時点・
//!   将来の結果を約束するものではない旨は、いつも入れる（0207）
//! - お客さまの名前・物の ID は描かない（chart.ts に渡すのは通りの名前と数字と本人の年齢だけ）
//! - PNG は同梱の字体（BIZ UDゴシック。SIL OFL 1.1。report/fonts）だけで描く（OS の字体を読まない。外へは何も送らない）

use crate::calc::Change;
use crate::compare::VariantArgs;
use crate::plan::PlanChange;
use crate::{answer, engine};
use resvg::{tiny_skia, usvg};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};

/// グラフの種類（charts で選ぶ物。chart.ts の CHART_KINDS のうち series 以外）
pub const KINDS: &[&str] = &[
    "assets",
    "repayment",
    "keyFigures",
    "interest",
    "rate",
    "expenseBreakdown",
];
/// 支出の内訳（expenseBreakdown の棒に使う系列。chart.ts の EXPENSE_KEYS と同じ）
pub const EXPENSE_FIELDS: &[&str] = &[
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
];
/// 1回で作れるグラフの数（charts と series を合わせて）
pub const MAX_CHARTS: usize = 8;
/// 主な数字の比較で選べる数字（chart.ts の FIGURE_KEYS と同じ）
pub const FIGURES: &[&str] = &[
    "assetsAtAge",
    "minimum",
    "loanRepayment",
    "loanInterest",
    "lifetimeTakeHome",
    "lifetimeExpense",
];
/// 返す形
pub const FORMATS: &[&str] = &["png", "svg", "both"];
/// 既定のグラフ（金融資産の推移・返済額の推移・主な数字の比較）
pub const DEFAULT_KINDS: &[&str] = &["assets", "repayment", "keyFigures"];
/// PNG の倍率（SVG の 760px の幅を 1520px にする。資料に貼っても粗くならない）
pub const PNG_SCALE: f32 = 2.0;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ChartArgs {
    /// 基本の世帯: 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// 基本の世帯: FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// 基本の世帯: AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 基本の名前（既定「基本」。グラフの凡例に出る。お客さまの名前を書かない）
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
    /// 並べる通り（compare の variants と同じ。グラフは基本と5通りまでが見分けやすい。通りの label は凡例に出るので、お客さまの名前を書かない）
    #[schemars(with = "Vec<VariantArgs>")]
    pub variants: Vec<Value>,
    /// 作るグラフ（既定は、series を書かなければ assets・repayment・keyFigures、書けば無し）: assets（通りごとの金融資産の推移。折れ線）・repayment
    /// （通りごとの住宅ローンの返済額の推移。年額の折れ線）・keyFigures（主な数字の比較。棒）・interest（通りごとの住宅ローンの利息の推移。年額の折れ線）・
    /// rate（通りごとの住宅ローンの金利の推移。その年の最後の返済に当てた金利の折れ線。縦の目盛りは %。金利の違う住宅ローンを2本以上返している年は描かない）・
    /// expenseBreakdown（支出の内訳の比較。生活費・住居費・教育費・保険料・車・医療・介護などの表の期間の合計を、通りごとの横の棒で並べる）
    #[schemars(extend("items" = { "type": "string", "enum": ["assets", "repayment", "keyFigures", "interest", "rate", "expenseBreakdown"] }))]
    pub charts: Option<Vec<String>>,
    /// 折れ線にする年ごとの数字（compare の series と同じ名前。1つにつき1枚の折れ線のグラフ。charts と合わせて8枚まで）: income（収入）・takeHome（手取り）・
    /// taxSi（税・社会保険料）・expense（支出。税・社会保険料を除く）・net（年間収支）・financialAssets（金融資産）・debt（負債の残高）・shortfall（資金不足）・
    /// loanRepayment・loanBalance・loanInterest・loanRate（住宅ローンの返済額・残高・利息・金利）・pension（公的年金）・支出の内訳 expenseLiving（生活費）・
    /// expenseSurplus（ゆとりの支出）・expenseHousing（住居費）・expenseEducation（教育費）・expenseInsurance（保険料）・expenseLumpSum（一時的支出）・
    /// expenseCar（車の費用）・expenseCare（医療・介護）・expenseRealEstate（住まい以外の不動産の経費・ローン）・expenseOther（その他の支出）。
    /// 例: 退職の年齢を3通りにして ["financialAssets", "net"]、教育の進路を3通りにして ["expenseEducation"]
    #[schemars(extend("items" = { "type": "string", "enum": ["income", "takeHome", "taxSi", "expense", "net", "financialAssets", "debt", "shortfall", "loanRepayment", "loanBalance", "loanInterest", "loanRate", "pension", "expenseLiving", "expenseSurplus", "expenseHousing", "expenseEducation", "expenseInsurance", "expenseLumpSum", "expenseCar", "expenseCare", "expenseRealEstate", "expenseOther"] }))]
    pub series: Option<Vec<String>>,
    /// keyFigures の棒にする数字（既定 assetsAtAge・minimum・loanRepayment）: assetsAtAge（at_ages の最初の年齢の時点の金融資産）・minimum
    /// （金融資産がいちばん少ない額）・loanRepayment（住宅ローンの返済の合計）・loanInterest（住宅ローンの利息の合計）・lifetimeTakeHome（生涯の手取りの合計）・
    /// lifetimeExpense（生涯の支出の合計）
    #[schemars(extend("items" = { "type": "string", "enum": ["assetsAtAge", "minimum", "loanRepayment", "loanInterest", "lifetimeTakeHome", "lifetimeExpense"] }))]
    pub figures: Option<Vec<String>>,
    /// 題（作るグラフが1枚のときだけ。省くと種類ごとの既定の題。お客さまの名前を書かない）
    pub title: Option<String>,
    /// true なら、注に「ファイナンシアで試算」の出典を入れる（既定 false＝入れない。ブログ・セミナーの資料に FP の名前で使うときは入れなくてよい）。
    /// 前提の注（物価上昇率・運用利回り・相場の想定）・試算の時点・将来の結果を約束するものではない旨は、どちらでもいつも入る
    pub credit: Option<bool>,
    /// 色の明るさ: light（既定。白地。印刷・資料向け）か dark（暗い地）
    #[schemars(extend("enum" = ["light", "dark", null]))]
    pub theme: Option<String>,
    /// 返す形: png（既定。MCP の image。AI のアプリでそのまま見える）・svg（SVG の文字。資料・ブログに貼れる。拡大してもぼやけない）・both
    #[schemars(extend("enum" = ["png", "svg", "both", null]))]
    pub format: Option<String>,
    /// keyFigures の「○歳時点の金融資産」の本人の年齢（compare と同じ。最初の1つを使う。既定 95）
    pub at_ages: Option<Vec<u8>>,
    /// 折れ線のこの年から（含む）
    pub from_year: Option<i64>,
    /// 折れ線のこの年まで（含む）
    pub to_year: Option<i64>,
}

/// 作るグラフ1枚（種類と、折れ線の数字。種類が series のときだけ数字がある）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub kind: String,
    pub field: Option<String>,
}

impl Job {
    /// 答えの charts・SVG の名前に使う名前（series は数字の名前）
    pub fn name(&self) -> &str {
        self.field.as_deref().unwrap_or(&self.kind)
    }
}

/// 選んだ物（作るグラフ・主な数字・形・色）
pub struct Checked {
    pub jobs: Vec<Job>,
    pub figures: Vec<String>,
    pub format: String,
    pub theme: String,
}

impl Checked {
    /// compare に頼む系列（グラフに要る数字だけ）
    pub fn series(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut add = |k: &str| {
            if !out.iter().any(|x| x == k) {
                out.push(k.to_owned());
            }
        };
        for j in &self.jobs {
            match (j.kind.as_str(), &j.field) {
                (_, Some(f)) => add(f),
                ("assets", _) => add("financialAssets"),
                ("repayment", _) => add("loanRepayment"),
                ("interest", _) => add("loanInterest"),
                ("rate", _) => add("loanRate"),
                ("expenseBreakdown", _) => EXPENSE_FIELDS.iter().for_each(|k| add(k)),
                _ => {}
            }
        }
        // 本人の年齢の目盛りに系列の年が要る（棒だけのときも金融資産を頼む）
        add("financialAssets");
        out
    }
}

/// グラフの選び方を確かめる（種類・折れ線の数字・主な数字・形・色）
pub fn check(a: &ChartArgs) -> Result<Checked, String> {
    let series = a.series.clone().unwrap_or_default();
    let kinds: Vec<String> = a.charts.clone().unwrap_or_else(|| {
        if series.is_empty() {
            DEFAULT_KINDS.iter().map(|s| (*s).to_owned()).collect()
        } else {
            Vec::new()
        }
    });
    if kinds.iter().any(|k| !KINDS.contains(&k.as_str())) {
        return Err(format!(
            "charts は {} から選んでください。",
            KINDS.join("・")
        ));
    }
    if series.iter().any(|k| !answer::FIELDS.contains(&k.as_str())) {
        return Err(format!(
            "series に選べるのは {} です（compare の series と同じ）。",
            answer::FIELDS.join("・")
        ));
    }
    let mut jobs: Vec<Job> = Vec::new();
    let wanted = kinds
        .iter()
        .map(|k| Job {
            kind: k.clone(),
            field: None,
        })
        .chain(series.iter().map(|f| Job {
            kind: "series".to_owned(),
            field: Some(f.clone()),
        }));
    for j in wanted {
        if !jobs.contains(&j) {
            jobs.push(j);
        }
    }
    if jobs.is_empty() {
        return Err(format!(
            "charts（{}）か series（compare の series の名前）で、作るグラフを1つ以上選んでください。",
            KINDS.join("・")
        ));
    }
    if jobs.len() > MAX_CHARTS {
        return Err(format!(
            "1回で作れるグラフは charts と series を合わせて{MAX_CHARTS}枚までです（分けて呼んでください）。"
        ));
    }
    let figures = a.figures.clone().unwrap_or_default();
    if figures.iter().any(|k| !FIGURES.contains(&k.as_str())) {
        return Err(format!(
            "figures に選べるのは {} です。",
            FIGURES.join("・")
        ));
    }
    let format = a.format.clone().unwrap_or_else(|| "png".to_owned());
    if !FORMATS.contains(&format.as_str()) {
        return Err(format!("format は {} のどれかです。", FORMATS.join("・")));
    }
    let theme = a.theme.clone().unwrap_or_else(|| "light".to_owned());
    if theme != "light" && theme != "dark" {
        return Err("theme は light か dark です。".to_owned());
    }
    if a.title.is_some() && jobs.len() > 1 {
        return Err(
            "title は作るグラフを1枚にしたときだけ使えます（charts・series を合わせて1つにして、グラフごとに呼んでください）。".to_owned(),
        );
    }
    Ok(Checked {
        jobs,
        figures,
        format,
        theme,
    })
}

/// エンジンのストレステストの型の文（エンジンの型の題。engine/src/engine/overlay.ts と同じ）
fn stress_text(key: &str) -> &'static str {
    match key {
        "marketDropAtRetirement" => "退職した年に資産の時価が下がる",
        "inflationSpike" => "インフレが一定期間だけ上振れする",
        "rateRise" => "変動金利が上がる（エンジンの既定の型）",
        "incomeDrop" => "収入が一定期間減る",
        _ => "ストレステスト",
    }
}

/// 比較する答えの通り（results の1つ）と、その通りの前提（assumptions）から、chart.ts に渡す通り（名前と数字だけ）を作る
pub fn variant_of(r: &Value, assumptions: &Value) -> Value {
    let series: Vec<Value> = r["series"]
        .as_array()
        .map(|l| {
            l.iter()
                .map(|y| {
                    // 年と数字だけ（家族の年齢 ages は渡さない。本人の年齢は self_ages で別に渡す）
                    let mut p = y.clone();
                    if let Some(o) = p.as_object_mut() {
                        o.remove("ages");
                    }
                    p
                })
                .collect()
        })
        .unwrap_or_default();
    let k = &r["keyFigures"];
    let plan: Vec<Value> = r["planChanges"]
        .as_array()
        .map(|l| {
            l.iter()
                .filter(|c| c["status"] == "applied")
                .map(|c| json!({ "label": c["label"], "to": c["to"] }))
                .collect()
        })
        .unwrap_or_default();
    let stress = if let Some(l) = r["marketStress"]["label"].as_str() {
        Some(l.to_owned())
    } else {
        r["stressTest"].as_str().map(|s| stress_text(s).to_owned())
    };
    let mut v = json!({
        "label": r["label"].as_str().unwrap_or(""),
        "series": series,
        "keyFigures": {
            "assetsAtAge": k["assetsAtAge"],
            "minimum": k["minimum"],
            "loanRepayment": k["loanRepayment"],
            "loanInterest": k["loanInterest"],
            "lifetimeTakeHome": k["lifetimeTakeHome"],
            "lifetimeExpense": k["lifetimeExpense"],
        },
        "planChanges": plan,
        "assumptions": {
            "inflation": assumptions["inflation"],
            "investmentReturn": assumptions["investmentReturn"],
        },
    });
    if let Some(s) = stress {
        v["stress"] = json!(s);
    }
    strip_nulls(&mut v);
    v
}

/// null の欄を落とす（chart.ts は欄が無いことで「無い」と読む）
fn strip_nulls(v: &mut Value) {
    match v {
        Value::Object(m) => {
            m.retain(|_, x| !x.is_null());
            for x in m.values_mut() {
                strip_nulls(x);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(strip_nulls),
        _ => {}
    }
}

/// 年ごとの本人の年齢（基本の通りの系列の ages.self）
pub fn self_ages(base: &Value) -> Value {
    let mut m = serde_json::Map::new();
    for y in base["series"].as_array().into_iter().flatten() {
        if let (Some(year), Some(age)) = (y["year"].as_i64(), y["ages"]["self"].as_i64()) {
            m.insert(year.to_string(), json!(age));
        }
    }
    Value::Object(m)
}

/// 通りの文字（A・B…。chart.ts の letterOf と同じ）
pub fn letter(i: usize) -> String {
    char::from(b'A' + u8::try_from(i.min(25)).unwrap_or(25)).to_string()
}

/// 同梱した画面の関数でグラフの SVG を作る（重いので、呼ぶ側は spawn_blocking の中で）。戻り値は chart.ts の答え（status・svg・title・alt…）
pub fn svg(args: &Value) -> Result<Value, String> {
    let out = engine::chart(&args.to_string())?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 同梱の字体（BIZ UDゴシック。SIL OFL 1.1。ライセンス文は report/fonts/OFL.txt）
static FONT_REGULAR: &[u8] = include_bytes!("../../../report/fonts/BIZUDGothic-Regular.ttf");
static FONT_BOLD: &[u8] = include_bytes!("../../../report/fonts/BIZUDGothic-Bold.ttf");

fn fontdb() -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_font_data(FONT_REGULAR.to_vec());
        db.load_font_data(FONT_BOLD.to_vec());
        // 画面の字体（BIZ UDPGothic など）が無いので、どの字体の名前も同梱の BIZ UDゴシックで描く（OS の字体は読まない）
        db.set_sans_serif_family("BIZ UDGothic");
        Arc::new(db)
    })
    .clone()
}

/// SVG を PNG にする（同梱の字体だけで描く。外の画像・字体は読まない）
pub fn png(svg: &str, scale: f32) -> Result<Vec<u8>, String> {
    let opt = usvg::Options {
        fontdb: fontdb(),
        font_family: "BIZ UDGothic".to_owned(),
        // 外のファイル・画像を読まない（グラフの SVG は自分で作った物だけ）
        resources_dir: None,
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
    let size = tree.size().to_int_size().scale_by(scale).ok_or("size")?;
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("pixmap")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().map_err(|e| e.to_string())
}

/// 道具の説明に添える、公開に使うときの案内（0199 の公開に使うときの案内と同じ考え。止める仕組みにはしない）
pub const PUBLISH_NOTE: &str = "セミナーの資料・ブログなどに使うときは、実在のお客さまの世帯なら、金額を丸める・珍しい組み合わせ（家族・職業・地域など）を変える・お客さまに一言ことわる、のどれかをしてから使ってください（見本の世帯はすべて架空です）。グラフにはお客さまの名前・ID は入りませんが、通りの名前・題に書いた文字はそのまま入ります。";

/// グラフの答えに添える説明
pub const NOTE: &str = "グラフは、比較の道具（compare）と同じ道で計算した数字を、アプリの画面のグラフと同じ目盛り・色で描いた物です（数字は AI から受け取っていません）。どのグラフにも、題・凡例（通りの文字と名前）・単位（万円。金利の推移は %）・前提の短い注（物価上昇率・運用利回り・相場の想定）・試算の時点と「将来の結果を約束するものではない」旨が入っています。「ファイナンシアで試算」の出典は credit が true のときだけ入ります。PNG は image、SVG は image/svg+xml の埋め込みで返します。figures の数字は keyFigures と同じ、series のグラフの数字は compare の series と同じです。";

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: Value) -> ChartArgs {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn checks_the_choices() {
        let ok = check(&args(json!({ "variants": [] }))).unwrap();
        let kinds: Vec<&str> = ok.jobs.iter().map(|j| j.kind.as_str()).collect();
        assert_eq!(kinds, DEFAULT_KINDS);
        assert_eq!(ok.format, "png");
        assert_eq!(ok.theme, "light");
        assert_eq!(
            ok.series(),
            ["financialAssets", "loanRepayment"].map(String::from)
        );
        assert!(check(&args(json!({ "variants": [], "charts": ["pie"] }))).is_err());
        assert!(check(&args(json!({ "variants": [], "charts": [] }))).is_err());
        assert!(check(&args(json!({ "variants": [], "figures": ["x"] }))).is_err());
        assert!(check(&args(json!({ "variants": [], "format": "gif" }))).is_err());
        assert!(check(&args(json!({ "variants": [], "theme": "blue" }))).is_err());
        assert!(check(&args(json!({ "variants": [], "title": "題" }))).is_err());
        assert!(check(&args(
            json!({ "variants": [], "title": "題", "charts": ["assets"] })
        ))
        .is_ok());
        // series を書けば、charts の既定は無し（書いた数字の折れ線だけ。0207）
        let s = check(&args(
            json!({ "variants": [], "series": ["net", "expenseEducation", "net"] }),
        ))
        .unwrap();
        let names: Vec<&str> = s.jobs.iter().map(Job::name).collect();
        assert_eq!(names, ["net", "expenseEducation"]);
        assert!(s.jobs.iter().all(|j| j.kind == "series"));
        assert_eq!(
            s.series(),
            ["net", "expenseEducation", "financialAssets"].map(String::from)
        );
        assert!(check(&args(json!({ "variants": [], "series": ["nope"] }))).is_err());
        assert!(check(&args(
            json!({ "variants": [], "series": ["net"], "title": "年間収支" })
        ))
        .is_ok());
        // 支出の内訳の棒は、内訳の系列を全部頼む
        let b = check(&args(
            json!({ "variants": [], "charts": ["expenseBreakdown"], "series": ["financialAssets"] }),
        ))
        .unwrap();
        assert_eq!(b.series().len(), EXPENSE_FIELDS.len() + 1);
        // charts と series を合わせて8枚まで
        assert!(check(&args(json!({ "variants": [], "charts": ["assets", "repayment", "keyFigures", "interest", "rate"], "series": ["net", "income", "pension", "debt"] }))).is_err());
    }

    #[test]
    fn variants_carry_only_labels_and_numbers() {
        let r = json!({
            "key": "v1", "label": "10年で+1%", "status": "ok", "from": { "onBase": true },
            "series": [{ "year": 2027, "financialAssets": 100, "loanRepayment": 5, "ages": { "self": 40 } }],
            "keyFigures": { "assetsAtAge": [{ "age": 95, "year": 2081, "amount": 7 }], "loanRepayment": 9, "depletion": null },
            "planChanges": [{ "label": "金利", "from": "a", "to": "b", "status": "applied" }, { "label": "同じ", "to": "c", "status": "same" }],
            "members": [{ "key": "self", "label": "ご本人" }],
            "stressTest": "rateRise",
        });
        let v = variant_of(&r, &json!({ "inflation": { "default": "0.01" } }));
        assert_eq!(v["label"], "10年で+1%");
        // 年と数字だけ（家族の年齢は渡さない）
        assert_eq!(
            v["series"],
            json!([{ "year": 2027, "financialAssets": 100, "loanRepayment": 5 }])
        );
        assert_eq!(v["planChanges"], json!([{ "label": "金利", "to": "b" }]));
        assert_eq!(v["stress"], "変動金利が上がる（エンジンの既定の型）");
        assert!(v.get("members").is_none());
        assert!(v["keyFigures"].get("depletion").is_none());
        assert!(v["assumptions"].get("investmentReturn").is_none());
        assert_eq!(self_ages(&r), json!({ "2027": 40 }));
    }

    #[test]
    fn renders_png_with_the_bundled_font() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" font-family="&quot;BIZ UDPGothic&quot;, sans-serif"><rect width="40" height="20" fill="#fff"/><text x="2" y="15" font-size="12">試算</text></svg>"##;
        let png = png(svg, 2.0).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        // 字が描けている（白地だけではない）
        let img = tiny_skia::Pixmap::decode_png(&png).unwrap();
        assert_eq!((img.width(), img.height()), (80, 40));
        assert!(img.pixels().iter().any(|p| p.red() < 128));
    }
}
