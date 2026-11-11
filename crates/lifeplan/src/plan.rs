//! プランの動かす項目（0195）: 画面の結果のタブのプランと同じ関数（app/src/connector/plan.ts を同梱した JS）で、
//! - この世帯で動かせる項目の一覧（list_plan_items）を返す
//! - プランの候補と同じ書き方（対象・入力項目ID・値。propose_scenario の changes）の変更を、calculate・explain_value の計算の要求に当てる
//! - 同じ対象・同じ入力項目ID で場所だけが違う項目は、一覧が添えた場所（入力の欄の at か合成の対策の lever。0201）も同じく運ぶ
//!
//! 接続口の側には当てはめ方・当て方を書かない（画面の関数に任せ、答えを運ぶだけ）。世帯の物の ID は AI に渡した世帯の ID のまま。

use crate::engine;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

/// 1回の計算で当てるプランの変更の上限（propose_scenario の変更の上限と同じ）
pub const MAX_PLAN_CHANGES: usize = 50;

/// プランの候補と同じ書き方の変更1件（propose_scenario の changes の1件と同じ。理由 note は要らない）
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
pub struct PlanChange {
    /// 対象: list_plan_items の target（世帯の物・構成員の ID か、前提条件なら "assumptions"）
    pub target: String,
    /// 入力項目 ID（list_plan_items の item。例: employment.to〔働く最後の年齢〕・pensionRecord.claim・livingExpense.monthly）
    pub item: String,
    /// 場所（list_plan_items が at を添えた項目だけ。そのまま渡す）。同じ対象・同じ入力項目ID で場所だけが違う欄（教育の段階ごとの欄・
    /// 生活費の段階の割合など）を選ぶ。lever とどちらか1つ
    #[serde(default)]
    pub at: Option<Vec<String>>,
    /// 合成の対策の名前（list_plan_items が lever を添えた項目だけ。そのまま渡す。例: investMonthly〔資産運用の毎月の積立額〕・
    /// investStopAge〔積立をやめる年齢〕・drawdownStart〔取り崩しを始める年齢〕・mainEndAge〔定年後の予定の定年〕）。at とどちらか1つ
    #[serde(default)]
    pub lever: Option<String>,
    /// 新しい値（list_plan_items の kind・unit の形。年齢は整数の歳、金額は円の整数、率は10進の文字列 "0.02"）
    pub value: Value,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanItemsArgs {
    /// 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える
    pub share_id: Option<String>,
    /// AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// 項目のまとまり（groups の group。例: 対策・資産運用・よく使う・働き方と収入）で絞る。入力の欄から作った項目のまとまりも選べる
    pub group: Option<String>,
    /// true なら、入力の数の欄から作った項目（画面の「＋ 動かす項目を追加」で足せる欄）もすべて返す（大きくなる）。既定は対策・資産運用・
    /// 貯まり方・よく使う項目だけ
    pub fields: Option<bool>,
}

/// JS に渡す見本の世帯の ID などの引数。post は渡された世帯の定年後の働き方の条件（null なら渡さない。0195）
fn args_json(sample: Option<&str>, group: Option<&str>, fields: bool, post: &Value) -> Value {
    let mut a = serde_json::Map::new();
    if !post.is_null() {
        a.insert("postRetirement".into(), post.clone());
    }
    if let Some(s) = sample {
        a.insert("sampleId".into(), json!(s));
    }
    if let Some(g) = group {
        a.insert("group".into(), json!(g));
    }
    if fields {
        a.insert("fields".into(), json!(true));
    }
    Value::Object(a)
}

/// 動かせる項目の一覧（重いので、呼ぶ側は spawn_blocking の中で）。戻り値は JS の答え
pub fn list(
    request: &Value,
    sample: Option<&str>,
    group: Option<&str>,
    fields: bool,
    office: &Value,
    post: &Value,
) -> Result<Value, String> {
    let out = engine::plan(
        "listPlanItems",
        &request.to_string(),
        &args_json(sample, group, fields, post).to_string(),
        &office.to_string(),
    )?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// プランの変更を当てた結果
pub enum Applied {
    /// 当てた要求と、変更ごとの当てはめ（label・from・to・status）
    Ok { request: Value, rows: Value },
    /// 当てはまらない変更があった（何も当てていない）。変更ごとの当てはめと理由
    Rejected { rows: Value },
}

/// 計算の要求に、プランの候補と同じ書き方の変更を、画面のプランと同じ関数で当てる（重いので、呼ぶ側は spawn_blocking の中で）。
/// 変更が無ければ JS を読み込まずに、要求をそのまま返す
pub fn apply(
    request: Value,
    changes: &[PlanChange],
    sample: Option<&str>,
    office: &Value,
    post: &Value,
) -> Result<Applied, String> {
    if changes.is_empty() {
        return Ok(Applied::Ok {
            request,
            rows: Value::Null,
        });
    }
    let list: Vec<Value> = changes.iter().map(change_json).collect();
    let ctx = json!({ "args": args_json(sample, None, false, post), "office": office });
    let out = engine::plan(
        "applyPlan",
        &request.to_string(),
        &Value::Array(list).to_string(),
        &ctx.to_string(),
    )?;
    let mut v: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    match v["status"].as_str() {
        Some("ok") => Ok(Applied::Ok {
            request: v["request"].take(),
            rows: v["changes"].take(),
        }),
        Some("rejected") => Ok(Applied::Rejected {
            rows: v["changes"].take(),
        }),
        Some("noSelf") => Err(NO_SELF.into()),
        Some("badInput") => Err(BAD_INPUT.into()),
        _ => Err("E_PLAN".into()),
    }
}

/// 変更1件を JS に渡す形（場所は添えてあるときだけ。0201）
pub fn change_json(c: &PlanChange) -> Value {
    let mut v = json!({ "target": c.target, "item": c.item, "value": c.value });
    if let Some(at) = &c.at {
        v["at"] = json!(at);
    }
    if let Some(l) = &c.lever {
        v["lever"] = json!(l);
    }
    v
}

/// プランの変更の数を確かめる（多すぎれば道具の答えの文）
pub fn check_count(changes: Option<&[PlanChange]>) -> Result<(), String> {
    match changes {
        Some(c) if c.len() > MAX_PLAN_CHANGES => Err(format!(
            "plan_changes は{MAX_PLAN_CHANGES}件までにしてください。"
        )),
        _ => Ok(()),
    }
}

/// 当てはまらない変更があったときの道具の答え（変更ごとの理由つき）
pub fn rejected_message(rows: &Value) -> String {
    json!({
        "message": "plan_changes に、この世帯の動かす項目に当てはまらない変更があるため、計算していません（何も当てていません）。list_plan_items で、対象（target）・入力項目ID（item）・値の形（kind・unit）・範囲を確かめてください。",
        "planChanges": rows,
    })
    .to_string()
}

/// 本人のいない世帯（apply の Err の符号）
pub const NO_SELF: &str = "NO_SELF";
/// 画面の部品が読めない形の入力（apply の Err の符号）
pub const BAD_INPUT: &str = "BAD_INPUT";

/// apply の Err の符号の道具の答え（プランの部品の失敗でなければ None）
pub fn error_message(code: &str) -> Option<&'static str> {
    match code {
        NO_SELF => Some("この世帯には本人（members の kind が self）がいないため、プランの動かす項目を作れません。"),
        BAD_INPUT => Some("入力の形が違うため、プランの動かす項目を作れません。入力の形は get_sample_household の input を手本にしてください。"),
        _ => None,
    }
}

/// 動かせる項目の一覧の答えに添える説明
pub const LIST_NOTE: &str = "items の target・item（at か lever が添えてあれば、それも）と、kind・unit の形の value を、calculate・explain_value の plan_changes（[{target, item, value}]、場所つきは [{target, item, at, value}] か [{target, item, lever, value}]）にそのまま渡すと、アプリの画面のプランと同じ関数で当てて計算します（関係する欄も一緒に動きます）。at・lever は、同じ対象・同じ入力項目ID で場所だけが違う項目を選ぶ印で、place が人の読める区別です（FP に伝えるときは place と label を使ってください）。propose_scenario の changes にも同じ書き方で渡せます（proposable が false の項目は、プランの候補には出せません）。value は今の値、min・max は入れてよい範囲、slider は画面のスライダーの幅です。入力の数の欄から作った項目は fields: true か group で出します。";

/// プランの変更の当てはめを答えに添えるときの説明
pub const PLAN_NOTE: &str = "plan_changes は、アプリの画面の結果のタブのプランと同じ関数で当てました（関係する欄も画面と同じく一緒に動きます）。status は applied（当てた）・same（今と同じ値なので変わらない）。この変更をそのまま propose_scenario の changes に渡せます（渡された世帯のとき）。";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_args() {
        let one = PlanChange {
            target: "assumptions".into(),
            item: "assumptions.inflation".into(),
            at: None,
            lever: None,
            value: json!("0.01"),
        };
        // 場所は添えたときだけ運ぶ（前の書き方は前と同じ形）
        assert_eq!(
            change_json(&one),
            json!({ "target": "assumptions", "item": "assumptions.inflation", "value": "0.01" })
        );
        let at = PlanChange {
            at: Some(vec!["stages".into(), "x".into()]),
            ..one.clone()
        };
        assert_eq!(change_json(&at)["at"], json!(["stages", "x"]));
        let lever = PlanChange {
            lever: Some("investStopAge".into()),
            ..one.clone()
        };
        assert_eq!(change_json(&lever)["lever"], json!("investStopAge"));
        assert!(check_count(Some(&vec![one.clone(); MAX_PLAN_CHANGES])).is_ok());
        assert!(check_count(Some(&vec![one; MAX_PLAN_CHANGES + 1])).is_err());
        assert_eq!(
            args_json(Some("x"), Some("対策"), true, &Value::Null),
            json!({ "sampleId": "x", "group": "対策", "fields": true })
        );
        assert_eq!(args_json(None, None, false, &Value::Null), json!({}));
        assert_eq!(
            args_json(None, None, false, &json!({})),
            json!({ "postRetirement": {} })
        );
    }
}
