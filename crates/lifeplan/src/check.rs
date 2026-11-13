//! 入力の確かめ（check_inputs。0210）: 世帯かプランを、画面の入力のタブの確かめの一覧と同じ関数（app/src/connector/check.ts を同梱した JS）で見て、
//! 「お客さまに聞くこと」の一覧を返す（推定・既定の値で埋めた所・入っていなさそうな所・範囲の外の値・入力で直せる計算のお知らせ）。
//!
//! 接続口の側には、行の選び方も聞く文も書かない（画面の関数と、同梱した決まりの表に任せ、答えを運ぶだけ）。世帯の物の ID は返さない。
//! 計算は calculate と同じ道（プランの変更 → 計算の前の処理 → 計算）で、計算のお知らせを作るためにだけ使う。

use crate::calc::Change;
use crate::engine;
use crate::plan::PlanChange;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

/// 返す行の上限の既定（JS の DEFAULT_MAX と同じ）
pub const DEFAULT_MAX_ITEMS: u16 = 30;
/// 返す行の上限の上限
pub const MAX_ITEMS: u16 = 100;

/// 選べる種類（画面の確かめの一覧の種類。checkRows.ts の KIND_ORDER と同じ並び）
pub const KINDS: &[&str] = &[
    "missing",
    "notStarted",
    "unknown",
    "notice",
    "calc",
    "estimated",
    "certainty",
    "premise",
];

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CheckInputsArgs {
    /// 見本の世帯の ID（list_sample_households）。sample_household_id・share_id・input のどれか1つを指定する
    pub sample_household_id: Option<String>,
    /// FPが渡した世帯の共有 ID（list_shared_households）。アプリが起動していて、共有が期限内のときだけ使える。読むとアプリの「AIに渡した記録」に残る
    pub share_id: Option<String>,
    /// AIが組み立てた計算の入力（calculate の input と同じ形）
    pub input: Option<Value>,
    /// プランを確かめるとき: 入力に当てる変更（calculate の changes と同じ JSON Patch）
    pub changes: Option<Vec<Change>>,
    /// プランを確かめるとき: アプリの画面のプランの動かす項目の変更（calculate の plan_changes と同じ書き方。list_plan_items で分かる）。50件まで
    pub plan_changes: Option<Vec<PlanChange>>,
    /// 出す種類（既定は missing・notStarted・unknown・notice・calc・estimated。画面の確かめの一覧の既定と同じ）。missing＝未入力（0円で計算中）・
    /// notStarted＝まだ入れていない項目・unknown＝書類待ち・notice＝確かめの注意（範囲の外の値・ほかの入力と合わない値・購入の払い方が無いなど）・
    /// calc＝計算のお知らせのうち入力で直せる所・estimated＝推定（結果に効く順）・certainty＝確かさが本人の申告・概算の値・premise＝前提条件の標準の値
    #[schemars(extend("items" = { "type": "string", "enum": ["missing", "notStarted", "unknown", "notice", "calc", "estimated", "certainty", "premise"] }))]
    pub kinds: Option<Vec<String>>,
    /// 返す行の上限（1〜100。既定 30）。並びは画面の確かめの一覧と同じで、超えた分は truncated と counts で分かる
    #[schemars(range(min = 1, max = 100))]
    pub max_items: Option<u16>,
}

/// 引数を確かめ、JS に渡す選び方（kinds・max）を作る。誤りは道具の答えの文
pub fn options(a: &CheckInputsArgs) -> Result<Value, String> {
    let max = a.max_items.unwrap_or(DEFAULT_MAX_ITEMS);
    if !(1..=MAX_ITEMS).contains(&max) {
        return Err(format!("max_items は 1〜{MAX_ITEMS} にしてください。"));
    }
    let kinds = a.kinds.clone().unwrap_or_default();
    let bad: Vec<&String> = kinds
        .iter()
        .filter(|k| !KINDS.contains(&k.as_str()))
        .collect();
    if !bad.is_empty() {
        return Err(format!(
            "kinds に選べるのは {} です（{}）。",
            KINDS.join("・"),
            bad.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join("・")
        ));
    }
    let mut o = json!({ "max": max });
    if !kinds.is_empty() {
        o["kinds"] = json!(kinds);
    }
    Ok(o)
}

/// 画面の確かめの一覧に、聞くことを添える（重いので、呼ぶ側は spawn_blocking の中で）。request は計算の要求（プランの変更を当てた後・
/// 計算の前の処理を当てる前）、preview はその計算の表示の形の出力（計算のお知らせを作る）、chosen は [`options`] の答え、
/// sample は見本の世帯の ID、post は渡された世帯の定年後の働き方の条件（null なら渡さない）、office は事務所の推定の値。戻り値は JS の答え
pub fn run(
    request: &Value,
    preview: &Value,
    chosen: &Value,
    sample: Option<&str>,
    office: &Value,
    post: &Value,
) -> Result<Value, String> {
    let mut args = chosen.clone();
    if let Some(s) = sample {
        args["sampleId"] = json!(s);
    }
    if !post.is_null() {
        args["postRetirement"] = post.clone();
    }
    let ctx = json!({ "args": args, "office": office });
    let out = engine::plan(
        "checkInputs",
        &request.to_string(),
        &preview.to_string(),
        &ctx.to_string(),
    )?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 答えに添える説明
pub const NOTE: &str = "アプリの入力のタブの「確かめの一覧」と同じ行（並びも同じ）に、お客さまに聞くことの案（question）と短い理由（reason）を添えた物です。groups は種類ごと（未入力〔0円で計算中〕・まだ入れていない項目・書類待ち・確かめの注意・計算のお知らせ〔入力で直せる所〕・推定）で、item は入力項目、field は欄か物の見出しです。question は FP がお客さまに聞く文の案なので、面談の前に FP が確かめ、要らない物は外してください。rule が無い行は、種類ごとの決まりの文です。お客さまの名前・ID は入れていません。";

#[cfg(test)]
mod tests {
    use super::*;

    fn args(kinds: Option<Vec<&str>>, max: Option<u16>) -> CheckInputsArgs {
        CheckInputsArgs {
            sample_household_id: None,
            share_id: None,
            input: None,
            changes: None,
            plan_changes: None,
            kinds: kinds.map(|k| k.into_iter().map(str::to_owned).collect()),
            max_items: max,
        }
    }

    #[test]
    fn chooses_kinds_and_max() {
        assert_eq!(options(&args(None, None)).unwrap(), json!({ "max": 30 }));
        assert_eq!(
            options(&args(Some(vec!["estimated", "premise"]), Some(5))).unwrap(),
            json!({ "max": 5, "kinds": ["estimated", "premise"] })
        );
        assert!(options(&args(None, Some(0))).is_err());
        assert!(options(&args(None, Some(101))).is_err());
        let e = options(&args(Some(vec!["nope"]), None)).unwrap_err();
        assert!(e.contains("nope") && e.contains("estimated"), "{e}");
    }
}
