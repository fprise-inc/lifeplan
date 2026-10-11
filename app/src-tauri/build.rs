// ビルドの時に、計算エンジンのまとめた JS・制度データのパック・架空のモデル世帯を埋め込む一覧を作り、
// Tauri の命令の許可（capabilities で使う allow-<命令>）を作る。
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// 画面から呼べる命令（0016 の1: アプリが自分で定義した命令だけ。capabilities/main.json に載せたものだけが呼べる）
const COMMANDS: &[&str] = &[
    "engine_packs",
    "list_households",
    "open_household",
    "compute",
    "evidence",
];

fn list_json(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{} を読めません: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    v.sort();
    v
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
    println!("cargo:rerun-if-changed={}", engine_js.display());
    println!("cargo:rerun-if-changed={}", regulation.display());
    println!("cargo:rerun-if-changed={}", households.display());

    let mut out = String::new();
    writeln!(
        out,
        "/// 計算エンジンのまとめた JS（engine/dist/engine.js）\npub const ENGINE_JS: &str = include_str!({:?});",
        engine_js.display().to_string()
    )
    .unwrap();
    out.push_str("/// 制度データ・マスタのパック（engine/dist/regulation/*.json。名前の順）\npub const PACKS: &[&str] = &[\n");
    for p in list_json(&regulation) {
        println!("cargo:rerun-if-changed={}", p.display());
        writeln!(out, "    include_str!({:?}),", p.display().to_string()).unwrap();
    }
    out.push_str("];\n");
    out.push_str("/// 架空のモデル世帯（data/modelHouseholds/*.json。CC0）: (ID, 要求の JSON)\npub const HOUSEHOLDS: &[(&str, &str)] = &[\n");
    for p in list_json(&households) {
        println!("cargo:rerun-if-changed={}", p.display());
        let id = p.file_stem().unwrap().to_string_lossy().to_string();
        writeln!(
            out,
            "    ({id:?}, include_str!({:?})),",
            p.display().to_string()
        )
        .unwrap();
    }
    out.push_str("];\n");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("assets.rs"), out).unwrap();

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build");
}
