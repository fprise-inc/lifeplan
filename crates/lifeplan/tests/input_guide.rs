//! 入力の形の案内（get_input_guide）・場面の手本（get_input_recipe）・直し方の分かるエラー（0196）を、本物の接続口を起動して確かめる。
//! 手本は、見本の世帯（架空）のすべてに当てて、計算が通ることを確かめる（当てられない世帯は、理由を返すこと）。

use ai_share::clock::ManualClock;
use ai_share::{
    AppEndpoint, ConsentDecision, ConsentRef, GrantOptions, ShareRegistry, SharedHouseholdSource,
};
use rmcp::model::{
    CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation, ProtocolVersion,
};
use rmcp::service::RunningService;
use rmcp::transport::{ConfigureCommandExt, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const RECIPES: [&str; 6] = [
    "buyHome",
    "newChild",
    "retire",
    "prepayment",
    "startNisaIdeco",
    "contingency",
];

type Client = RunningService<RoleClient, ClientConfig>;

fn temp_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lp-{name}-{}", ai_ipc::random_hex(4)))
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn model_ids() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(repo().join("data/modelHouseholds"))
        .unwrap()
        .filter_map(|e| {
            let p = e.ok()?.path();
            (p.extension()? == "json")
                .then(|| p.file_stem().unwrap().to_string_lossy().into_owned())
        })
        .collect();
    v.sort();
    v
}

async fn connect(dir: &Path) -> Client {
    let cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_lifeplan")).configure(|c| {
        c.arg("mcp").env("LIFEPLAN_RUNTIME_DIR", dir);
    });
    let (transport, _) = TokioChildProcess::builder(cmd)
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let config = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("test-ai", "1.2"),
    )
    .with_protocol_version(ProtocolVersion::V_2025_11_25);
    config.serve(transport).await.unwrap()
}

async fn call(c: &Client, name: &str, args: Value) -> (bool, String) {
    let mut p = CallToolRequestParams::new(name.to_owned());
    if let Value::Object(m) = args {
        p = p.with_arguments(m);
    }
    let r = c.call_tool(p).await.unwrap();
    let text = r
        .content
        .iter()
        .filter_map(|b| b.as_text().map(|t| t.text.clone()))
        .collect::<Vec<_>>()
        .join("\n");
    (r.is_error.unwrap_or(false), text)
}

async fn call_ok(c: &Client, name: &str, args: Value) -> Value {
    let (err, text) = call(c, name, args).await;
    assert!(!err, "{name}: {text}");
    serde_json::from_str(&text).unwrap_or_else(|_| panic!("{name}: JSON ではありません: {text}"))
}

/// 道具の入力の JSON Schema を見本（tests/fixtures/tools/<道具>.input-schema.json）と比べる（LIFEPLAN_UPDATE_FIXTURES=1 で作り直す）
fn check_schema_snapshot(tools: &[rmcp::model::Tool], name: &str) {
    let tool = tools.iter().find(|t| t.name == name).unwrap();
    let schema = serde_json::to_value(tool.input_schema.as_ref()).unwrap();
    let snapshot = repo().join(format!(
        "crates/lifeplan/tests/fixtures/tools/{name}.input-schema.json"
    ));
    let pretty = format!("{}\n", serde_json::to_string_pretty(&schema).unwrap());
    if std::env::var_os("LIFEPLAN_UPDATE_FIXTURES").is_some() {
        std::fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
        std::fs::write(&snapshot, &pretty).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&snapshot).unwrap_or_default(),
        pretty,
        "{name} の入力の形が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直してください"
    );
}

/// 案内の骨組みから一から世帯を作り、手本を重ね、少ない回数で計算できる。形の違う入力には直し方が返る
#[tokio::test(flavor = "multi_thread")]
async fn guide_skeleton_and_recipes_build_a_household_from_scratch() {
    let dir = temp_dir("guide");
    let c = connect(&dir).await;
    let tools = c.list_all_tools().await.unwrap();
    for n in ["get_input_guide", "get_input_recipe"] {
        let t = tools
            .iter()
            .find(|t| t.name == n)
            .unwrap_or_else(|| panic!("{n} がありません"));
        let a = t.annotations.as_ref().unwrap();
        assert_eq!(a.read_only_hint, Some(true), "{n}");
        check_schema_snapshot(&tools, n);
    }
    let info = c.peer_info().unwrap();
    assert!(info
        .instructions
        .as_deref()
        .unwrap_or("")
        .contains("get_input_recipe"));

    // 形の決まり・区分の一覧・骨組み（そのまま計算できる）
    let g = call_ok(&c, "get_input_guide", json!({})).await;
    assert!(g.to_string().len() < 16 * 1024);
    assert!(g["rules"].as_array().unwrap().len() >= 5);
    assert_eq!(g["freshIds"].as_array().unwrap().len(), 8);
    let skeleton = g["skeleton"].clone();
    let base = call_ok(
        &c,
        "calculate",
        json!({ "input": skeleton, "omit": ["pension"] }),
    )
    .await;
    assert!(base["years"].as_array().unwrap().len() > 40);

    // 区分ごとの説明（短く、例つき）
    for s in [
        "members",
        "employmentPeriods",
        "accounts",
        "residences",
        "debts",
        "goals",
        "livingExpenses",
        "assumptions",
        "contingencies",
        "/household/residences/purchase",
        "/household/debts/prepayments",
    ] {
        let v = call_ok(&c, "get_input_guide", json!({ "section": s })).await;
        let n = v.to_string().len();
        assert!(n < 16 * 1024, "{s}: {n} バイト");
        assert!(v["fields"].is_array(), "{s}: {v}");
    }
    let pp = call_ok(
        &c,
        "get_input_guide",
        json!({ "section": "/household/debts/prepayments" }),
    )
    .await;
    assert!(
        pp["fields"].as_array().unwrap().iter().any(|f| f
            .as_str()
            .unwrap()
            .starts_with("mode*: 選択 shortenTerm|reducePayment")),
        "{pp}"
    );
    let (err, msg) = call(
        &c,
        "get_input_guide",
        json!({ "section": "/household/nope" }),
    )
    .await;
    assert!(err && msg.contains("使える欄"), "{msg}");

    // 手本を重ねる（apply で受け取った input を次の手本へ）: 子が生まれる → 家を買う → 繰上返済 → NISA・iDeCo → 万一の想定
    let mut input = skeleton.clone();
    let mut calls = 0;
    for (recipe, params) in [
        (
            "newChild",
            json!({ "birth": "2027-06", "course": "public" }),
        ),
        (
            "buyHome",
            json!({ "at": "2029-04", "price": 45_000_000, "downPayment": 5_000_000 }),
        ),
        (
            "prepayment",
            json!({ "at": "2032-04", "amount": 3_000_000 }),
        ),
        (
            "startNisaIdeco",
            json!({ "nisaMonthly": 30_000, "idecoMonthly": 20_000 }),
        ),
        (
            "contingency",
            json!({ "kind": "death", "occurs": "2033-04", "protection": true }),
        ),
    ] {
        let r = call_ok(
            &c,
            "get_input_recipe",
            json!({ "recipe": recipe, "input": input, "params": params, "apply": true }),
        )
        .await;
        calls += 1;
        assert!(!r["changes"].as_array().unwrap().is_empty(), "{recipe}");
        assert!(!r["notes"].as_array().unwrap().is_empty(), "{recipe}");
        // changes を元の入力に当てて計算しても通る
        let alone = call(
            &c,
            "calculate",
            json!({ "input": input, "changes": r["changes"], "omit": ["pension"] }),
        )
        .await;
        assert!(!alone.0, "{recipe}: {}", alone.1);
        input = r["input"].clone();
    }
    let all = call_ok(&c, "calculate", json!({ "input": input, "omit": ["pension"], "output": "table", "rows": ["cf.expense.housing.purchase", "cf.expense.education", "cf.income.benefit.childAllowance", "cf.expense.housing.loan.prepayment", "cf.transfer.ideco", "cf.income.pension.survivor"] })).await;
    let rows: Vec<&str> = all["table"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["row"].as_str())
        .collect();
    for want in [
        "cf.expense.housing.purchase.downPayment",
        "cf.expense.housing.purchase.costs",
        "cf.expense.education.school",
        "cf.income.benefit.childAllowance",
        "cf.expense.housing.loan.prepayment",
        "cf.transfer.ideco.ideco",
        "cf.income.pension.survivor",
    ] {
        assert!(rows.contains(&want), "{want} が表にありません");
    }
    assert!(calls <= 5);

    // 一から書いた素朴な入力: 1回の答えに、足りない欄・UUID・値の箱・年ごとの列・時点・選べる値の直し方がまとめて出る（値は写さない）
    let naive = json!({
        "baseMonth": "2026-10", "endYear": 2070,
        "household": {
            "members": [{ "id": "self", "kind": "self", "birth": "1988-05", "sex": "male" }],
            "employmentPeriods": [{ "member": "self", "type": "regular", "from": "2011-04", "to": "2053-04", "salary": { "annual": 5_123_456 } }],
            "accounts": [{ "kind": "deposit", "owner": "self", "marketValue": 5_000_000 }],
            "residences": [{ "kind": "rental", "from": { "at": "2018-04" }, "to": null, "rent": { "monthly": { "value": 110_000, "state": "confirmed", "origin": { "kind": "manual" } } } }]
        },
        "assumptions": { "investmentReturn": 0.02 }
    });
    let (err, msg) = call(&c, "calculate", json!({ "input": naive })).await;
    assert!(err);
    for want in [
        "E_INPUT_SCHEMA",
        "calcConventions",
        "UUID 第4版",
        "値の箱",
        "{\"default\"",
        "{\"at\"",
        "rent|own",
        "relations",
        "生年月",
        "get_input_guide",
    ] {
        assert!(msg.contains(want), "{want} がありません: {msg}");
    }
    assert!(
        !msg.contains("5123456") && !msg.contains("rental"),
        "値を写さない: {msg}"
    );
    assert!(msg.len() < 8 * 1024, "{}", msg.len());

    // 世帯のどの物とも合わない ID（形は合っている）
    let mut wrong = skeleton.clone();
    wrong["household"]["accounts"][0]["owner"] = json!("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
    let (err, msg) = call(&c, "calculate", json!({ "input": wrong })).await;
    if err {
        assert!(msg.contains("/household/accounts/0/owner"), "{msg}");
    }

    // changes の誤りにも目安を添える
    let (err, msg) = call(&c, "calculate", json!({ "input": skeleton, "changes": [{ "op": "add", "path": "/household/goals/-", "value": {} }] })).await;
    assert!(err && msg.contains("配列ごと add"), "{msg}");

    // 手本の一覧・知らない手本・知らない params・当てられない世帯
    let list = call_ok(&c, "get_input_recipe", json!({})).await;
    assert_eq!(list["recipes"].as_array().unwrap().len(), RECIPES.len());
    let (err, msg) = call(
        &c,
        "get_input_recipe",
        json!({ "recipe": "nope", "input": skeleton }),
    )
    .await;
    assert!(err && msg.contains("buyHome"), "{msg}");
    let (err, msg) = call(
        &c,
        "get_input_recipe",
        json!({ "recipe": "buyHome", "input": skeleton, "params": { "prise": 1 } }),
    )
    .await;
    assert!(err && msg.contains("使える params"), "{msg}");
    let (err, msg) = call(
        &c,
        "get_input_recipe",
        json!({ "recipe": "prepayment", "input": skeleton }),
    )
    .await;
    assert!(err && msg.contains("負債"), "{msg}");
    let (err, msg) = call(&c, "get_input_recipe", json!({ "recipe": "buyHome" })).await;
    assert!(err && msg.contains("どれか1つ"), "{msg}");

    c.cancel().await.unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

/// 手本は、見本の世帯のどれに当てても計算が通る（当てられない世帯〔負債が無い・働き方の期間が無い〕は理由を返す）
#[tokio::test(flavor = "multi_thread")]
async fn every_recipe_calculates_on_every_model_household() {
    let dir = temp_dir("recipes");
    let c = connect(&dir).await;
    let ids = model_ids();
    for recipe in RECIPES {
        let mut applied = 0;
        for id in &ids {
            let (err, text) = call(
                &c,
                "get_input_recipe",
                json!({ "recipe": recipe, "sample_household_id": id }),
            )
            .await;
            if err {
                assert!(
                    (recipe == "prepayment" && text.contains("負債"))
                        || (recipe == "retire" && text.contains("働き方の期間")),
                    "{recipe} × {id}: {text}"
                );
                continue;
            }
            let r: Value = serde_json::from_str(&text).unwrap();
            let (err, out) = call(&c, "calculate", json!({ "sample_household_id": id, "changes": r["changes"], "from_year": 2030, "to_year": 2030, "omit": ["pension"] })).await;
            assert!(!err, "{recipe} × {id}: {out}");
            applied += 1;
        }
        assert!(applied >= 10, "{recipe}: {applied}");
    }
    c.cancel().await.unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

/// 渡された世帯（share_id）にも手本を当てられ、同じ共有で計算できる。読んだことは「AIに渡した記録」に残る
#[tokio::test(flavor = "multi_thread")]
async fn recipe_for_a_shared_household() {
    let dir = temp_dir("recipe-share");
    let clock = ManualClock::new(1_792_198_923_000);
    let reg = Arc::new(ShareRegistry::with_clock(Arc::new(clock.clone())));
    let ep = AppEndpoint::start(reg.clone(), VERSION, &dir).unwrap();
    let c = connect(&dir).await;
    let s = std::fs::read_to_string(repo().join("data/modelHouseholds/salariedCoupleTwoKids.json"))
        .unwrap();
    let input = serde_json::from_str::<Value>(&s).unwrap()["input"].clone();
    let source = SharedHouseholdSource {
        household_id: "5b0c9e4e-1f1a-4b8e-9a51-3d2f7c6e8a90".into(),
        customer_number: None,
        revision: "rev-1".into(),
        input,
        texts: vec![],
        labels_by_member: None,
        post_retirement: None,
        external_ai_consent: Some(ConsentRef {
            decision: ConsentDecision::Given,
            record_id: "c-1".into(),
            documents: true,
        }),
        fictional: false,
    };
    let g = reg
        .grant(
            source,
            GrantOptions {
                destination_declared: "Claude Code".into(),
                ..GrantOptions::default()
            },
        )
        .unwrap();
    let r = call_ok(&c, "get_input_recipe", json!({ "recipe": "prepayment", "share_id": g.share_id, "params": { "amount": 2_000_000 } })).await;
    assert_eq!(r["shareId"], g.share_id.as_str());
    let out = call_ok(&c, "calculate", json!({ "share_id": g.share_id, "changes": r["changes"], "omit": ["pension"], "output": "table", "rows": ["cf.expense.housing.loan.prepayment"] })).await;
    let total: i64 = out["table"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|x| x["amount"].as_i64())
        .sum();
    assert_eq!(total, 2_000_000);
    let rec = reg.records("5b0c9e4e-1f1a-4b8e-9a51-3d2f7c6e8a90");
    let tools: Vec<&str> = rec[0].reads.iter().map(|x| x.tool.as_str()).collect();
    assert_eq!(tools, vec!["get_input_recipe", "calculate"]);
    // 答えに世帯の内部 ID は出ない（仮の ID だけ）
    assert!(!r
        .to_string()
        .contains("5b0c9e4e-1f1a-4b8e-9a51-3d2f7c6e8a90"));
    ep.shutdown();
    c.cancel().await.unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}
