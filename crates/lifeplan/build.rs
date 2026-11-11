// ビルドの時に、計算エンジンのまとめた JS・制度データのパック・架空のモデル世帯（と、その説明）を埋め込む一覧を作る（アプリ本体の build.rs と同じもの）。
// AI接続口だけのものとして、「数字の根拠」の読み方（画面と同じ関数をまとめた JS。dist/explain.js）と対応範囲の一覧（engine/dist/coverage.json）も埋め込む（0183）
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

fn list_json(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{} を読めません: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    v.sort();
    v
}

/// data/modelHouseholds/README.md の表（| `<ID>.json` | 説明 |）から、世帯ごとの説明を読む
fn descriptions(readme: &Path) -> Vec<(String, String)> {
    let text = std::fs::read_to_string(readme).unwrap_or_default();
    text.lines()
        .filter_map(|l| {
            let rest = l.strip_prefix("| `")?;
            let (file, rest) = rest.split_once(".json` |")?;
            let desc = rest.trim().trim_end_matches('|').trim();
            Some((file.to_owned(), desc.to_owned()))
        })
        .collect()
}

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest_dir.join("../..").canonicalize().unwrap();
    let engine_js = repo.join("engine/dist/engine.js");
    let regulation = repo.join("engine/dist/regulation");
    let households = repo.join("data/modelHouseholds");
    if !engine_js.exists() || !regulation.exists() {
        panic!(
            "計算エンジンのまとめた JS（engine/dist/engine.js）と制度データ（engine/dist/regulation/）がありません。先に engine/ で `npm ci && npm run build` を流してください"
        );
    }
    let explain_js = manifest_dir.join("dist/explain.js");
    let plan_js = manifest_dir.join("dist/plan.js");
    let coverage = repo.join("engine/dist/coverage.json");
    if !explain_js.exists() || !plan_js.exists() {
        panic!(
            "AI接続口の「数字の根拠」の読み方とプランの動かす項目（crates/lifeplan/dist/explain.js・plan.js）がありません。先に app/ で `npm ci && npm run build:explain` を流してください"
        );
    }
    if !coverage.exists() {
        panic!(
            "対応範囲の一覧（engine/dist/coverage.json）がありません。先に engine/ で `npm run build` を流してください"
        );
    }
    println!("cargo:rerun-if-changed={}", explain_js.display());
    println!("cargo:rerun-if-changed={}", plan_js.display());
    println!("cargo:rerun-if-changed={}", coverage.display());
    println!("cargo:rerun-if-changed={}", engine_js.display());
    println!("cargo:rerun-if-changed={}", regulation.display());
    println!("cargo:rerun-if-changed={}", households.display());
    let readme = households.join("README.md");
    println!("cargo:rerun-if-changed={}", readme.display());
    let desc = descriptions(&readme);

    let mut out = String::new();
    writeln!(
        out,
        "/// 計算エンジンのまとめた JS（engine/dist/engine.js）\npub const ENGINE_JS: &str = include_str!({:?});",
        engine_js.display().to_string()
    )
    .unwrap();
    writeln!(
        out,
        "/// 「数字の根拠」の読み方（app/src/connector/explain.ts をまとめた JS。0183）\npub const EXPLAIN_JS: &str = include_str!({:?});\n/// 対応範囲の一覧（docs/coverage を確かめて1つにした JSON。0183）\npub const COVERAGE_JSON: &str = include_str!({:?});",
        explain_js.display().to_string(),
        coverage.display().to_string()
    )
    .unwrap();
    writeln!(
        out,
        "/// プランの動かす項目（app/src/connector/plan.ts をまとめた JS。画面の結果のタブのプランと同じ関数。0195）\npub const PLAN_JS: &str = include_str!({:?});",
        plan_js.display().to_string()
    )
    .unwrap();
    out.push_str("/// 制度データ・マスタのパック（engine/dist/regulation/*.json。名前の順）\npub const PACKS: &[&str] = &[\n");
    for p in list_json(&regulation) {
        println!("cargo:rerun-if-changed={}", p.display());
        writeln!(out, "    include_str!({:?}),", p.display().to_string()).unwrap();
    }
    out.push_str("];\n");
    out.push_str("/// 架空のモデル世帯（data/modelHouseholds/*.json。CC0）: (ID, 説明, 要求の JSON)\npub const HOUSEHOLDS: &[(&str, &str, &str)] = &[\n");
    for p in list_json(&households) {
        println!("cargo:rerun-if-changed={}", p.display());
        let id = p.file_stem().unwrap().to_string_lossy().to_string();
        let d = desc
            .iter()
            .find(|(f, _)| *f == id)
            .map(|(_, d)| d.clone())
            .unwrap_or_default();
        writeln!(
            out,
            "    ({id:?}, {d:?}, include_str!({:?})),",
            p.display().to_string()
        )
        .unwrap();
    }
    out.push_str("];\n");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("assets.rs"), out).unwrap();
}
