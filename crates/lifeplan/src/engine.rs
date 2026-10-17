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
    Ok(Ready {
        bytecode,
        preview_options,
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
