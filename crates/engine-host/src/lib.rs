//! 計算エンジンを quickjs-ng（rquickjs 経由）で動かすホスト（0005）。
//! 計算ごとに新しい実行環境を作り、固めてからエンジンを読み込み、終わったら捨てる。

use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::context::intrinsic;
use rquickjs::{
    CatchResultExt, CaughtError, Context, Function, Module, Object, Runtime, Value, WriteOptions,
};

/// 0005 の3: 固めるための JS（エンジンより先に流す）
pub const LOCKDOWN_JS: &str = include_str!("lockdown.js");

/// 0005 の4: 上限（初期値。測定に合わせて変えてよい）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub memory_bytes: usize,
    pub stack_bytes: usize,
    pub time: Duration,
}

impl Limits {
    /// 根拠の記録なし・要約
    pub const DEFAULT: Limits = Limits {
        memory_bytes: 128 * 1024 * 1024,
        stack_bytes: 1024 * 1024,
        time: Duration::from_secs(10),
    };
    /// 根拠の記録全部
    pub const FULL_TRACE: Limits = Limits {
        memory_bytes: 256 * 1024 * 1024,
        stack_bytes: 1024 * 1024,
        time: Duration::from_secs(30),
    };

    /// まとめて計算（runBatch）: 要求の間で使い回す部品の結果をすべて持つので、メモリは要求の数に比例（1件 48 MB＋64 MB、最大 1 GB）、
    /// 時間も要求の数に比例（最大 120 秒）
    pub fn for_batch(requests: usize, any_full: bool) -> Limits {
        let per = if any_full {
            Limits::FULL_TRACE.time
        } else {
            Limits::DEFAULT.time
        };
        let n = u32::try_from(requests.max(1)).unwrap_or(u32::MAX);
        let memory = (64 + 48 * requests.max(1)).min(1024) * 1024 * 1024;
        Limits {
            memory_bytes: memory.max(Limits::FULL_TRACE.memory_bytes),
            stack_bytes: Limits::DEFAULT.stack_bytes,
            time: per.saturating_mul(n).min(Duration::from_secs(120)),
        }
    }

    pub fn for_trace(trace: &str) -> Limits {
        if trace == "full" {
            Limits::FULL_TRACE
        } else {
            Limits::DEFAULT
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// 時間の上限を超えた
    Timeout,
    /// メモリの上限を超えた
    MemoryLimit,
    /// スタックの上限を超えた
    StackOverflow,
    /// JS の例外（メッセージは開発用。画面やファイルに出す前に ID だけの形に整える。0005 の8）
    Js(String),
    /// 実行環境の準備の失敗
    Setup(String),
}

impl HostError {
    /// 外に出してよい形の符号（値を含まない）
    pub fn code(&self) -> &'static str {
        match self {
            HostError::Timeout => "E_HOST_TIMEOUT",
            HostError::MemoryLimit => "E_HOST_MEMORY",
            HostError::StackOverflow => "E_HOST_STACK",
            HostError::Js(_) => "E_HOST_JS",
            HostError::Setup(_) => "E_HOST_SETUP",
        }
    }
}

/// 計算1回分の、固めた実行環境。使い回さない
pub struct Sandbox {
    // context は runtime より先に落とす
    context: Context,
    _runtime: Runtime,
    interrupted: Rc<Cell<bool>>,
}

impl Sandbox {
    /// 新しいランタイムとコンテキストを作り、上限を設定して固める
    pub fn new(limits: &Limits) -> Result<Sandbox, HostError> {
        let runtime = Runtime::new().map_err(|e| HostError::Setup(e.to_string()))?;
        runtime.set_memory_limit(limits.memory_bytes);
        runtime.set_max_stack_size(limits.stack_bytes);
        let interrupted = Rc::new(Cell::new(false));
        let flag = interrupted.clone();
        let deadline = Instant::now() + limits.time;
        runtime.set_interrupt_handler(Some(Box::new(move || {
            let over = Instant::now() > deadline;
            if over {
                flag.set(true);
            }
            over
        })));
        // 0005 の3: Date・Performance・WeakRef・DOMException は入れない。
        // Eval はホストがスクリプトを読み込むのに要る（JS の eval そのものは固めるときに消す）
        let context = Context::builder()
            .with::<intrinsic::Eval>()
            .with::<intrinsic::RegExpCompiler>()
            .with::<intrinsic::RegExp>()
            .with::<intrinsic::Json>()
            .with::<intrinsic::MapSet>()
            .with::<intrinsic::TypedArrays>()
            .with::<intrinsic::Promise>()
            .with::<intrinsic::Proxy>()
            .build(&runtime)
            .map_err(|e| HostError::Setup(e.to_string()))?;
        let sandbox = Sandbox {
            context,
            _runtime: runtime,
            interrupted,
        };
        sandbox.eval_script(LOCKDOWN_JS)?;
        Ok(sandbox)
    }

    fn classify(&self, err: CaughtError<'_>) -> HostError {
        if self.interrupted.get() {
            return HostError::Timeout;
        }
        // メモリが尽きると QuickJS は例外のオブジェクトを作れず null を投げる
        let null_thrown = matches!(&err, CaughtError::Value(v) if v.is_null());
        let text = err.to_string();
        let lower = text.to_lowercase();
        if null_thrown
            || lower.contains("out of memory")
            || matches!(err, CaughtError::Error(rquickjs::Error::Allocation))
        {
            HostError::MemoryLimit
        } else if lower.contains("stack overflow")
            || lower.contains("maximum call stack size exceeded")
        {
            HostError::StackOverflow
        } else {
            HostError::Js(text)
        }
    }

    /// スクリプトを流す（結果は捨てる）
    pub fn eval_script(&self, source: &str) -> Result<(), HostError> {
        self.context.with(|ctx| {
            ctx.eval::<(), _>(source)
                .catch(&ctx)
                .map_err(|e| self.classify(e))
        })
    }

    /// 式を評価して文字列で受け取る（脱出テスト用）
    pub fn eval_string(&self, source: &str) -> Result<String, HostError> {
        self.context.with(|ctx| {
            ctx.eval::<String, _>(source)
                .catch(&ctx)
                .map_err(|e| self.classify(e))
        })
    }

    /// エンジンのまとめた JS を読み込み、グローバルを凍結する（ソースから。テストと開発用）
    pub fn load_engine(&self, engine_js: &str) -> Result<(), HostError> {
        self.eval_script(engine_js)?;
        // エンジンの後に読み込むもの（将来のカスタム部品）がグローバルを書き換えられないように
        self.eval_script("Object.freeze(globalThis);")
    }

    /// エンジンをバイトコード（compile_engine で作ったもの）から読み込み、グローバルを凍結する（0005 の1: 製品はこちら）。
    /// 読み込んでよいのは、自分たちがビルドして署名つきで配ったバイトコードだけ（外から来たバイトコードは読み込まない。
    /// 署名の確かめは本体が行う。0017）
    pub fn load_engine_bytecode(&self, bytecode: &EngineBytecode) -> Result<(), HostError> {
        self.context.with(|ctx| {
            let load = || -> rquickjs::Result<()> {
                // SAFETY: EngineBytecode は compile_engine が同じ quickjs-ng で作ったものだけ（作り方を型で限っている）
                let module = unsafe { Module::load(ctx.clone(), &bytecode.0)? };
                let (module, promise) = module.eval()?;
                promise.finish::<()>()?;
                let engine: Value = module.get("FinanciaEngine")?;
                ctx.globals().set("FinanciaEngine", engine)?;
                Ok(())
            };
            load().catch(&ctx).map_err(|e| self.classify(e))
        })?;
        self.eval_script("Object.freeze(globalThis);")
    }

    /// FinanciaEngine.run(request, packs, options) を呼ぶ
    pub fn run(&self, request: &str, packs: &str, options: &str) -> Result<String, HostError> {
        self.call("run", request, packs, options)
    }

    /// FinanciaEngine.runBatch(requests, packs, options) を呼ぶ（requests は要求の JSON の配列。案×想定をまとめて計算し、同じになる部分を使い回す）
    pub fn run_batch(
        &self,
        requests: &str,
        packs: &str,
        options: &str,
    ) -> Result<String, HostError> {
        self.call("runBatch", requests, packs, options)
    }

    /// グローバルの物 `object` の関数 `name` を、3つの文字の引数で呼び、文字で受け取る。エンジンではない、eval_script で読み込んだ
    /// 計算でない JS（AI接続口の「数字の根拠」の読み方など。0183）を、同じ固めた実行環境で呼ぶのに使う
    pub fn call_function(
        &self,
        object: &str,
        name: &str,
        args: (&str, &str, &str),
    ) -> Result<String, HostError> {
        self.context.with(|ctx| {
            let call = || -> rquickjs::Result<String> {
                let obj: Object = ctx.globals().get(object)?;
                let f: Function = obj.get(name)?;
                f.call(args)
            };
            call().catch(&ctx).map_err(|e| self.classify(e))
        })
    }

    fn call(&self, name: &str, a: &str, packs: &str, options: &str) -> Result<String, HostError> {
        self.context.with(|ctx| {
            let call = || -> rquickjs::Result<String> {
                let engine: Object = ctx.globals().get("FinanciaEngine")?;
                let f: Function = engine.get(name)?;
                f.call((a, packs, options))
            };
            call().catch(&ctx).map_err(|e| self.classify(e))
        })
    }
}

/// エンジンのバイトコード（0005 の1）。compile_engine で作り、load_engine_bytecode で読み込む。
/// 形式は quickjs-ng の版ごとに変わるので、毎回のビルドで作り直す（ファイルに書くのは to_bytes、読むのは from_trusted_bytes）
#[derive(Clone)]
pub struct EngineBytecode(Vec<u8>);

/// バイトコードのファイルの先頭の印（形式の版）
const BYTECODE_MAGIC: &[u8] = b"FINANCIA-QBC1\n";

impl EngineBytecode {
    /// ファイルに書く形（先頭に印）
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = BYTECODE_MAGIC.to_vec();
        out.extend_from_slice(&self.0);
        out
    }

    /// ファイルから読む。自分たちがビルドし、本体が署名を確かめたファイルだけを渡すこと（0005 の1・0017）
    pub fn from_trusted_bytes(bytes: &[u8]) -> Result<EngineBytecode, HostError> {
        match bytes.strip_prefix(BYTECODE_MAGIC) {
            Some(body) => Ok(EngineBytecode(body.to_vec())),
            None => Err(HostError::Setup("not an engine bytecode file".to_owned())),
        }
    }
}

/// まとめた JS をバイトコードにする（ビルドの時に1回。0005 の1）。モジュールとして読み、FinanciaEngine を書き出す
pub fn compile_engine(engine_js: &str) -> Result<EngineBytecode, HostError> {
    let runtime = Runtime::new().map_err(|e| HostError::Setup(e.to_string()))?;
    // 実行環境と同じ組み込みで読む（正規表現のリテラルは読むときに組み立てる）
    let context = Context::builder()
        .with::<intrinsic::Eval>()
        .with::<intrinsic::RegExpCompiler>()
        .with::<intrinsic::RegExp>()
        .with::<intrinsic::Json>()
        .with::<intrinsic::MapSet>()
        .with::<intrinsic::TypedArrays>()
        .with::<intrinsic::Promise>()
        .with::<intrinsic::Proxy>()
        .build(&runtime)
        .map_err(|e| HostError::Setup(e.to_string()))?;
    context.with(|ctx| {
        let source = format!("{engine_js}\nexport {{ FinanciaEngine }};\n");
        let compile = || -> rquickjs::Result<Vec<u8>> {
            let module = Module::declare(ctx.clone(), "engine.js", source)?;
            module.write(WriteOptions {
                strip_source: true,
                ..Default::default()
            })
        };
        compile()
            .catch(&ctx)
            .map(EngineBytecode)
            .map_err(|e| HostError::Setup(e.to_string()))
    })
}

/// 計算1回: 新しい実行環境 → 固める → エンジンを読み込む → 計算 → 捨てる
pub fn run_engine(
    engine_js: &str,
    request: &str,
    packs: &str,
    options: &str,
    limits: &Limits,
) -> Result<String, HostError> {
    let sandbox = Sandbox::new(limits)?;
    sandbox.load_engine(engine_js)?;
    sandbox.run(request, packs, options)
}

/// 計算1回（製品の形）: 新しい実行環境 → 固める → エンジンをバイトコードから読み込む → 計算 → 捨てる
pub fn run_engine_bytecode(
    engine: &EngineBytecode,
    request: &str,
    packs: &str,
    options: &str,
    limits: &Limits,
) -> Result<String, HostError> {
    let sandbox = Sandbox::new(limits)?;
    sandbox.load_engine_bytecode(engine)?;
    sandbox.run(request, packs, options)
}

/// パックの形を1回だけ確かめ、検査済みの指紋の配列（JSON）を返す（0005・0017 の追記: 本体が署名を確かめた後に1回。
/// 計算のときは options の packsChecked に渡し、計算ごとには確かめない）
pub fn check_packs(engine: &EngineBytecode, packs: &str) -> Result<String, HostError> {
    let sandbox = Sandbox::new(&Limits::DEFAULT)?;
    sandbox.load_engine_bytecode(engine)?;
    let out = sandbox.context.with(|ctx| {
        let call = || -> rquickjs::Result<String> {
            let engine: Object = ctx.globals().get("FinanciaEngine")?;
            let f: Function = engine.get("checkPacks")?;
            f.call((packs,))
        };
        call().catch(&ctx).map_err(|e| sandbox.classify(e))
    })?;
    let v: serde_json::Value =
        serde_json::from_str(&out).map_err(|e| HostError::Setup(e.to_string()))?;
    match v.get("digests") {
        Some(d) if v.get("ok") == Some(&serde_json::Value::Bool(true)) => Ok(d.to_string()),
        _ => Err(HostError::Js(out)),
    }
}

/// 要求の JSON から根拠の記録の細かさを読む（上限の選択に使う）
pub fn trace_mode(request: &str) -> String {
    serde_json::from_str::<serde_json::Value>(request)
        .ok()
        .and_then(|v| v.get("trace").and_then(|t| t.as_str()).map(str::to_owned))
        .unwrap_or_else(|| "none".to_owned())
}
