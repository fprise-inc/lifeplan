//! 比べた答えのグラフ（0203）: 比べる道具（compare）と同じ道で計算した通りごとの数字から、画面のグラフと同じ見た目の SVG を同梱した画面の関数
//! （app/src/connector/chart.ts）で作り、PNG にもする（MCP の image の中身。AI のアプリでそのまま見える）。
//!
//! - 数字は AI から受け取らない（compare と同じく接続口が計算した数字だけを描く）。受け取るのは通りの名前・グラフの種類・題・色の明るさだけ
//! - お客さまの名前・物の ID は描かない（chart.ts に渡すのは通りの名前と数字と本人の年齢だけ）
//! - PNG は同梱の字体（BIZ UDゴシック。SIL OFL 1.1。report/fonts）だけで描く（OS の字体を読まない。外へは何も送らない）

use crate::calc::Change;
use crate::compare::VariantArgs;
use crate::engine;
use crate::plan::PlanChange;
use resvg::{tiny_skia, usvg};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};

/// グラフの種類（chart.ts の CHART_KINDS と同じ）
pub const KINDS: &[&str] = &["assets", "repayment", "keyFigures", "interest", "rate"];
/// 主な数字の比べで選べる数字（chart.ts の FIGURE_KEYS と同じ）
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
/// 既定のグラフ（金融資産の推移・返済額の推移・主な数字の比べ）
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
    /// 作るグラフ（既定は assets・repayment・keyFigures）: assets（通りごとの金融資産の推移。折れ線）・repayment（通りごとの住宅ローンの返済額の推移。
    /// 年額の折れ線）・keyFigures（主な数字の比べ。棒）・interest（通りごとの住宅ローンの利息の推移。年額の折れ線）・rate（通りごとの住宅ローンの金利の
    /// 推移。その年の最後の返済に当てた金利の折れ線。縦の目盛りは %。金利の違う住宅ローンを2本以上返している年は描かない）
    #[schemars(extend("items" = { "type": "string", "enum": ["assets", "repayment", "keyFigures", "interest", "rate"] }))]
    pub charts: Option<Vec<String>>,
    /// keyFigures の棒にする数字（既定 assetsAtAge・minimum・loanRepayment）: assetsAtAge（at_ages の最初の年齢の時点の金融資産）・minimum
    /// （金融資産がいちばん少ない額）・loanRepayment（住宅ローンの返済の合計）・loanInterest（住宅ローンの利息の合計）・lifetimeTakeHome（生涯の手取りの合計）・
    /// lifetimeExpense（生涯の支出の合計）
    #[schemars(extend("items" = { "type": "string", "enum": ["assetsAtAge", "minimum", "loanRepayment", "loanInterest", "lifetimeTakeHome", "lifetimeExpense"] }))]
    pub figures: Option<Vec<String>>,
    /// 題（グラフの種類が1つのときだけ。省くと種類ごとの既定の題。お客さまの名前を書かない）
    pub title: Option<String>,
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

/// グラフの選び方を確かめる（種類・数字・形・色）。戻り値は（種類, 数字, 形, 色）
pub fn check(a: &ChartArgs) -> Result<(Vec<String>, Vec<String>, String, String), String> {
    let kinds: Vec<String> = a
        .charts
        .clone()
        .unwrap_or_else(|| DEFAULT_KINDS.iter().map(|s| (*s).to_owned()).collect());
    if kinds.is_empty() || kinds.iter().any(|k| !KINDS.contains(&k.as_str())) {
        return Err(format!(
            "charts は {} から1つ以上選んでください。",
            KINDS.join("・")
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
    if a.title.is_some() && kinds.len() > 1 {
        return Err(
            "title は charts を1つにしたときだけ使えます（種類ごとに呼んでください）。".to_owned(),
        );
    }
    Ok((kinds, figures, format, theme))
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

/// 比べる答えの通り（results の1つ）と、その通りの前提（assumptions）から、chart.ts に渡す通り（名前と数字だけ）を作る
pub fn variant_of(r: &Value, assumptions: &Value) -> Value {
    let series: Vec<Value> = r["series"]
        .as_array()
        .map(|l| {
            l.iter()
                .map(|y| json!({ "year": y["year"], "financialAssets": y["financialAssets"], "loanRepayment": y["loanRepayment"], "loanInterest": y["loanInterest"], "loanRate": y["loanRate"] }))
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
pub const NOTE: &str = "グラフは、比べる道具（compare）と同じ道で計算した数字を、アプリの画面のグラフと同じ目盛り・色で描いた物です（数字は AI から受け取っていません）。どのグラフにも、題・凡例（通りの文字と名前）・単位（万円。金利の推移 rate は %）・前提の短い注・「ファイナンシアで試算」の旨が入っています。PNG は image、SVG は image/svg+xml の埋め込みで返します。figures の数字は keyFigures と同じです。";

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: Value) -> ChartArgs {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn checks_the_choices() {
        let ok = check(&args(json!({ "variants": [] }))).unwrap();
        assert_eq!(ok.0, DEFAULT_KINDS);
        assert_eq!(ok.2, "png");
        assert_eq!(ok.3, "light");
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
