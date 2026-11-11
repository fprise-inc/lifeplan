//! 正の計算（0005 の2・3）: 埋め込んだエンジンを quickjs-ng のバイトコードにし、計算の要求ごとに新しい実行環境で計算する。
//!
//! いまは本体のプロセスの中のスレッドで計算する。0005 の4 の「別の計算プロセスで動かし、期限を過ぎたらプロセスごと終了させる」は
//! 次の回（計算プロセスの起動の時間を測ってから。0005 の未確定）。上限（メモリ・時間・スタック）は engine-host の値を使う。

use std::sync::OnceLock;
use std::time::Instant;

use engine_host::{check_packs, compile_engine, EngineBytecode, HostError, Limits, Sandbox};
use serde::Deserialize;

mod assets {
    include!(concat!(env!("OUT_DIR"), "/assets.rs"));
}

/// 枠（案×想定）1つの計算の要求。`request` はエンジンへの要求の JSON の文字列のまま受ける（キーの順番を変えない）
#[derive(Debug, Deserialize)]
pub struct SlotRequest {
    pub id: String,
    pub rev: u64,
    pub request: String,
}

struct Ready {
    bytecode: EngineBytecode,
    /// 計算の options（表示の形・検査済みのパックの指紋）
    preview_options: String,
    full_options: String,
}

static PACKS_JSON: OnceLock<String> = OnceLock::new();
static READY: OnceLock<Result<Ready, String>> = OnceLock::new();

pub fn packs_json() -> &'static str {
    PACKS_JSON.get_or_init(|| format!("[{}]", assets::PACKS.join(",")))
}

pub fn household_ids() -> Vec<&'static str> {
    assets::HOUSEHOLDS.iter().map(|(id, _)| *id).collect()
}

pub fn household(id: &str) -> Option<&'static str> {
    assets::HOUSEHOLDS
        .iter()
        .find(|(i, _)| *i == id)
        .map(|(_, json)| *json)
}

fn init() -> Result<Ready, String> {
    let bytecode = compile_engine(assets::ENGINE_JS).map_err(|e| e.code().to_owned())?;
    // 0005・0017 の追記: パックの形は読み込んだときに1回だけ確かめ、計算ではその指紋を渡す
    // （署名の確認は配布・更新の回で足す。いまのパックはアプリに埋め込んだもの）
    let digests = check_packs(&bytecode, packs_json()).map_err(|e| e.code().to_owned())?;
    let checked: serde_json::Value = serde_json::from_str(&digests).map_err(|e| e.to_string())?;
    let preview_options =
        serde_json::json!({ "preview": true, "packsChecked": checked }).to_string();
    let full_options = serde_json::json!({ "packsChecked": checked }).to_string();
    Ok(Ready {
        bytecode,
        preview_options,
        full_options,
    })
}

fn ready() -> Result<&'static Ready, String> {
    READY.get_or_init(init).as_ref().map_err(Clone::clone)
}

/// 起動のときに裏で呼ぶ（バイトコードを作り、パックを確かめておく）
pub fn warm_up() {
    let _ = ready();
}

/// 外に出してよいエラーの形（値を含まない。0005 の8・追記）
fn host_error_json(e: &HostError) -> String {
    serde_json::json!({ "error": { "code": e.code(), "ids": [] } }).to_string()
}

/// 1件を表示の形（見出し・表・要約）で計算する。runBatch に1件だけ渡す（結果は run と同じ。0005 の追記）
fn run_preview(ready: &Ready, request: &str) -> Result<String, HostError> {
    let sandbox = Sandbox::new(&Limits::DEFAULT)?;
    sandbox.load_engine_bytecode(&ready.bytecode)?;
    let out = sandbox.run_batch(
        &format!("[{request}]"),
        packs_json(),
        &ready.preview_options,
    )?;
    // 要求の配列の形のエラー（{"error": …}）か、結果1件の配列
    if out.starts_with('[') && out.ends_with(']') {
        Ok(out[1..out.len() - 1].to_owned())
    } else {
        Ok(out)
    }
}

fn threads() -> usize {
    // 0005 の7: 論理コア数−1（最低1、最大8）
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1))
        .unwrap_or(1)
        .clamp(1, 8)
}

/// 枠ごとの正の計算。戻り値は {"ms": 全体, "slots": {"<枠ID>": {"rev", "ms", "result"}}}（result はエンジンの出力か {"error"}）
pub fn compute(slots: &[SlotRequest]) -> Result<String, String> {
    let ready = ready()?;
    let started = Instant::now();
    let mut outputs: Vec<(usize, String, f64)> = Vec::with_capacity(slots.len());
    for chunk in slots
        .iter()
        .enumerate()
        .collect::<Vec<_>>()
        .chunks(threads())
    {
        std::thread::scope(|s| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(i, slot)| {
                    let i = *i;
                    s.spawn(move || {
                        let t = Instant::now();
                        let out = run_preview(ready, &slot.request)
                            .unwrap_or_else(|e| host_error_json(&e));
                        (i, out, t.elapsed().as_secs_f64() * 1000.0)
                    })
                })
                .collect();
            for h in handles {
                match h.join() {
                    Ok(r) => outputs.push(r),
                    Err(_) => outputs.push((
                        usize::MAX,
                        host_error_json(&HostError::Setup("thread".into())),
                        0.0,
                    )),
                }
            }
        });
    }
    let mut parts = Vec::with_capacity(slots.len());
    for (i, out, ms) in outputs {
        let Some(slot) = slots.get(i) else {
            return Err("E_HOST_THREAD".to_owned());
        };
        parts.push(format!(
            "{}:{{\"rev\":{},\"ms\":{:.1},\"result\":{}}}",
            serde_json::to_string(&slot.id).map_err(|e| e.to_string())?,
            slot.rev,
            ms,
            out
        ));
    }
    Ok(format!(
        "{{\"ms\":{:.1},\"slots\":{{{}}}}}",
        started.elapsed().as_secs_f64() * 1000.0,
        parts.join(",")
    ))
}

/// 計算の入力を、画面と同じ計算エンジンで確かめる（AIの新しい世帯の候補を受けるとき）。計算できなければ AI に見せてよい理由
/// （エンジンの失敗のコードだけ。値は入れない）
pub fn check_input(input: &serde_json::Value) -> Result<(), String> {
    let ready = ready()?;
    let request = serde_json::json!({ "trace": "none", "input": input }).to_string();
    let out = run_preview(ready, &request).unwrap_or_else(|e| host_error_json(&e));
    let v: serde_json::Value = serde_json::from_str(&out)
        .map_err(|_| "計算エンジンの答えを読めませんでした".to_owned())?;
    match v.get("error") {
        None => Ok(()),
        Some(e) => Err(format!(
            "アプリの計算エンジンで計算できない入力なので、受け取りませんでした（{}）。calculate で確かめてから出し直してください。",
            e["code"].as_str().unwrap_or("E_ENGINE")
        )),
    }
}

/// 根拠の記録「全部」での計算（0006 の7）。戻り値はエンジンの出力全体か {"error"}
pub fn evidence(request: &str) -> Result<String, String> {
    let ready = ready()?;
    let run = || -> Result<String, HostError> {
        let sandbox = Sandbox::new(&Limits::FULL_TRACE)?;
        sandbox.load_engine_bytecode(&ready.bytecode)?;
        sandbox.run(request, packs_json(), &ready.full_options)
    };
    Ok(run().unwrap_or_else(|e| host_error_json(&e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str) -> String {
        household(id).expect("モデル世帯").to_owned()
    }

    #[test]
    fn computes_model_household_in_parallel_slots() {
        let req = request("salariedCoupleTwoKids");
        let slots = vec![
            SlotRequest {
                id: "current".into(),
                rev: 1,
                request: req.clone(),
            },
            SlotRequest {
                id: "proposal".into(),
                rev: 3,
                request: req,
            },
        ];
        let out = compute(&slots).expect("計算");
        let v: serde_json::Value = serde_json::from_str(&out).expect("JSON");
        let a = &v["slots"]["current"];
        let b = &v["slots"]["proposal"];
        assert_eq!(a["rev"], 1);
        assert_eq!(b["rev"], 3);
        assert!(a["result"]["table"].is_array(), "{a}");
        // 同じ要求なら同じ結果（実行環境は別々）
        assert_eq!(a["result"], b["result"]);
        // 表示の形: お金の動きと根拠の記録は返さない
        assert!(a["result"].get("flows").is_none());
    }

    /// 0111: 事務所の推定の値（計算の要求の estimateValues）は本体の正の計算にも効き、制度データの値は置き換えられない
    #[test]
    fn office_estimate_values_reach_the_canonical_calc() {
        let base: serde_json::Value = serde_json::from_str(&request("parentCare")).unwrap();
        let with = |values: serde_json::Value| {
            let mut r = base.clone();
            r["input"]["estimateValues"] = values;
            SlotRequest {
                id: "s".into(),
                rev: 1,
                request: r.to_string(),
            }
        };
        let care = |out: &str| -> i64 {
            let v: serde_json::Value = serde_json::from_str(out).unwrap();
            v["slots"]["s"]["result"]["table"]
                .as_array()
                .expect("表")
                .iter()
                .filter(|c| {
                    c["row"]
                        .as_str()
                        .is_some_and(|r| r.starts_with("cf.expense.care"))
                })
                .map(|c| c["amount"].as_i64().unwrap_or(0))
                .sum()
        };
        let plain = compute(&[with(serde_json::json!({}))]).expect("計算");
        let office =
            compute(&[with(serde_json::json!({ "care.statistics.months": 120 }))]).expect("計算");
        assert!(care(&office) > care(&plain));
        let legal =
            compute(&[with(serde_json::json!({ "incomeTax.basicDeduction": 0 }))]).expect("計算");
        let v: serde_json::Value = serde_json::from_str(&legal).unwrap();
        assert_eq!(v["slots"]["s"]["result"]["error"]["code"], "E_ARGUMENT");
    }

    /// 0111 の2回目: 推定で埋めない目安（estimateNoFill）と、エンジンが引く目安の値ID（preset.*）は本体の正の計算にも効く。
    /// 一覧に無い preset の値ID は置き換えられない
    #[test]
    fn office_presets_and_no_fill_reach_the_canonical_calc() {
        let base: serde_json::Value = serde_json::from_str(&request("parentCare")).unwrap();
        let with = |key: &str, value: serde_json::Value| {
            let mut r = base.clone();
            r["input"][key] = value;
            SlotRequest {
                id: "s".into(),
                rev: 1,
                request: r.to_string(),
            }
        };
        let care = |out: &str| -> i64 {
            let v: serde_json::Value = serde_json::from_str(out).unwrap();
            v["slots"]["s"]["result"]["table"]
                .as_array()
                .expect("表")
                .iter()
                .filter(|c| {
                    c["row"]
                        .as_str()
                        .is_some_and(|r| r.starts_with("cf.expense.care"))
                })
                .map(|c| c["amount"].as_i64().unwrap_or(0))
                .sum()
        };
        let plain = compute(&[with("estimateNoFill", serde_json::json!([]))]).expect("計算");
        let unfilled =
            compute(&[with("estimateNoFill", serde_json::json!(["care"]))]).expect("計算");
        assert!(care(&unfilled) < care(&plain));
        let known = compute(&[with(
            "estimateValues",
            serde_json::json!({ "preset.realEstate.landShare": "0.5" }),
        )])
        .expect("計算");
        let v: serde_json::Value = serde_json::from_str(&known).unwrap();
        assert!(v["slots"]["s"]["result"]["error"].is_null());
        let unknown = compute(&[with(
            "estimateValues",
            serde_json::json!({ "preset.housing.rent": 90000 }),
        )])
        .expect("計算");
        let v: serde_json::Value = serde_json::from_str(&unknown).unwrap();
        assert_eq!(v["slots"]["s"]["result"]["error"]["code"], "E_ARGUMENT");
    }

    #[test]
    fn engine_errors_come_back_as_ids_only() {
        let slots = vec![SlotRequest {
            id: "x".into(),
            rev: 1,
            request: "{\"input\":{}}".into(),
        }];
        let out = compute(&slots).expect("計算");
        let v: serde_json::Value = serde_json::from_str(&out).expect("JSON");
        assert!(v["slots"]["x"]["result"]["error"]["code"].is_string());
    }

    #[test]
    fn evidence_returns_full_trace() {
        let mut req: serde_json::Value =
            serde_json::from_str(&request("salariedCoupleTwoKids")).unwrap();
        req["trace"] = "full".into();
        let out = evidence(&req.to_string()).expect("計算");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v["trace"]["nodes"].is_array());
        assert_eq!(
            v["trace"]["flows"].as_array().map(Vec::len),
            v["flows"].as_array().map(Vec::len)
        );
    }

    /// 速さの目安（`cargo test --release -- --ignored --nocapture timing`）: 1枠の正の計算と、根拠の記録「全部」
    #[test]
    #[ignore]
    fn timing() {
        warm_up();
        let req = request("salariedCoupleTwoKids");
        let mut one = Vec::new();
        let mut two = Vec::new();
        let mut ev = Vec::new();
        for i in 0..7 {
            let slots = vec![SlotRequest {
                id: "p".into(),
                rev: i,
                request: req.clone(),
            }];
            let t = Instant::now();
            compute(&slots).unwrap();
            one.push(t.elapsed().as_secs_f64() * 1000.0);
            let slots2 = vec![
                SlotRequest {
                    id: "c".into(),
                    rev: i,
                    request: req.clone(),
                },
                SlotRequest {
                    id: "p".into(),
                    rev: i,
                    request: req.clone(),
                },
            ];
            let t = Instant::now();
            compute(&slots2).unwrap();
            two.push(t.elapsed().as_secs_f64() * 1000.0);
            let mut full: serde_json::Value = serde_json::from_str(&req).unwrap();
            full["trace"] = "full".into();
            let t = Instant::now();
            evidence(&full.to_string()).unwrap();
            ev.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        let med = |v: &mut Vec<f64>| {
            v.sort_by(f64::total_cmp);
            v[v.len() / 2]
        };
        println!(
            "1枠 {:.0}ms / 2枠（同時） {:.0}ms / 根拠の記録「全部」 {:.0}ms（中央値）",
            med(&mut one),
            med(&mut two),
            med(&mut ev)
        );
    }
}
