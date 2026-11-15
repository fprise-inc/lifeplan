//! 表示の設定（`get_display_settings`。0213）: 画面の見せ方だけを変える設定の一覧（id・画面と同じ名前・効く所・変える所・値の形・選べる値・既定）と、
//! アプリが起動していれば事務所の既定値の今の値、渡された世帯があればその世帯の今の値を返す（読むだけ）。
//!
//! - 一覧はアプリの画面の定数から作った物（app/src/connector/displayCatalog.ts。`npm run build:explain` が crates/lifeplan/dist/display-catalog.json に
//!   書き、ビルドの時に埋め込む）。アプリが起動していなくても返せる
//! - 今の値は、アプリ本体が切り出した見せ方だけの欄（事務所データの defaults の一部・世帯ファイルの本文の display など）を、画面と同じ読み方の
//!   関数（app/src/connector/display.ts。plan.js に同梱）で読む。接続口の側に読み方を書かない
//! - この接続口からは設定を変えない。変える案を承認待ちで出す道具は次の段（0213 の段B）

use crate::engine::{self, assets::DISPLAY_CATALOG_JSON};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// 変え方の案内（答えにいつも添える）
pub const CHANGE_NOTE: &str = "この接続口からは表示の設定を変えられません（読むだけ）。変えるときは、各設定の change に書いたアプリの画面と区画で、FP が変えます。変える案をアプリに承認待ちで出す道具（アプリが「今 → 案」を出し、FP が「反映する」か「捨てる」を選ぶ）は、次の段で足す予定です。";

/// アプリが起動していないときの説明
pub const NOT_RUNNING_NOTE: &str = "アプリが起動していないか、アプリの「AI接続口」がオフなので、今の値は返せません。一覧（選べる値と既定）だけを返します。今の値は、アプリを起動して AI接続口をオンにしてから、もう一度呼んでください。";

fn catalog() -> &'static Value {
    static C: OnceLock<Value> = OnceLock::new();
    C.get_or_init(|| {
        serde_json::from_str(DISPLAY_CATALOG_JSON).unwrap_or_else(|_| json!({ "settings": [] }))
    })
}

fn settings() -> &'static [Value] {
    catalog()["settings"].as_array().map_or(&[], Vec::as_slice)
}

/// 一覧の id（一覧の並び）
pub fn ids() -> Vec<&'static str> {
    settings().iter().filter_map(|s| s["id"].as_str()).collect()
}

/// アプリの事務所の既定値を読めたか
pub enum Office {
    /// アプリ本体が切り出した見せ方だけの欄（事務所データを読めなければ null）
    Running(Value),
    NotRunning,
    /// そのほかの失敗（説明）
    Failed(String),
}

/// 渡された世帯の見せ方の設定（アプリ本体の答え: shareId・alias・expiresAt・household）
pub enum Household {
    Read(Value),
    NotRunning,
}

/// 今の値を画面と同じ読み方の関数で読む（重いので、呼ぶ側は spawn_blocking の中で）。Err は実行環境の失敗のコード
pub fn current(office: Option<&Value>, household: Option<&Value>) -> Result<Value, String> {
    let o = office.map_or_else(|| "null".to_owned(), Value::to_string);
    let h = household.map_or_else(|| "null".to_owned(), Value::to_string);
    let out = engine::plan("displayCurrent", &o, &h, "")?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 答えを組み立てる。only は返す設定の id（None は全部）、now は `current` の答え（今の値を読まなかったときは None）
pub fn answer(
    only: Option<&[String]>,
    office: &Office,
    household: Option<&Household>,
    now: Option<&Value>,
) -> Value {
    let c = catalog();
    let app = match office {
        Office::Running(v) if v.is_null() => {
            json!({ "status": "running", "message": "アプリは起動していますが、事務所の既定値を読めませんでした（今の値は既定のまま見せます）。" })
        }
        Office::Running(_) => {
            json!({ "status": "running", "message": "アプリの事務所の既定値の今の値を current.office に入れています（どの世帯にも効く値）。" })
        }
        Office::NotRunning => json!({ "status": "notRunning", "message": NOT_RUNNING_NOTE }),
        Office::Failed(m) => {
            json!({ "status": "error", "message": format!("アプリから事務所の既定値を読めませんでした: {m}。一覧（選べる値と既定）だけを返します。") })
        }
    };
    let office_now = now.and_then(|n| n.get("office")).filter(|v| v.is_object());
    let household_now = now
        .and_then(|n| n.get("household"))
        .filter(|v| v.is_object());
    let list: Vec<Value> = settings()
        .iter()
        .filter(|s| only.is_none_or(|ids| ids.iter().any(|i| s["id"] == i.as_str())))
        .map(|s| {
            let mut e = s.clone();
            let id = s["id"].as_str().unwrap_or("");
            let scope = s["scope"].as_str().unwrap_or("");
            let mut cur = Map::new();
            if scope != "household" {
                if let Some(v) = office_now.and_then(|o| o.get(id)) {
                    cur.insert("office".into(), v.clone());
                }
            }
            if scope != "office" {
                if let Some(v) = household_now.and_then(|o| o.get(id)) {
                    cur.insert("household".into(), v.clone());
                }
            }
            if !cur.is_empty() {
                e["current"] = Value::Object(cur);
            }
            e
        })
        .collect();
    let mut out = json!({
        "app": app,
        "count": list.len(),
        "settings": list,
        "neverHidden": c["neverHidden"],
        "outOfScope": c["outOfScope"],
        "pending": c["pending"],
        "howToChange": CHANGE_NOTE,
    });
    match household {
        Some(Household::Read(h)) => {
            out["household"] = json!({
                "shareId": h["shareId"],
                "alias": h["alias"],
                "expiresAt": h["expiresAt"],
                "message": "渡された世帯の今の値を current.household に入れています（この世帯だけの値。世帯ファイルに残る）。",
            });
        }
        Some(Household::NotRunning) => {
            out["household"] = json!({ "status": "notRunning", "message": "アプリが起動していないので、渡された世帯の今の値は読めませんでした。" });
        }
        None => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_embedded() {
        let ids = ids();
        assert!(ids.len() >= 20, "{ids:?}");
        for id in [
            "result.levers",
            "contingency.premises",
            "input.items",
            "input.living",
            "result.metrics",
            "balance.guide",
            "features.combinedBs",
        ] {
            assert!(ids.contains(&id), "{id}");
        }
        let a = answer(None, &Office::NotRunning, None, None);
        assert_eq!(a["app"]["status"], "notRunning");
        assert_eq!(a["count"].as_u64(), Some(ids.len() as u64));
        assert!(a["settings"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s.get("current").is_none()));
    }
}
