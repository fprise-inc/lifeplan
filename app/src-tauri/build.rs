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
    // 0034: 明細の取り込み（明細のファイルを開く・覚えた辞書と形・確認シートの保存と読み込み。パスもファイル名も受け取らない・返さない）
    "statement_office",
    "statement_learn",
    "statement_open",
    "statement_sheet_save",
    "statement_sheet_open",
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
    // 0073: 事務所の既定値（事務所データに暗号化して持つ。JSON のオブジェクトだけ）
    "office_defaults_get",
    "office_defaults_put",
    // 0110: 機能を有効にするコード（入れる・外す・今の状態。確かめるのは本体。コードの文字列は画面に返さない）
    "feature_codes_status",
    "feature_code_add",
    "feature_code_remove",
    // 0110 の追記: 止めた一覧を今すぐ確かめる・AIからのコードの候補を入れるか捨てる（0015 の追記の2段目）
    "feature_codes_check",
    "feature_code_candidate_decide",
    // 0110 の追記（2026-11-02）: 期限の切れた・止めたコードの知らせを閉じる（コードは外さない）
    "feature_code_notice_dismiss",
    // 0016 の追記（2026-11-02）: カスタム層の説明の文の差し替え（状態・当てる文・承認する・しない・公式の文に戻す・更新で変わった行の確かめ・
    // 台帳の作り直し）と、カスタム層の場所（本体のダイアログで選ぶ・既定に戻す・フォルダを作る）。パスは受け取らない
    "custom_texts_status",
    "custom_texts_approve",
    "custom_texts_decline",
    "custom_texts_revert",
    "custom_texts_rows",
    "custom_ledger_reset",
    "custom_dir_choose",
    "custom_dir_reset",
    "custom_dir_create",
    "store_fork_info",
    "store_fork_resolve",
    "store_sync_copies_resolve",
    "store_leave",
    // 0024: 1人の FP が複数の PC で使う同期フォルダ（同期フォルダは本体のダイアログで選ばせる。パスも鍵も受け取らない・返さない）
    "storage_sync_start",
    "storage_sync_open",
    "storage_sync_end",
    "storage_notices",
    // 0087: お知らせの一覧（配信元のお知らせを読む口・手元の既読の印と受付番号）と、要望・不具合のフォームを開く（受付番号だけを受け取る）
    "notices_feed",
    "notice_local_get",
    "notice_local_put",
    "feedback_form_open",
    "feedback_copy",
    "app_close_ready",
    "app_close_cancel",
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

/// 配布元の設定（config/distribution.toml）の `[feedback]` の `form`（要望・不具合のフォームの URL のひな形。0087）。
/// TOML の部品は入れず、この1行の形（`form = "…"`）だけを読む
fn feedback_form(toml: &str) -> String {
    let mut in_section = false;
    for line in toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_section = t == "[feedback]";
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some(rest) = t.strip_prefix("form") {
            let v = rest
                .trim_start()
                .strip_prefix('=')
                .map(str::trim)
                .unwrap_or("");
            let v = v
                .strip_prefix('"')
                .and_then(|x| x.strip_suffix('"'))
                .unwrap_or_else(|| {
                    panic!("config/distribution.toml: [feedback] の form は \"…\" で書く")
                });
            if !v.starts_with("https://") || !v.contains("{受付番号}") || v.contains('\\') {
                panic!("config/distribution.toml: [feedback] の form は https:// で始め、{{受付番号}} を入れる");
            }
            let mut rest = v;
            while let Some(i) = rest.find('{') {
                let end = rest[i..].find('}').map(|j| i + j + 1).unwrap_or(rest.len());
                if !["{受付番号}", "{版}", "{OS}"].contains(&&rest[i..end]) {
                    panic!("config/distribution.toml: [feedback] の form に差し込めるのは {{受付番号}}・{{版}}・{{OS}} だけ");
                }
                rest = &rest[end..];
            }
            return v.to_owned();
        }
    }
    panic!("config/distribution.toml に [feedback] の form がありません");
}

/// 配布元の設定の `[section]` の公開鍵の並び（読み方は配布の部品の `distribution::config`。提供元の道具と同じ）。
/// 中身の形（鍵の名前・公開鍵・本番と開発用の名前の決まり・役割をまたいだ重なり）は、配布の部品の鍵の束（`distribution::keys`）で確かめる
fn key_list(toml: &str, section: &str, name: &str) -> Vec<String> {
    distribution::config::key_list(toml, section, name).unwrap_or_else(|e| panic!("{e}"))
}

/// 本体が自動で取りに行く一覧の URL（`[endpoints]` の `name`）と `host`。https で、host のものだけ。クエリ・転送の印は付けない
fn endpoint(toml: &str, name: &str) -> (String, String) {
    distribution::config::endpoint_url(toml, name).unwrap_or_else(|e| panic!("{e}"))
}

fn str_lists(v: &[Vec<String>]) -> Vec<Vec<&str>> {
    v.iter()
        .map(|l| l.iter().map(String::as_str).collect())
        .collect()
}

/// 役割の順（app_update・data・auto_delivery・revocation・feature_code・feature_code_revocation）に並べた鍵の並びを、配布の部品の書き方にする
fn key_config<'a>(v: &'a [Vec<&'a str>]) -> distribution::keys::KeyConfig<'a> {
    distribution::keys::KeyConfig {
        app_update: &v[0],
        data: &v[1],
        auto_delivery: &v[2],
        revocation: &v[3],
        feature_code: &v[4],
        feature_code_revocation: &v[5],
    }
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

    // 0087: 要望・不具合のフォームのひな形（config/distribution.toml の1か所から写す）
    let dist = repo.join("config/distribution.toml");
    println!("cargo:rerun-if-changed={}", dist.display());
    let form = feedback_form(&std::fs::read_to_string(&dist).unwrap());
    std::fs::write(
        out_dir.join("distribution.rs"),
        format!("/// 要望・不具合のフォームの URL のひな形（config/distribution.toml の [feedback] の form）\npub const FEEDBACK_FORM: &str = {form:?};\n"),
    )
    .unwrap();

    // 0117・0110 の追記（2026-11-04）: 鍵の束（[keys] の本番の鍵と、開発用のビルドだけ [dev_keys] の開発用の鍵）と、
    // 取り下げの一覧の場所（[endpoints] の revocations）・コードを止めるだけの一覧の場所（feature_code_revocations。0117 の追記の2）・
    // 自動通信の相手のホスト（host）。鍵の形は配布の部品の鍵の束で確かめる（本体の起動のときと同じ決まり）。
    // 製品のビルド（release）には開発用の鍵を入れない（試しの鍵で発行したコードを製品で受け付けない）
    let toml = std::fs::read_to_string(&dist).unwrap();
    let (host, url) = endpoint(&toml, "revocations");
    let (_, code_url) = endpoint(&toml, "feature_code_revocations");
    const ROLES: [&str; 6] = [
        "app_update",
        "data",
        "auto_delivery",
        "revocation",
        "feature_code",
        "feature_code_revocation",
    ];
    let release = std::env::var("PROFILE").is_ok_and(|p| p == "release");
    let prod: Vec<Vec<String>> = ROLES.iter().map(|r| key_list(&toml, "keys", r)).collect();
    let dev: Vec<Vec<String>> = ROLES
        .iter()
        .map(|r| {
            if release {
                vec![]
            } else {
                key_list(&toml, "dev_keys", r)
            }
        })
        .collect();
    let (p, d) = (str_lists(&prod), str_lists(&dev));
    let ring = distribution::keys::KeyRing::from_config(&key_config(&p))
        .unwrap_or_else(|e| panic!("config/distribution.toml: {e}"));
    ring.with_dev(&key_config(&d))
        .unwrap_or_else(|e| panic!("config/distribution.toml: {e}"));
    let mut keys_rs = String::new();
    for (i, r) in ROLES.iter().enumerate() {
        let up = r.to_uppercase();
        writeln!(
            keys_rs,
            "/// 本番の公開鍵（config/distribution.toml の [keys] の {r}）\npub const KEYS_{up}: &[&str] = &{:?};",
            prod[i]
        )
        .unwrap();
        // アプリ更新用は開発用の鍵を持たない（with_dev が断る）
        if *r != "app_update" {
            writeln!(
                keys_rs,
                "/// 開発用の公開鍵（[dev_keys] の {r}。製品のビルドでは空）\npub const DEV_KEYS_{up}: &[&str] = &{:?};",
                dev[i]
            )
            .unwrap();
        }
    }
    writeln!(
        keys_rs,
        "/// 取り下げの一覧の場所（config/distribution.toml の [endpoints] の revocations）\npub const REVOCATIONS_URL: &str = {url:?};\n\
         /// 機能を有効にするコードを止めるだけの一覧の場所（[endpoints] の feature_code_revocations）\npub const FEATURE_CODE_REVOCATIONS_URL: &str = {code_url:?};\n\
         /// 自動通信の相手のホスト（config/distribution.toml の [endpoints] の host。0017 の4）\npub const DISTRIBUTION_HOST: &str = {host:?};"
    )
    .unwrap();
    std::fs::write(out_dir.join("dist_keys.rs"), keys_rs).unwrap();

    // 0016 の追記（2026-11-02）: 説明の一覧・名前の一覧・欄の一覧（画面のビルドの段 npm run prepare-assets が画面の定義から作る）
    for name in [
        "texts-catalog.json",
        "terms-catalog.json",
        "fields-catalog.json",
    ] {
        let catalog = manifest_dir.join("../src/generated").join(name);
        if !catalog.exists() {
            panic!("一覧（app/src/generated/{name}）がありません。先に app/ で `npm run prepare-assets` を流してください");
        }
        println!("cargo:rerun-if-changed={}", catalog.display());
        std::fs::copy(&catalog, out_dir.join(name)).unwrap();
    }

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build");
}
