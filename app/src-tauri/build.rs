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

/// 配布元の設定の `[section]` の `name = …` の値（右辺の文字列のまま）。TOML の部品は入れず、1行の形だけを読む。
/// 名前はちょうど同じものだけ（`feature_code` と `feature_code_revocation` を取り違えない）
fn toml_value<'a>(toml: &'a str, section: &str, name: &str) -> Option<&'a str> {
    let mut in_section = false;
    for line in toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_section = t == format!("[{section}]");
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((k, v)) = t.split_once('=') else {
            continue;
        };
        if k.trim() == name {
            return Some(v.trim());
        }
    }
    None
}

/// 配布元の設定の `[keys]` の公開鍵の並び（`name = ["鍵の名前:公開鍵", …]` の1行の配列）。0110 の機能を有効にするコード（`feature_code`）と、
/// その止めた一覧（`feature_code_revocation`）。形（鍵の名前は英小文字・数字・「-」、公開鍵は 32バイトの base64url の43文字）を確かめる。
/// 中身の鍵としての確かめは本体の起動のとき
fn key_list(toml: &str, name: &str) -> Vec<String> {
    let Some(v) = toml_value(toml, "keys", name) else {
        return vec![];
    };
    let inner = v
        .strip_prefix('[')
        .and_then(|x| x.strip_suffix(']'))
        .unwrap_or_else(|| {
            panic!("config/distribution.toml: [keys] の {name} は1行の [\"…\"] で書く")
        });
    let keys: Vec<String> = inner
        .split(',')
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(|x| {
            x.strip_prefix('"')
                .and_then(|y| y.strip_suffix('"'))
                .unwrap_or_else(|| {
                    panic!("config/distribution.toml: [keys] の {name} の値は \"…\" で書く")
                })
                .to_owned()
        })
        .collect();
    for k in &keys {
        let ok = k.split_once(':').is_some_and(|(kid, b)| {
            (1..=16).contains(&kid.len())
                && kid
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                && b.len() == 43
                && b.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        });
        if !ok {
            panic!("config/distribution.toml: [keys] の {name} の {k:?} は「鍵の名前:公開鍵（base64url の43文字）」の形にする");
        }
    }
    keys
}

/// 配布元の設定の `[endpoints]` の `host` と、止めた一覧の URL（0110 の追記）。URL は https で、host のものだけ。クエリ・転送の印は付けない
fn revocations_endpoint(toml: &str) -> (String, String) {
    let unquote = |name: &str| {
        let v = toml_value(toml, "endpoints", name).unwrap_or_else(|| {
            panic!("config/distribution.toml に [endpoints] の {name} がありません")
        });
        v.strip_prefix('"')
            .and_then(|x| x.strip_suffix('"'))
            .unwrap_or_else(|| {
                panic!("config/distribution.toml: [endpoints] の {name} は \"…\" で書く")
            })
            .to_owned()
    };
    let host = unquote("host");
    let url = unquote("feature_code_revocations");
    let rest = url.strip_prefix("https://").unwrap_or_else(|| {
        panic!("config/distribution.toml: [endpoints] の feature_code_revocations は https:// で始める")
    });
    let (h, path) = rest.split_once('/').unwrap_or((rest, ""));
    if h != host || path.is_empty() || url.contains(['?', '#', '@', '\\', ' ']) {
        panic!("config/distribution.toml: [endpoints] の feature_code_revocations は https://{host}/… の形にする（ほかのホスト・クエリは使わない）");
    }
    (host, url)
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

    // 0110: 機能を有効にするコードの公開鍵（config/distribution.toml の [keys] の feature_code から写す）と、
    // 止めた一覧の公開鍵（feature_code_revocation）・場所（[endpoints] の feature_code_revocations）・自動通信の相手のホスト（host）
    let toml = std::fs::read_to_string(&dist).unwrap();
    let (host, url) = revocations_endpoint(&toml);
    std::fs::write(
        out_dir.join("feature_keys.rs"),
        format!(
            "/// 機能を有効にするコードの公開鍵（config/distribution.toml の [keys] の feature_code。「鍵の名前:公開鍵」）\npub const FEATURE_CODE_KEYS: &[&str] = &{:?};\n\
             /// 止めた一覧の公開鍵（config/distribution.toml の [keys] の feature_code_revocation）\npub const FEATURE_REVOCATION_KEYS: &[&str] = &{:?};\n\
             /// 止めた一覧の場所（config/distribution.toml の [endpoints] の feature_code_revocations）\npub const FEATURE_REVOCATIONS_URL: &str = {url:?};\n\
             /// 自動通信の相手のホスト（config/distribution.toml の [endpoints] の host。0017 の4）\npub const DISTRIBUTION_HOST: &str = {host:?};\n",
            key_list(&toml, "feature_code"),
            key_list(&toml, "feature_code_revocation"),
        ),
    )
    .unwrap();

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build");
}
