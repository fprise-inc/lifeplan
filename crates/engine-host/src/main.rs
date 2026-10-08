//! JSON を受けて JSON を返す小さなコマンド。
//! 使い方: engine-host --engine dist/engine.js [--pack <パックの JSON>]... [--check-internal] [--debug] < 要求.json
//! 計算結果は標準出力に出す。失敗は ID だけの JSON を標準エラーに出し、終了コード 1（エンジンのエラー）か 2（ホストのエラー）
use std::io::Read;
use std::process::ExitCode;

use engine_host::{run_engine, trace_mode, HostError, Limits};

fn usage() -> ExitCode {
    eprintln!("usage: engine-host --engine <engine.js> [--pack <pack.json>]... [--check-internal] [--debug] < request.json");
    ExitCode::from(2)
}

fn host_error(e: &HostError, debug: bool) -> ExitCode {
    // 0005 の8: 外に出すのは符号だけ。中身は --debug のときだけ
    if debug {
        eprintln!("{e:?}");
    }
    eprintln!(
        "{}",
        serde_json::json!({ "error": { "code": e.code(), "ids": [] } })
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let mut engine_path: Option<String> = None;
    let mut packs: Vec<String> = Vec::new();
    let mut check_internal = false;
    let mut debug = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--engine" => engine_path = args.next(),
            "--pack" => match args.next() {
                Some(p) => packs.push(p),
                None => return usage(),
            },
            "--check-internal" => check_internal = true,
            "--debug" => debug = true,
            _ => return usage(),
        }
    }
    let Some(engine_path) = engine_path else {
        return usage();
    };
    let engine_js = match std::fs::read_to_string(&engine_path) {
        Ok(s) => s,
        Err(e) => return host_error(&HostError::Setup(e.to_string()), debug),
    };
    let mut pack_texts = Vec::new();
    for p in &packs {
        match std::fs::read_to_string(p) {
            Ok(s) => pack_texts.push(s.trim().to_owned()),
            Err(e) => return host_error(&HostError::Setup(e.to_string()), debug),
        }
    }
    let packs_json = format!("[{}]", pack_texts.join(","));
    let mut request = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut request) {
        return host_error(&HostError::Setup(e.to_string()), debug);
    }
    let options = serde_json::json!({ "checkInternal": check_internal }).to_string();
    let limits = Limits::for_trace(&trace_mode(&request));
    match run_engine(&engine_js, &request, &packs_json, &options, &limits) {
        Ok(out) => {
            let is_error = out.starts_with("{\"error\":");
            if is_error {
                eprintln!("{out}");
                ExitCode::from(1)
            } else {
                println!("{out}");
                ExitCode::SUCCESS
            }
        }
        Err(e) => host_error(&e, debug),
    }
}
