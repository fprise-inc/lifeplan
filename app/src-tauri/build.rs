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
    "proposal_render",
    "proposal_page",
    "proposal_save",
    "proposal_discard",
    "hearing_save",
    "hearing_open",
    // 0030: 持ち帰り用のレポートの保存（画面が作った HTML を受け取る。パスは受け取らない・返さない）
    "takeaway_save",
    // 0011・0013: 世帯ファイルの保存と暗号化（パスは受け取らない。世帯は内部IDだけで指す）
    "store_status",
    "store_list",
    "store_create",
    "store_open",
    "store_save",
    "store_rename",
    "store_delete",
    "recovery_key_show",
    "recovery_key_acknowledge",
    "recovery_key_test",
    "recovery_key_restore",
    "store_keystore",
    // 0033: 顧客番号の区分と通し番号・見本の棚（世帯は内部IDだけで指す）
    "store_list_samples",
    "store_set_category",
    "store_assign_serial",
    "store_make_sample",
    "store_update_sample",
    "store_categories",
    "store_set_categories",
    // 0014・0015: AI接続口（事務所の設定・世帯ごとの同意・共有・記録・候補の判断。パスも鍵も受け取らない・返さない）
    "ai_status",
    "ai_set_enabled",
    "ai_setup_copy",
    "ai_household",
    "ai_consent_record",
    "ai_share_start",
    "ai_share_stop",
    "ai_candidate_decide",
    // 0023: 事務所での共有（共有フォルダは本体のダイアログで選ばせる。パスも鍵も受け取らない・返さない）
    "office_status",
    "office_start",
    "office_join",
    "office_cancel",
    "office_approve",
    "office_reject",
    "office_remove",
    "office_move_local",
    "office_recover",
    "office_end",
    "office_dismiss_notices",
    "store_fork_info",
    "store_fork_resolve",
    "store_sync_copies_resolve",
    "store_leave",
    // 0024: 1人の FP が複数の PC で使う同期フォルダ（同期フォルダは本体のダイアログで選ばせる。パスも鍵も受け取らない・返さない）
    "storage_sync_start",
    "storage_sync_open",
    "storage_sync_end",
    "storage_notices",
    "app_close_ready",
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
