//! 速さの計測（0005 の「速さの回帰」と追記の目標2）。製品と同じ形（バイトコードから読み込み、パックの形は先に1回だけ確かめ、
//! 計算ごとに新しい実行環境）で、quickjs-ng の正の計算の時間を測る。
//! 使い方: engine-bench --engine dist/engine.js --packs packs.json --requests requests.json [--protection protection.json] [--repeat N] [--threads T]
//! requests.json は要求の JSON の配列（5案×4想定の20件。案ごとに4件）。protection.json は必要保障額の推移（夫婦2人。0005 の追記 2026-10-09）を
//! 求める要求1件（あれば protection として1件の正の計算の時間を測る）。結果は JSON（ミリ秒の中央値と最小値）を標準出力に出す
use std::time::Instant;

use engine_host::{
    check_packs, compile_engine, run_engine_bytecode, trace_mode, EngineBytecode, Limits, Sandbox,
};

fn median(xs: &mut [f64]) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs[xs.len() / 2]
}

fn stats(mut xs: Vec<f64>) -> serde_json::Value {
    let min = xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let med = median(&mut xs);
    serde_json::json!({ "median": (med * 10.0).round() / 10.0, "min": (min * 10.0).round() / 10.0 })
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

struct Bench {
    engine: EngineBytecode,
    packs: String,
    options: String,
}

impl Bench {
    /// 1件: 新しい実行環境 → 固める → エンジンをバイトコードから読み込む → 計算 → 捨てる
    fn one(&self, request: &str) {
        let limits = Limits::for_trace(&trace_mode(request));
        let out = run_engine_bytecode(&self.engine, request, &self.packs, &self.options, &limits)
            .expect("run");
        assert!(
            !out.starts_with("{\"error\":"),
            "{}",
            &out[..out.len().min(300)]
        );
    }

    /// まとめて計算（1つの実行環境で runBatch。要求のあいだで結果を使い回す）
    fn batch(&self, requests: &[String]) {
        let sandbox = Sandbox::new(&Limits::for_batch(requests.len(), false)).expect("sandbox");
        sandbox.load_engine_bytecode(&self.engine).expect("load");
        let arr = format!("[{}]", requests.join(","));
        let out = sandbox
            .run_batch(&arr, &self.packs, &self.options)
            .expect("batch");
        assert!(
            !out.contains("{\"error\":"),
            "{}",
            &out[..out.len().min(300)]
        );
    }

    /// 要求を threads 個の組に分け、組ごとに別のスレッド（別の実行環境）で1件ずつ計算する
    fn parallel(&self, requests: &[String], threads: usize) {
        let groups: Vec<Vec<String>> = (0..threads)
            .map(|t| requests.iter().skip(t).step_by(threads).cloned().collect())
            .collect();
        std::thread::scope(|s| {
            for g in &groups {
                s.spawn(move || {
                    for r in g {
                        self.one(r);
                    }
                });
            }
        });
    }

    /// 案ごとに別のスレッドで、その案の4想定をまとめて計算する（runBatch）
    fn plans(&self, requests: &[String]) {
        std::thread::scope(|s| {
            for chunk in requests.chunks(4) {
                s.spawn(move || self.batch(chunk));
            }
        });
    }
}

fn main() {
    let mut engine_path = None;
    let mut packs_path = None;
    let mut requests_path = None;
    let mut protection_path = None;
    let mut repeat = 5usize;
    let mut threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .saturating_sub(1)
        .clamp(1, 8);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--engine" => engine_path = args.next(),
            "--packs" => packs_path = args.next(),
            "--requests" => requests_path = args.next(),
            "--protection" => protection_path = args.next(),
            "--repeat" => repeat = args.next().and_then(|v| v.parse().ok()).unwrap_or(5),
            "--threads" => threads = args.next().and_then(|v| v.parse().ok()).unwrap_or(threads),
            _ => panic!("usage: engine-bench --engine <engine.js> --packs <packs.json> --requests <requests.json> [--protection <request.json>] [--repeat N] [--threads T]"),
        }
    }
    let engine_js = std::fs::read_to_string(engine_path.expect("--engine")).expect("engine");
    let packs = std::fs::read_to_string(packs_path.expect("--packs")).expect("packs");
    let list: Vec<serde_json::Value> = serde_json::from_str(
        &std::fs::read_to_string(requests_path.expect("--requests")).expect("requests"),
    )
    .expect("json");
    let requests: Vec<String> = list.iter().map(|v| v.to_string()).collect();
    let four = &requests[..4.min(requests.len())];
    let protection: Option<String> = protection_path.map(|p| {
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(p).expect("protection")).expect("json");
        v.to_string()
    });
    // 製品と同じ: ビルドの時にバイトコードにし、パックの形は本体が読み込んだときに1回だけ確かめる
    let t = Instant::now();
    let engine = compile_engine(&engine_js).expect("compile");
    let compile_ms = ms(t);
    let digests = check_packs(&engine, &packs).expect("check packs");
    let options = format!("{{\"packsChecked\":{digests}}}");
    let bench = Bench {
        engine,
        packs,
        options,
    };
    let mut load = Vec::new();
    let mut single = Vec::new();
    let mut par4 = Vec::new();
    let mut batch4 = Vec::new();
    let mut par20 = Vec::new();
    let mut plans5 = Vec::new();
    let mut protection_ms = Vec::new();
    // 温める（ファイルの読み込みなどの初回の費用を除く）
    bench.one(&requests[0]);
    for _ in 0..repeat {
        let t = Instant::now();
        let s = Sandbox::new(&Limits::DEFAULT).expect("sandbox");
        s.load_engine_bytecode(&bench.engine).expect("load");
        load.push(ms(t));
        drop(s);
        let t = Instant::now();
        bench.one(&requests[0]);
        single.push(ms(t));
        let t = Instant::now();
        bench.parallel(four, four.len());
        par4.push(ms(t));
        let t = Instant::now();
        bench.batch(four);
        batch4.push(ms(t));
        let t = Instant::now();
        bench.parallel(&requests, threads);
        par20.push(ms(t));
        let t = Instant::now();
        bench.plans(&requests);
        plans5.push(ms(t));
        if let Some(p) = &protection {
            let t = Instant::now();
            bench.one(p);
            protection_ms.push(ms(t));
        }
    }
    let mut out = serde_json::json!({
        "threads": threads,
        "compile": stats(vec![compile_ms]),
        "load": stats(load),
        "single": stats(single),
        "par4": stats(par4),
        "batch4": stats(batch4),
        "par20": stats(par20),
        "plans5": stats(plans5),
    });
    if !protection_ms.is_empty() {
        out["protection"] = stats(protection_ms);
    }
    println!("{out}");
}
