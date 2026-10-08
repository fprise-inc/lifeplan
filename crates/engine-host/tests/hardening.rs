//! 0005・0016: 脱出テストと実行環境の上限のテスト
use std::path::PathBuf;
use std::time::{Duration, Instant};

use engine_host::{
    check_packs, compile_engine, run_engine, run_engine_bytecode, EngineBytecode, HostError,
    Limits, Sandbox,
};

fn sandbox() -> Sandbox {
    Sandbox::new(&Limits::DEFAULT).expect("sandbox")
}

fn eval(code: &str) -> String {
    sandbox().eval_string(code).expect("eval")
}

/// 例外の名前を返す（例外が出なければ "ok"）
fn throws(code: &str) -> String {
    eval(&format!("(() => {{ 'use strict'; try {{ {code}; return 'ok'; }} catch (e) {{ return e.constructor === undefined ? 'error' : e.name; }} }})()"))
}

#[test]
fn clock_is_absent() {
    assert_eq!(eval("typeof Date"), "undefined");
    assert_eq!(throws("Date.now()"), "ReferenceError");
    assert_eq!(eval("typeof performance"), "undefined");
}

#[test]
fn random_throws() {
    assert_eq!(throws("Math.random()"), "TypeError");
}

#[test]
fn banned_math_functions_throw() {
    for f in [
        "pow(2, 3)",
        "exp(1)",
        "log(2)",
        "log10(2)",
        "sqrt(2)",
        "sin(1)",
        "cos(1)",
        "atan2(1, 2)",
        "round(1)",
        "fround(1)",
        "hypot(3, 4)",
        "cbrt(8)",
    ] {
        assert_eq!(throws(&format!("Math.{f}")), "TypeError", "Math.{f}");
    }
    // 整数に対して使ってよい関数は使える
    assert_eq!(eval("String([Math.abs(-3), Math.min(1, 2), Math.max(1, 2), Math.sign(-2), Math.trunc(-2), Math.floor(7 / 2), Math.ceil(7 / 2)])"), "3,1,2,-1,-2,3,4");
}

#[test]
fn code_generation_is_disabled() {
    assert_eq!(eval("typeof eval"), "undefined");
    assert_eq!(throws("Function('return 1')"), "TypeError");
    assert_eq!(throws("new Function('return 1')"), "TypeError");
    assert_eq!(
        throws("(function () {}).constructor('return 1')"),
        "TypeError"
    );
    assert_eq!(
        throws("(async function () {}).constructor('return 1')"),
        "TypeError"
    );
    assert_eq!(
        throws("(function* () {}).constructor('return 1')"),
        "TypeError"
    );
    assert_eq!(
        throws("(async function* () {}).constructor('return 1')"),
        "TypeError"
    );
    // instanceof Function は使える
    assert_eq!(eval("String((() => 1) instanceof Function)"), "true");
}

#[test]
fn only_expected_globals_remain() {
    let expected = [
        "AggregateError",
        "Array",
        "ArrayBuffer",
        "AsyncDisposableStack",
        "BigInt",
        "BigInt64Array",
        "BigUint64Array",
        "Boolean",
        "DataView",
        "DisposableStack",
        "Error",
        "EvalError",
        "Float16Array",
        "Float32Array",
        "Float64Array",
        "Function",
        "Infinity",
        "Int16Array",
        "Int32Array",
        "Int8Array",
        "InternalError",
        "Iterator",
        "JSON",
        "Map",
        "Math",
        "NaN",
        "Number",
        "Object",
        "Promise",
        "Proxy",
        "RangeError",
        "ReferenceError",
        "Reflect",
        "RegExp",
        "Set",
        "String",
        "SuppressedError",
        "Symbol",
        "Symbol(Symbol.toStringTag)",
        "SyntaxError",
        "TypeError",
        "URIError",
        "Uint16Array",
        "Uint32Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "WeakMap",
        "WeakSet",
        "decodeURI",
        "decodeURIComponent",
        "encodeURI",
        "encodeURIComponent",
        "escape",
        "globalThis",
        "isFinite",
        "isNaN",
        "parseFloat",
        "parseInt",
        "queueMicrotask",
        "undefined",
        "unescape",
    ];
    let got = eval("Reflect.ownKeys(globalThis).map(String).sort().join(',')");
    assert_eq!(got, expected.join(","));
    for name in [
        "console",
        "require",
        "process",
        "std",
        "os",
        "WebAssembly",
        "SharedArrayBuffer",
        "Atomics",
        "WeakRef",
        "FinalizationRegistry",
        "setTimeout",
        "fetch",
        "XMLHttpRequest",
    ] {
        assert_eq!(eval(&format!("typeof {name}")), "undefined", "{name}");
    }
}

#[test]
fn intrinsics_are_frozen() {
    assert_eq!(
        eval("String([Object.isFrozen(Object.prototype), Object.isFrozen(Array.prototype), Object.isFrozen(Math), Object.isFrozen(JSON), Object.isFrozen(Function.prototype), Object.isFrozen(Error.prototype), Object.isFrozen(BigInt.prototype)])"),
        "true,true,true,true,true,true,true"
    );
    assert_eq!(throws("Math.min = () => 0"), "TypeError");
    assert_eq!(throws("Array.prototype.push = () => 0"), "TypeError");
    assert_eq!(throws("Object.prototype.polluted = 1"), "TypeError");
    assert_eq!(throws("globalThis.Math = {}"), "TypeError");
    // 書き換えに失敗した後も、元の関数のまま（黙って結果が変わることはない）
    assert_eq!(eval("(() => { try { Math.min = () => 42; } catch (e) {} return String(Math.min(1, 2)); })()"), "1");
}

#[test]
fn override_mistake_is_mitigated() {
    // 凍結した組み込みと同じ名前を、子のオブジェクトに代入できる（SES と同じ対策）
    assert_eq!(eval("(() => { 'use strict'; class E extends Error { constructor() { super('m'); this.name = 'E'; } } return new E().name; })()"), "E");
    assert_eq!(
        eval("(() => { 'use strict'; const o = {}; o.toString = () => 'x'; return String(o); })()"),
        "x"
    );
    assert_eq!(eval("(() => { 'use strict'; function F() {} F.prototype.constructor = F; return String(new F().constructor === F); })()"), "true");
    assert_eq!(eval("(() => { 'use strict'; const o = Object.create(Error.prototype); o.message = 'm'; return o.message; })()"), "m");
    // 組み込みそのものへの代入は失敗する
    assert_eq!(throws("Object.prototype.toString = () => 'x'"), "TypeError");
}

#[test]
fn infinite_loop_is_interrupted() {
    let limits = Limits {
        time: Duration::from_millis(100),
        ..Limits::DEFAULT
    };
    let sb = Sandbox::new(&limits).unwrap();
    let start = Instant::now();
    let r = sb.eval_script("for (;;) {}");
    assert_eq!(r, Err(HostError::Timeout));
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[test]
fn memory_exhaustion_is_stopped() {
    let limits = Limits {
        memory_bytes: 32 * 1024 * 1024,
        ..Limits::DEFAULT
    };
    let sb = Sandbox::new(&limits).unwrap();
    let r = sb.eval_script("const a = []; for (;;) { a.push(new Array(100000).fill(1)); }");
    assert_eq!(r, Err(HostError::MemoryLimit));
}

#[test]
fn deep_recursion_is_stopped() {
    let r = sandbox().eval_script("function f(n) { return f(n + 1) + 1; } f(0);");
    assert_eq!(r, Err(HostError::StackOverflow));
}

#[test]
fn state_does_not_leak_between_runs() {
    let a = sandbox();
    a.eval_script("globalThis.leaked = 1;").unwrap();
    // 失敗した実行環境の後でも、新しい実行環境はきれい
    let failed = Sandbox::new(&Limits {
        time: Duration::from_millis(50),
        ..Limits::DEFAULT
    })
    .unwrap();
    assert_eq!(failed.eval_script("for (;;) {}"), Err(HostError::Timeout));
    assert_eq!(eval("typeof leaked"), "undefined");
}

fn engine_bundle() -> String {
    let path = std::env::var("ENGINE_BUNDLE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine/dist/engine.js")
        });
    std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{} がありません。先に engine で npm run build を流してください",
            path.display()
        )
    })
}

/// 製品の制度データ（engine/dist/regulation の全パック）を JSON の配列にする
fn regulation_packs() -> String {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine/dist/regulation");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|_| {
            panic!(
                "{} がありません。先に engine で npm run build を流してください",
                dir.display()
            )
        })
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let packs: Vec<String> = files
        .iter()
        .map(|p| std::fs::read_to_string(p).unwrap().trim().to_string())
        .collect();
    format!("[{}]", packs.join(","))
}

#[test]
fn engine_runs_after_lockdown_and_global_is_frozen() {
    // 0005 の未確定: 凍結を「エンジンを読み込む前」に行う順番で動くこと
    let sb = sandbox();
    sb.load_engine(&engine_bundle()).unwrap();
    assert_eq!(
        sb.eval_string("String(Object.isFrozen(globalThis))")
            .unwrap(),
        "true"
    );
    assert_eq!(sb.eval_string("(() => { 'use strict'; try { globalThis.x = 1; return 'ok'; } catch (e) { return e.name; } })()").unwrap(), "TypeError");
    let req = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/modelHouseholds/singleEarnerTwoKids.json"),
    )
    .unwrap();
    let out = sb
        .run(&req, &regulation_packs(), "{\"checkInternal\":true}")
        .unwrap();
    assert!(
        out.starts_with("{\"header\":"),
        "{}",
        &out[..out.len().min(200)]
    );
}

#[test]
fn engine_errors_carry_ids_only() {
    let out = run_engine(
        &engine_bundle(),
        "{\"trace\":\"none\",\"input\":{\"unknown\":1}}",
        "[]",
        "{}",
        &Limits::DEFAULT,
    )
    .unwrap();
    assert!(
        out.starts_with("{\"error\":{\"code\":\"E_INPUT_SCHEMA\""),
        "{out}"
    );
}

#[test]
fn engine_runs_from_bytecode_with_the_same_result() {
    // 0005 の1: 製品はバイトコードから読み込む。ソースから読み込んだときと同じ結果になること
    let js = engine_bundle();
    let bytecode = compile_engine(&js).unwrap();
    // ファイルに書いて読み戻した形でも動く（先頭の印を確かめる）
    let bytecode = EngineBytecode::from_trusted_bytes(&bytecode.to_bytes()).unwrap();
    let req = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/modelHouseholds/singleEarnerTwoKids.json"),
    )
    .unwrap();
    let packs = regulation_packs();
    let from_source = run_engine(&js, &req, &packs, "{}", &Limits::DEFAULT).unwrap();
    let from_bytecode =
        run_engine_bytecode(&bytecode, &req, &packs, "{}", &Limits::DEFAULT).unwrap();
    assert_eq!(from_source, from_bytecode);
    // 凍結もソースのときと同じ
    let sb = sandbox();
    sb.load_engine_bytecode(&bytecode).unwrap();
    assert_eq!(
        sb.eval_string("String(Object.isFrozen(globalThis))")
            .unwrap(),
        "true"
    );
}

#[test]
fn bytecode_without_the_header_is_rejected() {
    assert!(matches!(
        EngineBytecode::from_trusted_bytes(b"not bytecode"),
        Err(HostError::Setup(_))
    ));
}

#[test]
fn packs_are_checked_once_and_the_digests_skip_the_check() {
    // 0005・0017 の追記: パックの形は本体が1回だけ確かめ、計算では指紋を渡す（結果は同じ）
    let bytecode = compile_engine(&engine_bundle()).unwrap();
    let packs = regulation_packs();
    let digests = check_packs(&bytecode, &packs).unwrap();
    assert!(digests.starts_with("[\"sha256:"), "{digests}");
    let req = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/modelHouseholds/single25.json"),
    )
    .unwrap();
    let checked = format!("{{\"packsChecked\":{digests}}}");
    let a = run_engine_bytecode(&bytecode, &req, &packs, "{}", &Limits::DEFAULT).unwrap();
    let b = run_engine_bytecode(&bytecode, &req, &packs, &checked, &Limits::DEFAULT).unwrap();
    assert_eq!(a, b);
    // 形の誤ったパックは、1回の検査でエラーになる
    assert!(matches!(
        check_packs(&bytecode, "[{\"format\":\"x\"}]"),
        Err(HostError::Js(_))
    ));
}
