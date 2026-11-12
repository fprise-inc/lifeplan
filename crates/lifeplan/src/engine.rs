//! 計算（0005）: アプリ本体と同じ quickjs-ng（engine-host）で、同じ engine.js を、計算ごとに新しい実行環境で動かす。

use engine_host::{check_packs, compile_engine, EngineBytecode, Limits, Sandbox};
use serde_json::Value;
use std::sync::OnceLock;

pub mod assets {
    include!(concat!(env!("OUT_DIR"), "/assets.rs"));
}

struct Ready {
    bytecode: EngineBytecode,
    preview_options: String,
    /// 根拠の記録「全部」の計算の options（表示の形にしない。アプリ本体の根拠の計算と同じ）
    full_options: String,
}

static PACKS_JSON: OnceLock<String> = OnceLock::new();
static READY: OnceLock<Result<Ready, String>> = OnceLock::new();

pub fn packs_json() -> &'static str {
    PACKS_JSON.get_or_init(|| format!("[{}]", assets::PACKS.join(",")))
}

fn init() -> Result<Ready, String> {
    let bytecode = compile_engine(assets::ENGINE_JS).map_err(|e| e.code().to_owned())?;
    let digests = check_packs(&bytecode, packs_json()).map_err(|e| e.code().to_owned())?;
    let checked: Value = serde_json::from_str(&digests).map_err(|e| e.to_string())?;
    let preview_options =
        serde_json::json!({ "preview": true, "packsChecked": checked }).to_string();
    let full_options = serde_json::json!({ "packsChecked": checked }).to_string();
    Ok(Ready {
        bytecode,
        preview_options,
        full_options,
    })
}

/// 表示の形（見出し・表・要約）で計算する（重いので、呼ぶ側は spawn_blocking の中で）。
/// 戻り値はエンジンの出力1件か、エンジン・ホストのエラー（`{"error": {"code", "ids"}}`）
pub fn run_preview(request: &Value) -> Result<Value, String> {
    let ready = READY.get_or_init(init).as_ref().map_err(Clone::clone)?;
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.load_engine_bytecode(&ready.bytecode)?;
        sandbox.run_batch(
            &format!("[{request}]"),
            packs_json(),
            &ready.preview_options,
        )
    };
    let out = match run() {
        Ok(s) => s,
        Err(e) => return Ok(serde_json::json!({ "error": { "code": e.code(), "ids": [] } })),
    };
    let v: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    Ok(match v {
        Value::Array(mut a) if a.len() == 1 => a.remove(0),
        other => other,
    })
}

/// 根拠の記録「全部」（要求の trace は full）で計算し、エンジンの出力全体を文字のまま返す（アプリ本体の根拠の計算と同じ上限と options。0006 の7）。
/// 重いので、呼ぶ側は spawn_blocking の中で。エンジン・ホストのエラーは `{"error": {"code", "ids"}}`
pub fn run_full(request: &Value) -> Result<String, String> {
    let ready = READY.get_or_init(init).as_ref().map_err(Clone::clone)?;
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::FULL_TRACE)?;
        sandbox.load_engine_bytecode(&ready.bytecode)?;
        sandbox.run(&request.to_string(), packs_json(), &ready.full_options)
    };
    Ok(run().unwrap_or_else(|e| {
        serde_json::json!({ "error": { "code": e.code(), "ids": [] } }).to_string()
    }))
}

/// 「数字の根拠」の読み方（画面の根拠のパネルと同じ関数。app/src/connector/explain.ts。0183）を、計算と同じ固めた新しい実行環境で動かす。
/// request は計算の前の処理（prepare）を当てる前の要求（画面の根拠のパネルと同じ）
/// full は run_full の出力、request は計算の要求、args は行・年など。戻り値は読み方の答え（JSON の文字）
pub fn explain(full: &str, request: &str, args: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::FULL_TRACE)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "explain", (full, request, args))
    };
    run().map_err(|e| e.code().to_owned())
}

/// 計算の前の処理（画面がエンジンへ渡す前に当てる処理と同じ関数。app/src/connector/prepare.ts。0184）を、計算と同じ固めた新しい実行環境で動かす。
/// request は計算の要求、office は事務所データの defaults.estimates（無ければ null）。戻り値は `{ request, applied }` の JSON の文字
pub fn prepare(request: &str, office: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "prepare", (request, office, ""))
    };
    run().map_err(|e| e.code().to_owned())
}

/// 計算の答えの主な数字と家族の年齢（画面の「プランを比較」の数え方と表の年齢の行と同じ関数。app/src/connector/summary.ts。0194）を、
/// 計算と同じ固めた新しい実行環境で動かす。preview は表示の形の計算の出力、request は計算の前の処理を当てる前の要求（数字の根拠と同じ）、
/// args は年齢など。戻り値は JSON の文字
pub fn summarize(preview: &str, request: &str, args: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "summarize", (preview, request, args))
    };
    run().map_err(|e| e.code().to_owned())
}

/// プランの動かす項目（画面の結果のタブのプランと同じ関数。app/src/connector/plan.ts。0195）の1つの関数を、計算と同じ固めた新しい実行環境で動かす。
/// 入力の欄の定義まで読む大きな JS なので、プランを当てるとき・動かせる項目の一覧を返すときだけ読み込む。戻り値は答え（JSON の文字）
pub fn plan(function: &str, a: &str, b: &str, c: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::PLAN_JS)?;
        sandbox.call_function("FinanciaPlan", function, (a, b, c))
    };
    run().map_err(|e| e.code().to_owned())
}

/// 比較した答えのグラフ（画面のグラフと同じ座標・色の SVG。app/src/connector/chart.ts。0203）を、計算と同じ固めた新しい実行環境で作る。
/// args は通りの名前と数字（chart.rs が compare の答えから作る）。戻り値は JSON の文字（status・svg・title・alt・width・height）
pub fn chart(args: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "chart", (args, "", ""))
    };
    run().map_err(|e| e.code().to_owned())
}

/// 年ごとの表（CSV・Markdown の文。画面の表と同じ年・年齢・数え方。app/src/connector/table.ts。0209）を、計算と同じ固めた新しい実行環境で作る。
/// args は通りごとの名前・要求・表（table.rs が compare と同じ道で計算した答えから作る）。戻り値は JSON の文字（status・text・layout・rows・years・notes）
pub fn table(args: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "table", (args, "", ""))
    };
    run().map_err(|e| e.code().to_owned())
}

/// 年金の見込みの写しの要求（画面の比較の表の年金の行と同じ。app/src/connector/summary.ts の pensionRequests。0199）を、
/// 計算と同じ固めた新しい実行環境で作る。request は計算の前の処理を当てる前の要求。戻り値は `{ std, claimed }` の JSON の文字
pub fn pension_requests(request: &str) -> Result<String, String> {
    let run = || -> Result<String, engine_host::HostError> {
        let sandbox = Sandbox::new(&Limits::DEFAULT)?;
        sandbox.eval_script(assets::EXPLAIN_JS)?;
        sandbox.call_function("FinanciaExplain", "pensionRequests", (request, "", ""))
    };
    run().map_err(|e| e.code().to_owned())
}
