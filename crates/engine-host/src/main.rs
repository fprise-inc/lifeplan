//! JSON を受けて JSON を返す小さなコマンド。
//! 使い方: engine-host --engine <dist/engine.qbc か dist/engine.js> [--pack <パックの JSON>]... [--check-internal] [--packs-checked] [--batch [--preview]] [--debug] < 要求.json
//!         engine-host --compile dist/engine.js --out dist/engine.qbc（まとめた JS をバイトコードにする。0005 の1）
//! --engine が .qbc ならバイトコードから読み込む（製品の形）。--packs-checked は、パックの形を先に1回だけ確かめ、計算ではその指紋を渡す（0005・0017 の追記）
//! --batch のときは、標準入力を要求の配列として runBatch で計算し、結果の配列を出す（--preview は表示の先出しの形）
//! 計算結果は標準出力に出す。失敗は ID だけの JSON を標準エラーに出し、終了コード 1（エンジンのエラー）か 2（ホストのエラー）
use std::io::Read;
use std::process::ExitCode;

use engine_host::{
    check_packs, compile_engine, trace_mode, EngineBytecode, HostError, Limits, Sandbox,
};

fn usage() -> ExitCode {
    eprintln!("usage: engine-host --engine <engine.qbc|engine.js> [--pack <pack.json>]... [--check-internal] [--packs-checked] [--batch [--preview]] [--debug] < request.json");
    eprintln!("       engine-host --compile <engine.js> --out <engine.qbc>");
    ExitCode::from(2)
}

/// エンジンの読み込み方（バイトコードかソース）
enum Engine {
    Bytecode(EngineBytecode),
    Source(String),
}

impl Engine {
    fn sandbox(&self, limits: &Limits) -> Result<Sandbox, HostError> {
        let s = Sandbox::new(limits)?;
        match self {
            Engine::Bytecode(b) => s.load_engine_bytecode(b)?,
            Engine::Source(js) => s.load_engine(js)?,
        }
        Ok(s)
    }
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
    let mut batch = false;
    let mut preview = false;
    let mut packs_checked = false;
    let mut compile: Option<String> = None;
    let mut out: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--engine" => engine_path = args.next(),
            "--pack" => match args.next() {
                Some(p) => packs.push(p),
                None => return usage(),
            },
            "--check-internal" => check_internal = true,
            "--batch" => batch = true,
            "--preview" => preview = true,
            "--packs-checked" => packs_checked = true,
            "--compile" => compile = args.next(),
            "--out" => out = args.next(),
            "--debug" => debug = true,
            _ => return usage(),
        }
    }
    if let Some(src) = compile {
        let Some(out) = out else {
            return usage();
        };
        let result = std::fs::read_to_string(&src)
            .map_err(|e| HostError::Setup(e.to_string()))
            .and_then(|js| compile_engine(&js))
            .and_then(|b| {
                std::fs::write(&out, b.to_bytes()).map_err(|e| HostError::Setup(e.to_string()))
            });
        return match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => host_error(&e, debug),
        };
    }
    let Some(engine_path) = engine_path else {
        return usage();
    };
    let engine = if engine_path.ends_with(".qbc") {
        match std::fs::read(&engine_path)
            .map_err(|e| HostError::Setup(e.to_string()))
            .and_then(|b| EngineBytecode::from_trusted_bytes(&b))
        {
            Ok(b) => Engine::Bytecode(b),
            Err(e) => return host_error(&e, debug),
        }
    } else {
        match std::fs::read_to_string(&engine_path) {
            Ok(s) => Engine::Source(s),
            Err(e) => return host_error(&HostError::Setup(e.to_string()), debug),
        }
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
    // パックの形は先に1回だけ確かめ、計算ではその指紋を渡す（--packs-checked。バイトコードのときだけ）
    let mut checked = serde_json::Value::Null;
    if packs_checked {
        let Engine::Bytecode(b) = &engine else {
            return usage();
        };
        match check_packs(b, &packs_json).and_then(|d| {
            serde_json::from_str::<serde_json::Value>(&d)
                .map_err(|e| HostError::Setup(e.to_string()))
        }) {
            Ok(d) => checked = d,
            Err(e) => return host_error(&e, debug),
        }
    }
    let mut opts = serde_json::json!({ "checkInternal": check_internal, "preview": preview });
    if !checked.is_null() {
        opts["packsChecked"] = checked;
    }
    let options = opts.to_string();
    // 内部の検査（--check-internal。CI とテストだけ）は公式部品の入出力のスキーマの検査と凍結を足すので、
    // 時間の上限を3倍にする（製品の上限（0005 の4）は変えない）
    let widen = |l: Limits| {
        if check_internal {
            Limits {
                time: l.time.saturating_mul(3),
                ..l
            }
        } else {
            l
        }
    };
    let result = if batch {
        // まとめて計算: 根拠の記録「全部」の要求があれば、その上限を使う
        let list = serde_json::from_str::<Vec<serde_json::Value>>(&request).unwrap_or_default();
        let full = list
            .iter()
            .any(|r| r.get("trace").and_then(|t| t.as_str()) == Some("full"));
        let limits = widen(Limits::for_batch(list.len(), full));
        engine
            .sandbox(&limits)
            .and_then(|s| s.run_batch(&request, &packs_json, &options))
    } else {
        let limits = widen(Limits::for_trace(&trace_mode(&request)));
        engine
            .sandbox(&limits)
            .and_then(|s| s.run(&request, &packs_json, &options))
    };
    match result {
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
