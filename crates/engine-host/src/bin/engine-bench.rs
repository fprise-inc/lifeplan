//! 速さの計測（0005 の「速さの回帰」）。計算ごとに新しい実行環境を作る本番と同じ形で、quickjs-ng の計算の時間を測る。
//! 使い方: engine-bench --engine dist/engine.js --packs packs.json --requests requests.json [--repeat N] [--threads T]
//! requests.json は要求の JSON の配列（5案×4想定の20件。先頭の4件が1案×4想定）。結果は JSON（ミリ秒の中央値と最小値）を標準出力に出す
use std::time::Instant;

use engine_host::{run_engine, trace_mode, Limits, Sandbox};

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

/// 1件: 新しい実行環境 → 固める → エンジンを読み込む → 計算 → 捨てる
fn one(engine: &str, request: &str, packs: &str) {
    let limits = Limits::for_trace(&trace_mode(request));
    let out = run_engine(engine, request, packs, "{}", &limits).expect("run");
    assert!(
        !out.starts_with("{\"error\":"),
        "{}",
        &out[..out.len().min(300)]
    );
}

/// まとめて計算（1つの実行環境で runBatch）
fn batch(engine: &str, requests: &[String], packs: &str) {
    let sandbox = Sandbox::new(&Limits::for_batch(requests.len(), false)).expect("sandbox");
    sandbox.load_engine(engine).expect("load");
    let arr = format!("[{}]", requests.join(","));
    let out = sandbox.run_batch(&arr, packs, "{}").expect("batch");
    assert!(
        !out.contains("{\"error\":"),
        "{}",
        &out[..out.len().min(300)]
    );
}

fn parallel(engine: &str, requests: &[String], packs: &str, threads: usize, use_batch: bool) {
    // 要求を threads 個の組に分け、組ごとに別のスレッド（別の実行環境）で計算する
    let groups: Vec<Vec<String>> = (0..threads)
        .map(|t| requests.iter().skip(t).step_by(threads).cloned().collect())
        .collect();
    std::thread::scope(|s| {
        for g in &groups {
            s.spawn(move || {
                if use_batch {
                    batch(engine, g, packs);
                } else {
                    for r in g {
                        one(engine, r, packs);
                    }
                }
            });
        }
    });
}

fn main() {
    let mut engine_path = None;
    let mut packs_path = None;
    let mut requests_path = None;
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
            "--repeat" => repeat = args.next().and_then(|v| v.parse().ok()).unwrap_or(5),
            "--threads" => threads = args.next().and_then(|v| v.parse().ok()).unwrap_or(threads),
            _ => panic!("usage: engine-bench --engine <engine.js> --packs <packs.json> --requests <requests.json> [--repeat N] [--threads T]"),
        }
    }
    let engine = std::fs::read_to_string(engine_path.expect("--engine")).expect("engine");
    let packs = std::fs::read_to_string(packs_path.expect("--packs")).expect("packs");
    let list: Vec<serde_json::Value> = serde_json::from_str(
        &std::fs::read_to_string(requests_path.expect("--requests")).expect("requests"),
    )
    .expect("json");
    let requests: Vec<String> = list.iter().map(|v| v.to_string()).collect();
    let four = &requests[..4.min(requests.len())];
    // まとめて計算できるエンジンか
    let has_batch = {
        let s = Sandbox::new(&Limits::DEFAULT).expect("sandbox");
        s.load_engine(&engine).expect("load");
        s.eval_string("typeof FinanciaEngine.runBatch")
            .expect("eval")
            == "function"
    };
    let mut load = Vec::new();
    let mut single = Vec::new();
    let mut seq20 = Vec::new();
    let mut par4 = Vec::new();
    let mut par20 = Vec::new();
    let mut batch4 = Vec::new();
    let mut batch20 = Vec::new();
    let mut par20batch = Vec::new();
    // 温める（ファイルの読み込みなどの初回の費用を除く）
    one(&engine, &requests[0], &packs);
    for _ in 0..repeat {
        let t = Instant::now();
        let s = Sandbox::new(&Limits::DEFAULT).expect("sandbox");
        s.load_engine(&engine).expect("load");
        load.push(ms(t));
        drop(s);
        let t = Instant::now();
        one(&engine, &requests[0], &packs);
        single.push(ms(t));
        let t = Instant::now();
        parallel(&engine, four, &packs, four.len(), false);
        par4.push(ms(t));
        let t = Instant::now();
        parallel(&engine, &requests, &packs, threads, false);
        par20.push(ms(t));
        if has_batch {
            let t = Instant::now();
            batch(&engine, four, &packs);
            batch4.push(ms(t));
            let t = Instant::now();
            batch(&engine, &requests, &packs);
            batch20.push(ms(t));
            let t = Instant::now();
            parallel(&engine, &requests, &packs, threads, true);
            par20batch.push(ms(t));
        }
    }
    // 20件を順番に（重いので1回だけ）
    {
        let t = Instant::now();
        for r in &requests {
            one(&engine, r, &packs);
        }
        seq20.push(ms(t));
    }
    let mut out = serde_json::json!({
        "threads": threads,
        "load": stats(load),
        "single": stats(single),
        "seq20": stats(seq20),
        "par4": stats(par4),
        "par20": stats(par20),
    });
    if has_batch {
        out["batch4"] = stats(batch4);
        out["batch20"] = stats(batch20);
        out["par20batch"] = stats(par20batch);
    }
    println!("{out}");
}
