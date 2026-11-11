//! 感度（sweep）と境目探し（find_threshold）の入出力の形・振る値の作り方・探し方・答えのまとめ方。
//!
//! - 感度: 1つの動かす項目（plan_changes と同じ書き方。list_plan_items の target・item）を範囲で振り、値ごとの主な数字を表（列の名前と行の並び）で返す
//! - 境目探し: 主な数字の条件（資産が尽きない・○歳の時点で○円以上・いちばん少ない年でも○円以上）を満たす、いちばん大きい（小さい）値を、
//!   接続口の中で探して返す。単調と分かる項目は二分探索、ほかは刻みで振って端から順に確かめる
//!
//! 1つの値の計算は compare と同じ道（server.rs の compute: プランの変更 → 計算の前の処理 → 計算 → 主な数字）を通り、ここには書かない。
//! 値が項目の範囲の外かどうかも、画面の関数（プランの当て方。0195）に任せる（範囲の外なら計算せずに、その理由を返す）。
//! 振る項目を選ぶのも、plan_changes と同じ画面の当てはめ（場所 at・lever を含む。0201・0204）で、ここには選び方を書かない。

use crate::calc::Change;
use crate::plan::PlanChange;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Map, Value};

/// 感度で振る値の数の上限（刻みで探す境目探しの値の数の上限も同じ）
pub const MAX_POINTS: usize = 21;
/// 二分探索で探す刻みの数の上限（2,001 個で計算は最大 13 回）
pub const MAX_GRID: usize = 2001;
/// 刻みで探すとき、一度に計算する数（compare と同じく同時に4つまで）
pub const SCAN_BATCH: usize = 4;

/// 動かすと主な数字が一方向にだけ動く（単調）と分かっている項目（入力項目ID と理由）。境目探しはこれだけ二分探索にする
pub const MONOTONE: &[(&str, &str)] = &[
    (
        "livingExpense.monthly",
        "毎月の生活費は、多いほど毎年の支出が増え、金融資産が減る一方なので",
    ),
    (
        "employment.to",
        "働く最後の年齢は、遅いほど働く年の収入（と年金の加入）が増え、金融資産が増える一方なので",
    ),
    (
        "assumptions.returnShifts",
        "運用の利回りは、高いほど運用している資産が増え、金融資産が増える一方なので",
    ),
];

/// 振る項目（plan_changes の1件から値を外した物。list_plan_items の target・item と、一覧が添えた場所 at か lever）
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Vary {
    /// 対象: list_plan_items の target（世帯の物・構成員の ID か、前提条件なら "assumptions"）
    pub target: String,
    /// 入力項目 ID（list_plan_items の item。例: employment.to〔働く最後の年齢〕・livingExpense.monthly〔毎月の生活費〕・
    /// assumptions.returnShifts〔運用の利回り〕・employment.type〔配偶者の働き方と年収。年収を振る〕・account.contributions〔資産運用の積立。lever で選ぶ〕）
    pub item: String,
    /// 場所（list_plan_items が at を添えた項目だけ。そのまま渡す。plan_changes の at と同じ）。同じ対象・同じ入力項目ID で場所だけが違う欄
    /// （教育の段階ごとの欄・生活費の段階の割合など）を選ぶ。lever とどちらか1つ
    #[serde(default)]
    pub at: Option<Vec<String>>,
    /// 合成の対策の名前（list_plan_items が lever を添えた項目だけ。そのまま渡す。plan_changes の lever と同じ。例: investMonthly〔資産運用の
    /// 毎月の積立額〕・investStopAge〔積立をやめる年齢〕・drawdownStart〔取り崩しを始める年齢〕）。at とどちらか1つ
    #[serde(default)]
    pub lever: Option<String>,
}

impl Vary {
    /// この値を当てるプランの変更1件（場所はそのまま運ぶ）
    pub fn change(&self, value: Value) -> PlanChange {
        PlanChange {
            target: self.target.clone(),
            item: self.item.clone(),
            at: self.at.clone(),
            lever: self.lever.clone(),
            value,
        }
    }

    /// 場所（at か lever）を添えたか
    pub fn placed(&self) -> bool {
        self.at.is_some() || self.lever.is_some()
    }

    /// 画面の関数（pickPlanItem）に渡す形（plan_changes の1件から値を外した物）
    pub fn pick_json(&self) -> Value {
        let mut v = crate::plan::change_json(&self.change(Value::Null));
        if let Some(o) = v.as_object_mut() {
            o.remove("value");
        }
        v
    }

    /// 人が読める振る項目の書き方（target・item と、添えた場所）
    fn text(&self) -> String {
        let mut s = format!("target {}・item {}", self.target, self.item);
        if let Some(at) = &self.at {
            s.push_str(&format!("・at {}", json!(at)));
        }
        if let Some(l) = &self.lever {
            s.push_str(&format!("・lever {l}"));
        }
        s
    }

    /// 振る項目を選べなかったときの道具の答え（pickPlanItem の rejected の reason・places から）。場所の要る項目に場所を書かなかったときは
    /// （reason が無い）、選べる場所を list_plan_items と同じ形（at か lever・place・label）で並べる
    pub fn rejected_message(&self, reason: Option<&str>, places: &[Value]) -> String {
        let choices: Vec<String> = places
            .iter()
            .map(|p| {
                let by = match (&p["at"], &p["lever"]) {
                    (Value::Array(_), _) => format!("at {}", p["at"]),
                    (_, Value::String(l)) => format!("lever \"{l}\""),
                    _ => String::new(),
                };
                format!(
                    "{by}（{} › {}）",
                    p["place"].as_str().unwrap_or(""),
                    p["label"].as_str().unwrap_or("")
                )
            })
            .collect();
        let message = match reason {
            None => format!(
                "vary（{}）は、場所だけが違う項目が{}件あるので、どれを振るかを at か lever で選んでください（list_plan_items が添えた at か lever を、そのまま vary に書きます）。選べる場所: {}。FP には place と label で伝えてください。",
                self.text(),
                places.len(),
                choices.join("・")
            ),
            Some(r) => {
                let mut m = format!(
                    "vary（{}）は、この世帯の動かす項目に当てはまりません（{r}）。list_plan_items（入力の欄から作った項目は fields: true）で target・item・at・lever を確かめてください。",
                    self.text()
                );
                if !choices.is_empty() {
                    m.push_str(&format!(
                        "同じ対象・同じ入力項目ID で選べる場所: {}。",
                        choices.join("・")
                    ));
                }
                m
            }
        };
        let mut v = json!({ "message": message });
        if !places.is_empty() {
            v["places"] = json!(places);
        }
        v.to_string()
    }
}

/// 境目探しの条件
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    /// 条件の型: noDepletion（資産が最後まで尽きない）・assetsAtAge（本人が age 歳の時点の金融資産が at_least 円以上）・
    /// minimumAtLeast（金融資産がいちばん少ない年でも at_least 円以上）
    #[schemars(extend("enum" = ["noDepletion", "assetsAtAge", "minimumAtLeast"]))]
    pub r#type: String,
    /// assetsAtAge の本人の年齢（0〜120）
    pub age: Option<u8>,
    /// assetsAtAge・minimumAtLeast の金額（円。0 なら「マイナスにならない」）
    pub at_least: Option<i64>,
}

impl Condition {
    /// 形を確かめる
    pub fn check(&self) -> Result<(), String> {
        match self.r#type.as_str() {
            "noDepletion" => Ok(()),
            "assetsAtAge" => match (self.age, self.at_least) {
                (Some(a), Some(_)) if a <= 120 => Ok(()),
                _ => Err("condition の assetsAtAge には age（本人の年齢。0〜120）と at_least（円）を書いてください。".to_owned()),
            },
            "minimumAtLeast" => match self.at_least {
                Some(_) => Ok(()),
                None => Err("condition の minimumAtLeast には at_least（円）を書いてください。".to_owned()),
            },
            other => Err(format!(
                "condition の type は noDepletion・assetsAtAge・minimumAtLeast のどれかです（{other}）。"
            )),
        }
    }

    /// 主な数字（calculate の keyFigures）が条件を満たすか
    pub fn met(&self, kf: &Value) -> bool {
        match self.r#type.as_str() {
            "noDepletion" => kf["depletion"].is_null(),
            "assetsAtAge" => kf["assetsAtAge"]
                .as_array()
                .and_then(|a| a.iter().find(|x| x["age"] == json!(self.age)))
                .or_else(|| kf["assetsAtAge"].get(0))
                .and_then(|x| x["amount"].as_i64())
                .is_some_and(|v| v >= self.at_least.unwrap_or(0)),
            "minimumAtLeast" => kf["minimum"]["amount"]
                .as_i64()
                .is_some_and(|v| v >= self.at_least.unwrap_or(0)),
            _ => false,
        }
    }

    /// 人が読める条件の文
    pub fn text(&self) -> String {
        let yen = |v: i64| format!("{}円", group(v));
        match self.r#type.as_str() {
            "noDepletion" => "資産が最後まで尽きない".to_owned(),
            "assetsAtAge" => format!(
                "ご本人が{}歳の時点の金融資産が{}以上",
                self.age.unwrap_or(0),
                yen(self.at_least.unwrap_or(0))
            ),
            _ => format!(
                "金融資産がいちばん少ない年でも{}以上",
                yen(self.at_least.unwrap_or(0))
            ),
        }
    }
}

/// 3桁ごとの区切り（-1234567 → -1,234,567）
fn group(v: i64) -> String {
    let s = v.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if v < 0 {
        format!("-{out}")
    } else {
        out
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SweepArgs {
    /// 基本の世帯: 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// 基本の世帯: FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// 基本の世帯: AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 基本に当てる JSON Pointer の変更（calculate の changes と同じ）
    pub changes: Option<Vec<Change>>,
    /// 基本で動かす画面のプランの動かす項目（calculate の plan_changes と同じ）。振る項目は、この後に当てる（同じ項目なら振る値が勝つ）
    pub plan_changes: Option<Vec<PlanChange>>,
    /// 基本のストレステストの型（calculate の stress_test と同じ）
    pub stress_test: Option<String>,
    /// 基本に重ねる、アプリの画面の「相場が下がった場合」の型（compare の market_stress と同じ。stress_test とは一緒に使えない）
    #[schemars(extend("enum" = ["drop", "low", "minus1", null]))]
    pub market_stress: Option<String>,
    /// 振る項目（list_plan_items の target・item と、一覧が添えた場所 at か lever。plan_changes の1件から value を外した物）
    pub vary: Vary,
    /// 振る範囲の始め（含む）。値の形は list_plan_items の kind に合わせる: 年齢・整数・金額は整数、率は10進の文字列（"0.01"）。
    /// 配偶者の働き方と年収（kind が work）は1年の収入（円）を振る
    pub from: Option<Value>,
    /// 振る範囲の終わり（含む。from 以上）
    pub to: Option<Value>,
    /// 刻み（正の数）。省くと、年齢・整数は1、金額・率は画面のスライダーの刻み
    pub step: Option<Value>,
    /// from・to・step の代わりに、振る値をそのまま並べる（list_plan_items の kind・unit の形。21個まで）
    pub values: Option<Vec<Value>>,
    /// kind が work の項目で、振る年収の働き方（list_plan_items の options の value）。省くと今の働き方
    pub work_type: Option<String>,
    /// 「○歳時点の金融資産」の本人の年齢（5つまで。既定 [95]）
    pub at_ages: Option<Vec<u8>>,
    /// 表に入れる主な数字（既定は loanInterest のほか全部）: assetsAtAge（○歳時点の金融資産）・depletion（資産が尽きる年と本人の年齢）・minimum（金融資産が
    /// いちばん少ない年と額）・lifetimeTakeHome・lifetimeExpense・loanRepayment・loanInterest（住宅ローンの利息の合計。選んだときだけ）・pension（65歳からの年金の世帯の月額と、受け取り開始からの
    /// 月額。省くと年金の見込みの計算をしないので速くなる）
    #[schemars(extend("items" = { "type": "string", "enum": ["assetsAtAge", "depletion", "minimum", "lifetimeTakeHome", "lifetimeExpense", "loanRepayment", "loanInterest", "pension"] }))]
    pub figures: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ThresholdArgs {
    /// 基本の世帯: 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// 基本の世帯: FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// 基本の世帯: AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 基本に当てる JSON Pointer の変更（calculate の changes と同じ）
    pub changes: Option<Vec<Change>>,
    /// 基本で動かす画面のプランの動かす項目（calculate の plan_changes と同じ）。探す項目は、この後に当てる
    pub plan_changes: Option<Vec<PlanChange>>,
    /// 基本のストレステストの型（calculate の stress_test と同じ）
    pub stress_test: Option<String>,
    /// 基本に重ねる、アプリの画面の「相場が下がった場合」の型（compare の market_stress と同じ。stress_test とは一緒に使えない）
    #[schemars(extend("enum" = ["drop", "low", "minus1", null]))]
    pub market_stress: Option<String>,
    /// 境目を探す項目（list_plan_items の target・item と、一覧が添えた場所 at か lever。sweep の vary と同じ）
    pub vary: Vary,
    /// 探す範囲の始め（含む。sweep の from と同じ形）
    pub from: Value,
    /// 探す範囲の終わり（含む。from より大きい）
    pub to: Value,
    /// 刻み（答えの細かさ。正の数）。省くと、年齢・整数は1、金額・率は画面のスライダーの刻み
    pub step: Option<Value>,
    /// kind が work の項目で、探す年収の働き方。省くと今の働き方
    pub work_type: Option<String>,
    /// 満たしたい条件（例: {"type": "noDepletion"}・{"type": "assetsAtAge", "age": 90, "at_least": 10000000}）
    pub condition: Condition,
    /// max（条件を満たす、いちばん大きい値。例: 生活費の上限）か min（条件を満たす、いちばん小さい値。例: いちばん早い退職の年齢・足りる最低の利回り）
    #[schemars(extend("enum" = ["max", "min"]))]
    pub want: String,
    /// 探し方: auto（既定。単調と分かる項目は二分探索、ほかは刻みで振る）・bisect（二分探索。単調だと分かっているときだけ）・scan（刻みで振る。21個まで）
    #[schemars(extend("enum" = ["auto", "bisect", "scan", null]))]
    pub method: Option<String>,
    /// 表に入れる主な数字（sweep の figures と同じ。既定は loanInterest のほか全部）
    #[schemars(extend("items" = { "type": "string", "enum": ["assetsAtAge", "depletion", "minimum", "lifetimeTakeHome", "lifetimeExpense", "loanRepayment", "loanInterest", "pension"] }))]
    pub figures: Option<Vec<String>>,
}

/// 表に入れられる主な数字
pub const FIGURES: &[&str] = &[
    "assetsAtAge",
    "depletion",
    "minimum",
    "lifetimeTakeHome",
    "lifetimeExpense",
    "loanRepayment",
    "loanInterest",
    "pension",
];

/// 選んだときだけ表に入れる主な数字（住宅ローンの利息の合計。0205。既定の表の大きさは変えない）
pub const OPTIONAL_FIGURES: &[&str] = &["loanInterest"];

/// 表に入れる主な数字を確かめる（既定は OPTIONAL_FIGURES のほか全部）
pub fn figures(list: Option<&[String]>) -> Result<Vec<String>, String> {
    let Some(list) = list else {
        return Ok(FIGURES
            .iter()
            .filter(|f| !OPTIONAL_FIGURES.contains(f))
            .map(|s| (*s).to_owned())
            .collect());
    };
    let bad: Vec<&str> = list
        .iter()
        .map(String::as_str)
        .filter(|f| !FIGURES.contains(f))
        .collect();
    if !bad.is_empty() || list.is_empty() {
        return Err(format!(
            "figures に選べるのは {} です（{}）。",
            FIGURES.join("・"),
            bad.join("・")
        ));
    }
    Ok(FIGURES
        .iter()
        .filter(|f| list.iter().any(|x| x == *f))
        .map(|s| (*s).to_owned())
        .collect())
}

/// 10進の数（mantissa × 10^-scale）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dec {
    m: i128,
    scale: u32,
}

impl Dec {
    /// JSON の数か10進の文字列から（指数の形・小数点以下12桁より細かい値は受けない）
    pub fn parse(v: &Value) -> Option<Self> {
        let s = match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.trim().to_owned(),
            _ => return None,
        };
        let (neg, body) = match s.strip_prefix('-') {
            Some(b) => (true, b),
            None => (false, s.as_str()),
        };
        let (int, frac) = body.split_once('.').unwrap_or((body, ""));
        if int.is_empty()
            || !int.bytes().all(|b| b.is_ascii_digit())
            || !frac.bytes().all(|b| b.is_ascii_digit())
            || frac.len() > 12
            || int.len() > 15
        {
            return None;
        }
        let m: i128 = format!("{int}{frac}").parse().ok()?;
        Some(Self {
            m: if neg { -m } else { m },
            scale: u32::try_from(frac.len()).ok()?,
        })
    }

    fn at(self, scale: u32) -> i128 {
        self.m * 10i128.pow(scale - self.scale)
    }

    /// 整数か
    pub fn is_integer(self) -> bool {
        self.m % 10i128.pow(self.scale) == 0
    }

    /// 10進の文字列（後ろの0を落とす。"0.0150" → "0.015"）
    pub fn text(self) -> String {
        let neg = self.m < 0;
        let digits = self.m.unsigned_abs().to_string();
        let scale = self.scale as usize;
        let padded = format!("{digits:0>width$}", width = scale + 1);
        let (int, frac) = padded.split_at(padded.len() - scale);
        let frac = frac.trim_end_matches('0');
        let body = if frac.is_empty() {
            int.to_owned()
        } else {
            format!("{int}.{frac}")
        };
        if neg && body.bytes().any(|b| b != b'0' && b != b'.') {
            format!("-{body}")
        } else {
            body
        }
    }

    /// 整数（円・歳）として
    pub fn as_i64(self) -> Option<i64> {
        if !self.is_integer() {
            return None;
        }
        i64::try_from(self.m / 10i128.pow(self.scale)).ok()
    }
}

/// 振る値の形（list_plan_items の kind から）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// 整数（年齢・整数・金額。JSON の数で渡す）
    Integer,
    /// 10進の文字列（率・10進）
    Decimal,
    /// 働き方と年収（{type, annual} の annual を振る）
    Work,
    /// ほかの形（toggle・mix・rateShift など）。values で並べるときだけ
    Other,
}

impl Kind {
    pub fn of(kind: &str) -> Self {
        match kind {
            "age" | "int" | "amount" => Self::Integer,
            "rate" | "decimal" => Self::Decimal,
            "work" => Self::Work,
            _ => Self::Other,
        }
    }
}

/// 振る値1つ: 表に出す値（work なら年収）と、当てる値
#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    pub shown: Value,
    pub value: Value,
}

/// 刻みの既定（年齢・整数は1、金額・率は画面のスライダーの刻み）
fn default_step(item: &Value) -> Option<Dec> {
    match item["kind"].as_str() {
        Some("age" | "int") => Some(Dec { m: 1, scale: 0 }),
        _ => Dec::parse(&item["slider"]["step"]),
    }
}

/// 範囲（from・to・step）から振る値を作る。limit を超えるなら、範囲に収まる刻みの目安つきの理由
pub fn grid(
    item: &Value,
    from: &Value,
    to: &Value,
    step: Option<&Value>,
    work_type: Option<&str>,
    limit: usize,
) -> Result<(Vec<Point>, Value), String> {
    let kind = Kind::of(item["kind"].as_str().unwrap_or(""));
    if kind == Kind::Other {
        return Err(format!(
            "この項目（{}。kind は {}）は範囲では振れません。values に値を並べてください。",
            item["label"].as_str().unwrap_or(""),
            item["kind"].as_str().unwrap_or("")
        ));
    }
    let form = if kind == Kind::Decimal {
        "10進の文字列（\"0.01\" など）か数"
    } else {
        "整数"
    };
    let parse = |v: &Value, name: &str| {
        Dec::parse(v)
            .filter(|d| kind == Kind::Decimal || d.is_integer())
            .ok_or_else(|| format!("{name} は{form}で書いてください（{v}）。"))
    };
    let (a, b) = (parse(from, "from")?, parse(to, "to")?);
    let s = match step {
        Some(v) => parse(v, "step")?,
        None => default_step(item).ok_or_else(|| {
            "この項目には刻みの既定が無いので、step を書いてください。".to_owned()
        })?,
    };
    let scale = a.scale.max(b.scale).max(s.scale);
    let (am, bm, sm) = (a.at(scale), b.at(scale), s.at(scale));
    if sm <= 0 {
        return Err("step は正の数にしてください。".to_owned());
    }
    if am > bm {
        return Err("from は to 以下にしてください。".to_owned());
    }
    let count = (bm - am) / sm + 1;
    if count > limit as i128 {
        // 範囲に収まる刻みの目安（切り上げ）
        let need = (bm - am + (limit as i128 - 2)) / (limit as i128 - 1);
        return Err(format!(
            "値は{limit}個までです（この範囲と刻みでは {count} 個）。刻みを {} 以上にするか、範囲を狭めてください。",
            Dec { m: need.max(1), scale }.text()
        ));
    }
    let work = work_type
        .map(str::to_owned)
        .or_else(|| item["value"]["type"].as_str().map(str::to_owned));
    let mut out = Vec::new();
    for i in 0..count {
        let d = Dec {
            m: am + i * sm,
            scale,
        };
        let (shown, value) = match kind {
            Kind::Decimal => (json!(d.text()), json!(d.text())),
            _ => {
                let n = d.as_i64().ok_or_else(|| "値が大きすぎます。".to_owned())?;
                if kind == Kind::Work {
                    let Some(t) = &work else {
                        return Err("work_type（働き方）を書いてください。".to_owned());
                    };
                    (json!(n), json!({ "type": t, "annual": n }))
                } else {
                    (json!(n), json!(n))
                }
            }
        };
        out.push(Point { shown, value });
    }
    let step_shown = match kind {
        Kind::Decimal => json!(s.text()),
        _ => json!(s.as_i64()),
    };
    Ok((out, step_shown))
}

/// values で並べた値（work の項目で数だけ書いた値は、働き方を添える）
pub fn listed(
    item: &Value,
    values: &[Value],
    work_type: Option<&str>,
) -> Result<Vec<Point>, String> {
    if values.is_empty() || values.len() > MAX_POINTS {
        return Err(format!("values は1〜{MAX_POINTS}個にしてください。"));
    }
    let work = work_type
        .map(str::to_owned)
        .or_else(|| item["value"]["type"].as_str().map(str::to_owned));
    Ok(values
        .iter()
        .map(|v| match (&work, v) {
            (Some(t), Value::Number(_))
                if Kind::of(item["kind"].as_str().unwrap_or("")) == Kind::Work =>
            {
                Point {
                    shown: v.clone(),
                    value: json!({ "type": t, "annual": v }),
                }
            }
            _ => Point {
                shown: v.clone(),
                value: v.clone(),
            },
        })
        .collect())
}

/// 振った値の人が読める文（年齢は「64歳」、金額・年収は「275,000円」、率は「6.8%」）
pub fn value_text(item: &Value, v: &Value) -> String {
    match (item["kind"].as_str(), Dec::parse(v)) {
        (Some("age"), Some(d)) => format!("{}歳", d.text()),
        (Some("amount" | "work"), Some(d)) => d
            .as_i64()
            .map_or_else(|| d.text(), |n| format!("{}円", group(n))),
        (Some("rate"), Some(d)) => format!(
            "{}%",
            Dec {
                m: d.m * 100,
                scale: d.scale
            }
            .text()
        ),
        (_, Some(d)) => d.text(),
        _ => v.to_string(),
    }
}

/// 境目探しの条件の答えの形（書いた物だけ）
pub fn condition_out(c: &Condition) -> Value {
    let mut o = Map::new();
    o.insert("type".into(), json!(c.r#type));
    if let Some(a) = c.age {
        o.insert("age".into(), json!(a));
    }
    if let Some(a) = c.at_least {
        o.insert("atLeast".into(), json!(a));
    }
    o.insert("text".into(), json!(c.text()));
    Value::Object(o)
}

/// 表の列の名前（value の後に、選んだ主な数字）
pub fn columns(figures: &[String], at_ages: &[u8]) -> Vec<String> {
    let mut c = vec!["value".to_owned()];
    for f in figures {
        match f.as_str() {
            "assetsAtAge" => {
                let ages: Vec<u8> = if at_ages.is_empty() {
                    vec![95]
                } else {
                    at_ages.to_vec()
                };
                c.extend(ages.iter().map(|a| format!("assetsAt{a}")));
            }
            "depletion" => c.extend(["depletionYear".to_owned(), "depletionAge".to_owned()]),
            "minimum" => c.extend(["minimumYear".to_owned(), "minimumAmount".to_owned()]),
            "pension" => c.extend([
                "pensionMonthly".to_owned(),
                "pensionClaimedMonthly".to_owned(),
            ]),
            other => c.push(other.to_owned()),
        }
    }
    c
}

/// 表の1行（列の並びは columns と同じ）。kf は calculate の keyFigures
pub fn row(shown: &Value, kf: &Value, figures: &[String]) -> Vec<Value> {
    let mut r = vec![shown.clone()];
    for f in figures {
        match f.as_str() {
            "assetsAtAge" => {
                if let Some(a) = kf["assetsAtAge"].as_array() {
                    r.extend(a.iter().map(|x| x["amount"].clone()));
                }
            }
            "depletion" => {
                r.push(kf["depletion"]["year"].clone());
                r.push(kf["depletion"]["selfAge"].clone());
            }
            "minimum" => {
                r.push(kf["minimum"]["year"].clone());
                r.push(kf["minimum"]["amount"].clone());
            }
            "pension" => {
                r.push(kf["pension"]["monthly"].clone());
                r.push(kf["pension"]["claimedMonthly"].clone());
            }
            other => r.push(kf[other].clone()),
        }
    }
    r
}

/// 答えに添える、振る項目の説明（名前・値の形・今の値）
pub fn vary_out(v: &Vary, item: &Value) -> Value {
    let mut o = Map::new();
    o.insert("target".into(), json!(v.target));
    o.insert("item".into(), json!(v.item));
    if let Some(at) = &v.at {
        o.insert("at".into(), json!(at));
    }
    if let Some(l) = &v.lever {
        o.insert("lever".into(), json!(l));
    }
    for k in ["place", "label", "kind", "unit"] {
        if let Some(x) = item.get(k) {
            o.insert(k.into(), x.clone());
        }
    }
    o.insert("now".into(), item["value"].clone());
    if let Some(t) = item.get("valueText") {
        o.insert("nowText".into(), t.clone());
    }
    if item["kind"] == "work" {
        o.insert("shown".into(), json!("value の列は1年の収入（円）"));
    }
    Value::Object(o)
}

/// 計算できなかった値の理由（当てはまらないプランの変更なら、その変更の理由）
pub fn reason_of(msg: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(msg) {
        if let Some(r) = v["planChanges"]
            .as_array()
            .and_then(|l| l.iter().find(|x| x["status"] == "rejected"))
        {
            return format!(
                "{}: {}",
                r["label"].as_str().unwrap_or(""),
                r["reason"].as_str().unwrap_or("当てはまりません")
            );
        }
        if let Some(m) = v["message"].as_str() {
            return m.to_owned();
        }
    }
    msg.to_owned()
}

/// 計算しなかった値を、同じ理由ごとにまとめて足す（{values, reason}）
pub fn skip(list: &mut Vec<Value>, value: &Value, reason: String) {
    if let Some(last) = list.last_mut() {
        if last["reason"] == reason.as_str() {
            if let Some(v) = last["values"].as_array_mut() {
                v.push(value.clone());
                return;
            }
        }
    }
    list.push(json!({ "values": [value], "reason": reason }));
}

/// 探し方
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Bisect,
    Scan,
}

impl Method {
    pub fn key(self) -> &'static str {
        match self {
            Self::Bisect => "bisect",
            Self::Scan => "scan",
        }
    }
}

/// 探し方を決める（auto なら、単調と分かる項目だけ二分探索）と、その理由の文。単調と分かる項目は場所の要らない項目だけ
/// （placed は振る項目に場所 at・lever を添えたか）
pub fn method_of(
    asked: Option<&str>,
    item: &str,
    placed: bool,
) -> Result<(Method, String), String> {
    let mono = MONOTONE
        .iter()
        .find(|(i, _)| *i == item && !placed)
        .map(|(_, why)| *why);
    match asked.unwrap_or("auto") {
        "auto" => Ok(match mono {
            Some(why) => (
                Method::Bisect,
                format!("{why}、二分探索で探しました（範囲の両端を計算し、間を半分ずつ狭めました）。"),
            ),
            None => (
                Method::Scan,
                "この項目は、動かしたときに主な数字が一方向にだけ動くとは限らない（単調と分かっていない）ので、刻みで振って、端から順に条件を確かめました。範囲の中に、条件を満たす所がほかにもあるかもしれません（sweep で表を見られます）。".to_owned(),
            ),
        }),
        "bisect" => Ok((
            Method::Bisect,
            match mono {
                Some(why) => format!("{why}、二分探索で探しました。"),
                None => "頼まれたとおり二分探索で探しました（この項目が単調でなければ、境目がほかにもあるかもしれません）。".to_owned(),
            },
        )),
        "scan" => Ok((Method::Scan, "頼まれたとおり、刻みで振って、端から順に条件を確かめました。".to_owned())),
        other => Err(format!("method は auto・bisect・scan のどれかです（{other}）。")),
    }
}

/// 1つの値を確かめた結果: 条件を満たすか（計算できなければ理由）
pub type Check = Result<bool, String>;

/// 探した結果（添え字は振る値の並び〔小さい順〕の位置）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Found {
    /// 境目が範囲の中にある: 条件を満たす端の値と、その1つ外側の満たさない値
    Boundary { inside: usize, beyond: usize },
    /// 範囲の端の値が条件を満たす（境目は範囲の外かもしれない）
    Edge { inside: usize },
    /// 範囲の中に条件を満たす値が無い（両端の添え字）
    None { ends: (usize, usize) },
    /// 計算できない値があった
    Failed { at: usize, reason: String },
}

/// 境目を探す。n は振る値の数、want_max は「いちばん大きい値」か、eval は添え字の並びをまとめて確かめる（同じ添え字を2度は渡さない）。
/// 戻り値は探した結果と、確かめた添え字（計算した順）
pub fn search(
    n: usize,
    want_max: bool,
    method: Method,
    eval: &mut dyn FnMut(&[usize]) -> Vec<Check>,
) -> (Found, Vec<usize>) {
    // 探す並び: いちばん欲しい端から（max なら大きい順）。この並びで最初に条件を満たす所が答え
    let order: Vec<usize> = if want_max {
        (0..n).rev().collect()
    } else {
        (0..n).collect()
    };
    let mut done: Vec<usize> = Vec::new();
    let mut seen: std::collections::BTreeMap<usize, bool> = Default::default();
    let mut run = |idx: &[usize],
                   seen: &mut std::collections::BTreeMap<usize, bool>,
                   done: &mut Vec<usize>|
     -> Result<(), (usize, String)> {
        let mut todo: Vec<usize> = Vec::new();
        for i in idx {
            if !seen.contains_key(i) && !todo.contains(i) {
                todo.push(*i);
            }
        }
        if todo.is_empty() {
            return Ok(());
        }
        let got = eval(&todo);
        for (i, r) in todo.iter().zip(got) {
            done.push(*i);
            match r {
                Ok(b) => {
                    seen.insert(*i, b);
                }
                Err(e) => return Err((*i, e)),
            }
        }
        Ok(())
    };
    if n == 0 {
        return (Found::None { ends: (0, 0) }, done);
    }
    let last = n - 1;
    match method {
        Method::Scan => {
            for chunk in order.chunks(SCAN_BATCH) {
                if let Err((at, reason)) = run(chunk, &mut seen, &mut done) {
                    return (Found::Failed { at, reason }, done);
                }
                if let Some(p) = order.iter().position(|i| seen.get(i) == Some(&true)) {
                    return if p == 0 {
                        (Found::Edge { inside: order[0] }, done)
                    } else {
                        (
                            Found::Boundary {
                                inside: order[p],
                                beyond: order[p - 1],
                            },
                            done,
                        )
                    };
                }
            }
            (Found::None { ends: (0, last) }, done)
        }
        Method::Bisect => {
            // 両端を確かめる。欲しい端が満たせば端、もう一方の端も満たさなければ範囲に無い
            if let Err((at, reason)) = run(&[order[0], order[last]], &mut seen, &mut done) {
                return (Found::Failed { at, reason }, done);
            }
            if seen[&order[0]] {
                return (Found::Edge { inside: order[0] }, done);
            }
            if !seen[&order[last]] {
                return (Found::None { ends: (0, last) }, done);
            }
            // order[lo] は満たさない・order[hi] は満たす、を保って狭める
            let (mut lo, mut hi) = (0usize, last);
            while hi - lo > 1 {
                let mid = lo + (hi - lo) / 2;
                if let Err((at, reason)) = run(&[order[mid]], &mut seen, &mut done) {
                    return (Found::Failed { at, reason }, done);
                }
                if seen[&order[mid]] {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            (
                Found::Boundary {
                    inside: order[hi],
                    beyond: order[lo],
                },
                done,
            )
        }
    }
}

/// 感度の答えに添える説明（列の意味は道具の説明に書く）
pub const SWEEP_NOTE: &str = "rows は振った値ごとの主な数字で、列は columns の順です（calculate の keyFigures と同じ数え方。金額は円・年金は世帯の月額）。notComputed の values は計算しておらず、reason が理由です。";

/// 境目探しの答えに添える説明
pub const THRESHOLD_NOTE: &str = "threshold が条件を満たす境目の値、rows は境目の値とその1つ外側の値（notFound なら範囲の両端）の主な数字です（列は columns の順。sweep と同じ数え方。meets は条件を満たすか）。";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimals_round_trip() {
        assert_eq!(Dec::parse(&json!("0.0150")).unwrap().text(), "0.015");
        assert_eq!(Dec::parse(&json!(0.005)).unwrap().text(), "0.005");
        assert_eq!(Dec::parse(&json!(-0.01)).unwrap().text(), "-0.01");
        assert_eq!(Dec::parse(&json!("0")).unwrap().text(), "0");
        assert_eq!(Dec::parse(&json!(300000)).unwrap().as_i64(), Some(300_000));
        assert!(Dec::parse(&json!("1e3")).is_none());
        assert!(Dec::parse(&json!(true)).is_none());
        assert!(Dec::parse(&json!("1.5")).unwrap().as_i64().is_none());
    }

    #[test]
    fn grids_follow_the_kind() {
        let age = json!({ "kind": "age", "label": "働く最後の年齢", "value": 60 });
        let g = grid(&age, &json!(60), &json!(70), None, None, MAX_POINTS)
            .unwrap()
            .0;
        assert_eq!(g.len(), 11);
        assert_eq!(g[3].value, json!(63));
        // 年齢に小数は書けない
        assert!(grid(&age, &json!(60.5), &json!(70), None, None, MAX_POINTS).is_err());
        let rate = json!({ "kind": "rate", "slider": { "step": "0.0005" } });
        let g = grid(
            &rate,
            &json!("0.01"),
            &json!(0.03),
            Some(&json!("0.005")),
            None,
            MAX_POINTS,
        )
        .unwrap()
        .0;
        let shown: Vec<Value> = g.iter().map(|p| p.value.clone()).collect();
        assert_eq!(
            shown,
            vec![
                json!("0.01"),
                json!("0.015"),
                json!("0.02"),
                json!("0.025"),
                json!("0.03")
            ]
        );
        // 刻みの既定はスライダーの刻み。多すぎれば収まる刻みの目安
        let err = grid(&rate, &json!("0"), &json!("0.07"), None, None, MAX_POINTS).unwrap_err();
        assert!(err.contains("141 個") && err.contains("0.0035"), "{err}");
        let money = json!({ "kind": "amount", "slider": { "step": 10000 } });
        let g = grid(
            &money,
            &json!(250000),
            &json!(350000),
            None,
            None,
            MAX_POINTS,
        )
        .unwrap()
        .0;
        assert_eq!(g.len(), 11);
        // 割り切れない範囲は、to を超えない所まで
        let g = grid(
            &money,
            &json!(250000),
            &json!(255000),
            Some(&json!(2000)),
            None,
            MAX_POINTS,
        )
        .unwrap()
        .0;
        assert_eq!(g.last().unwrap().value, json!(254000));
        assert!(grid(&money, &json!(2), &json!(1), None, None, MAX_POINTS)
            .unwrap_err()
            .contains("from"));
        assert!(grid(
            &money,
            &json!(1),
            &json!(2),
            Some(&json!(0)),
            None,
            MAX_POINTS
        )
        .unwrap_err()
        .contains("正の数"));
        // 働き方と年収は、今の働き方のまま年収を振る
        let work = json!({ "kind": "work", "value": { "type": "partTime", "annual": 1000000 } });
        let g = grid(
            &work,
            &json!(1000000),
            &json!(1400000),
            Some(&json!(200000)),
            None,
            MAX_POINTS,
        )
        .unwrap()
        .0;
        assert_eq!(
            g[1],
            Point {
                shown: json!(1200000),
                value: json!({ "type": "partTime", "annual": 1200000 })
            }
        );
        let g = grid(
            &work,
            &json!(0),
            &json!(0),
            Some(&json!(1)),
            Some("employee"),
            MAX_POINTS,
        )
        .unwrap()
        .0;
        assert_eq!(g[0].value["type"], "employee");
        // 形の違う項目は範囲では振れない
        let toggle = json!({ "kind": "toggle", "label": "FP顧問料" });
        assert!(grid(&toggle, &json!(0), &json!(1), None, None, MAX_POINTS)
            .unwrap_err()
            .contains("values"));
        assert_eq!(
            listed(&toggle, &[json!(true), json!(false)], None)
                .unwrap()
                .len(),
            2
        );
        assert!(listed(&toggle, &vec![json!(1); MAX_POINTS + 1], None).is_err());
        assert_eq!(
            listed(&work, &[json!(1060000)], None).unwrap()[0].value,
            json!({ "type": "partTime", "annual": 1060000 })
        );
    }

    #[test]
    fn conditions_read_key_figures() {
        let kf = json!({ "assetsAtAge": [{ "age": 90, "amount": 5_000_000 }], "depletion": null, "minimum": { "amount": -1 } });
        let c = |t: &str, age: Option<u8>, at: Option<i64>| Condition {
            r#type: t.into(),
            age,
            at_least: at,
        };
        assert!(c("noDepletion", None, None).met(&kf));
        assert!(!c("noDepletion", None, None).met(&json!({ "depletion": { "year": 2050 } })));
        assert!(c("assetsAtAge", Some(90), Some(5_000_000)).met(&kf));
        assert!(!c("assetsAtAge", Some(90), Some(5_000_001)).met(&kf));
        assert!(!c("minimumAtLeast", None, Some(0)).met(&kf));
        assert!(c("assetsAtAge", None, Some(1)).check().is_err());
        assert!(c("minimumAtLeast", None, None).check().is_err());
        assert!(c("x", None, None).check().is_err());
        assert_eq!(
            c("assetsAtAge", Some(90), Some(10_000_000)).text(),
            "ご本人が90歳の時点の金融資産が10,000,000円以上"
        );
        assert_eq!(group(-1_234_567), "-1,234,567");
    }

    #[test]
    fn tables_follow_the_columns() {
        let f = figures(None).unwrap();
        let cols = columns(&f, &[85, 95]);
        let kf = json!({ "assetsAtAge": [{ "amount": 1 }, { "amount": 2 }], "depletion": { "year": 2070, "selfAge": 90 }, "minimum": { "year": 2071, "amount": -5 },
            "lifetimeTakeHome": 10, "lifetimeExpense": 20, "loanRepayment": 0, "pension": { "monthly": 200000, "claimedMonthly": 210000 } });
        let r = row(&json!(63), &kf, &f);
        assert_eq!(cols.len(), r.len());
        assert_eq!(
            cols[1..3],
            ["assetsAt85".to_owned(), "assetsAt95".to_owned()]
        );
        assert_eq!(
            r,
            vec![
                json!(63),
                json!(1),
                json!(2),
                json!(2070),
                json!(90),
                json!(2071),
                json!(-5),
                json!(10),
                json!(20),
                json!(0),
                json!(200000),
                json!(210000)
            ]
        );
        let f = figures(Some(&["pension".to_owned(), "depletion".to_owned()])).unwrap();
        assert_eq!(f, vec!["depletion".to_owned(), "pension".to_owned()]);
        // 住宅ローンの利息の合計は、選んだときだけ（0205）
        assert!(!figures(None).unwrap().contains(&"loanInterest".to_owned()));
        let f = figures(Some(&["loanInterest".to_owned()])).unwrap();
        assert_eq!(
            columns(&f, &[]),
            ["value".to_owned(), "loanInterest".to_owned()]
        );
        assert_eq!(
            row(&json!(1), &json!({ "loanInterest": 7807 }), &f),
            vec![json!(1), json!(7807)]
        );
        assert!(figures(Some(&["x".to_owned()])).is_err());
        assert!(figures(Some(&[])).is_err());
    }

    /// 単調な並び（境目より小さい値が満たす）で、二分探索と刻みの答えが同じ。計算の回数は二分探索の方が少ない
    #[test]
    fn bisect_and_scan_agree() {
        for n in [1usize, 2, 3, 10, 21] {
            for edge in 0..=n {
                for want_max in [true, false] {
                    // want_max: 小さい値が満たす（生活費）。min: 大きい値が満たす（退職の年齢）
                    let sat = |i: usize| if want_max { i < edge } else { i >= edge };
                    let mut calls = 0usize;
                    let mut eval = |idx: &[usize]| {
                        calls += idx.len();
                        idx.iter().map(|i| Ok(sat(*i))).collect()
                    };
                    let (b, done_b) = search(n, want_max, Method::Bisect, &mut eval);
                    let mut eval2 = |idx: &[usize]| idx.iter().map(|i| Ok(sat(*i))).collect();
                    let (s, _) = search(n, want_max, Method::Scan, &mut eval2);
                    assert_eq!(b, s, "n={n} edge={edge} max={want_max}");
                    assert_eq!(done_b.len(), calls);
                    let mut uniq = done_b.clone();
                    uniq.sort_unstable();
                    uniq.dedup();
                    assert_eq!(uniq.len(), done_b.len(), "同じ値を2度計算しない");
                    assert!(done_b.len() <= 2 + (n as f64).log2().ceil() as usize);
                    match b {
                        Found::Boundary { inside, beyond } => {
                            assert!(sat(inside) && !sat(beyond));
                            assert_eq!(inside.abs_diff(beyond), 1);
                        }
                        Found::Edge { inside } => {
                            assert_eq!(inside, if want_max { n - 1 } else { 0 })
                        }
                        Found::None { .. } => assert!((0..n).all(|i| !sat(i))),
                        Found::Failed { .. } => unreachable!(),
                    }
                }
            }
        }
    }

    #[test]
    fn scan_finds_the_first_from_the_wanted_end() {
        // 単調でない並び: 満たすのは 2・3・7
        let sat = [
            false, false, true, true, false, false, false, true, false, false,
        ];
        let mut eval = |idx: &[usize]| idx.iter().map(|i| Ok(sat[*i])).collect();
        let (f, done) = search(10, true, Method::Scan, &mut eval);
        assert_eq!(
            f,
            Found::Boundary {
                inside: 7,
                beyond: 8
            }
        );
        assert_eq!(done, vec![9, 8, 7, 6], "4つずつ、見つかったら止める");
        let (f, _) = search(10, false, Method::Scan, &mut eval);
        assert_eq!(
            f,
            Found::Boundary {
                inside: 2,
                beyond: 1
            }
        );
        // 計算できない値があれば止める
        let mut bad = |idx: &[usize]| {
            idx.iter()
                .map(|i| {
                    if *i == 5 {
                        Err("範囲の外".to_owned())
                    } else {
                        Ok(false)
                    }
                })
                .collect()
        };
        let (f, _) = search(10, false, Method::Scan, &mut bad);
        assert_eq!(
            f,
            Found::Failed {
                at: 5,
                reason: "範囲の外".to_owned()
            }
        );
        let (f, done) = search(10, false, Method::Bisect, &mut bad);
        assert_eq!(f, Found::None { ends: (0, 9) });
        assert_eq!(done, vec![0, 9]);
    }

    #[test]
    fn values_read_as_text() {
        assert_eq!(value_text(&json!({ "kind": "age" }), &json!(64)), "64歳");
        assert_eq!(
            value_text(&json!({ "kind": "amount" }), &json!(275000)),
            "275,000円"
        );
        assert_eq!(
            value_text(&json!({ "kind": "rate" }), &json!("0.068")),
            "6.8%"
        );
        assert_eq!(
            value_text(&json!({ "kind": "rate" }), &json!("0.0005")),
            "0.05%"
        );
        let money = json!({ "kind": "amount", "slider": { "step": 10000 } });
        assert_eq!(
            grid(
                &money,
                &json!(0),
                &json!(10),
                Some(&json!(5)),
                None,
                MAX_POINTS
            )
            .unwrap()
            .1,
            json!(5)
        );
        assert_eq!(
            grid(&money, &json!(0), &json!(20000), None, None, MAX_POINTS)
                .unwrap()
                .1,
            json!(10000)
        );
    }

    #[test]
    fn methods_follow_the_item() {
        assert_eq!(
            method_of(None, "livingExpense.monthly", false).unwrap().0,
            Method::Bisect
        );
        assert_eq!(
            method_of(Some("auto"), "pensionRecord.claim", false)
                .unwrap()
                .0,
            Method::Scan
        );
        assert_eq!(
            method_of(Some("bisect"), "pensionRecord.claim", false)
                .unwrap()
                .0,
            Method::Bisect
        );
        assert_eq!(
            method_of(Some("scan"), "employment.to", false).unwrap().0,
            Method::Scan
        );
        assert!(method_of(Some("x"), "employment.to", false).is_err());
        // 場所を添えた項目は、単調と分かる項目に入れない（刻みで振る）
        assert_eq!(
            method_of(None, "livingExpense.monthly", true).unwrap().0,
            Method::Scan
        );
    }

    #[test]
    fn reasons_come_from_the_rejected_change() {
        let msg = json!({ "message": "m", "planChanges": [{ "status": "applied" }, { "status": "rejected", "label": "働く最後の年齢", "reason": "入れてよい範囲の外" }] }).to_string();
        assert_eq!(reason_of(&msg), "働く最後の年齢: 入れてよい範囲の外");
        assert_eq!(reason_of("ふつうの文"), "ふつうの文");
        let mut l = Vec::new();
        skip(&mut l, &json!(45), "範囲の外".into());
        skip(&mut l, &json!(46), "範囲の外".into());
        skip(&mut l, &json!(80), "別の理由".into());
        assert_eq!(
            l,
            vec![
                json!({ "values": [45, 46], "reason": "範囲の外" }),
                json!({ "values": [80], "reason": "別の理由" })
            ]
        );
    }
}
