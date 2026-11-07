//! AI接続口をアプリにつなぐ（0014・0015・0016）。中身は ai-share（共有の台帳・縮約版・記録・同意・候補）。
//!
//! - **事務所全体の設定**: AI接続口を使うかどうか（既定はオフ。事務所データに暗号化して保存）。オンのときだけ、
//!   アプリ本体の受け口（そのOSユーザー専用のソケット・`app.json`）を開ける。オフにすると、すべての共有を取り消して口を閉じる。
//! - **世帯ごとの同意**: 外部AIへの提供の同意の記録（0014 の2）。同意が `given` の世帯だけを渡せる（共有の台帳の
//!   `require_consent`。0014 の6 より保守的な側）。撤回すると、その世帯の共有をすぐに取り消す。
//! - **世帯を渡す**: FPが画面で「AIに渡す」を押したときだけ、期限つきの共有を作る（既定60分・最長8時間）。渡るのは縮約版だけ
//!   （FPのメモなどの文章は渡さない）。世帯の中身は、保存した本文（本体が復号したもの）から作る。
//! - **記録**: 世帯ファイルの `consents`・`consentExplanations`・`aiShares`・`candidates` は本体だけが書く。画面から届いた本文に
//!   これらの区画が入っていても使わない（ai-share の `HouseholdBook`）。読まれた記録・届いた候補は、裏の見回りが世帯ファイルへ書き戻す。
//! - **候補**: AIの出したプランの候補は `candidates` に承認待ちで入るだけ。FPが画面で「プランとして保存」か「捨てる」を選んだ記録を残す。
//! - **書類から読んだ値の候補**（0151）: 届いた答えはメモリの中だけに置き、世帯ファイルには書かない（番号が混ざっていても残さない）。
//!   画面が「同意とAIの記録」で受け取り、読み口（番号を落とす決まり）を通して読み取りの記録（本文の区画 `documents`）にしてから、
//!   `ai_documents_taken` で承認待ちから外す。
//!
//! 画面（WebView）には、鍵・パス（データフォルダ・作業フォルダ・接続口の実行ファイル）を渡さない（0016 の1）。
//! 接続の設定の文面は、場所を `<接続口の場所>` に伏せた形で見せ、本物の場所の入った文面は本体が OS のクリップボードに写す。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use ai_share::clock::{iso8601, Clock, SystemClock};
use ai_share::registry::ShareStatus;
use ai_share::{
    AppEndpoint, ExternalAiConsentInput, GrantError, GrantOptions, HouseholdAiView, HouseholdBook,
    Scope, ShareRegistry,
};
use household_store::{Opened, Store, StoreError};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::store::StoreState;

/// AIのアプリの設定に書く名前（0015 の10）
const SERVER_NAME: &str = "fprise-lifeplan";
/// 画面に見せる文面で、接続口の場所を伏せる印
const EXE_PLACEHOLDER: &str = "<接続口の場所>";
/// 画面に見せる文面で、開発用の作業フォルダを伏せる印
const RUNTIME_PLACEHOLDER: &str = "<開発用の作業フォルダ>";
/// 共有の期限の選択肢（分。0015 の5: 既定60分・最長8時間）
pub const DURATIONS_MIN: [u32; 5] = [15, 60, 120, 240, 480];
/// 接続先の申告の長さの上限
const MAX_DESTINATION_CHARS: usize = 60;
/// 裏の見回りの間隔（期限切れを閉じる・届いた候補を入れる・記録を世帯ファイルへ書き戻す）
const TICK: Duration = Duration::from_secs(2);

struct Entry {
    book: HouseholdBook,
    /// 世帯の一覧に出す構成の要約（保存のときに要る）
    summary: String,
}

pub struct AiState {
    registry: Arc<ShareRegistry>,
    /// 開いた世帯ごとの帳面。帳面を変えるときと、世帯ファイルへ書き戻すときは、このロックを持ったまま行う
    books: Mutex<HashMap<String, Entry>>,
    endpoint: Mutex<Option<AppEndpoint>>,
    problem: Mutex<Option<String>>,
    runtime_dir: PathBuf,
    app_version: String,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<AiState, Box<dyn std::error::Error>> {
    let registry = Arc::new(ShareRegistry::new());
    registry.require_consent(true);
    // 開発のときだけ（debug のビルド）: 製品と別の作業フォルダを使う（手元で動かしている製品・他の作業ツリーとぶつからないように）
    let runtime_dir = if cfg!(debug_assertions) {
        std::env::var_os("FINANCIA_DEV_RUNTIME_DIR")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or(app.path().app_data_dir()?.join("run-dev"))
    } else {
        ai_ipc::runtime_dir()
    };
    Ok(AiState {
        registry,
        books: Mutex::new(HashMap::new()),
        endpoint: Mutex::new(None),
        problem: Mutex::new(None),
        runtime_dir,
        app_version: app.package_info().version.to_string(),
    })
}

fn now_iso() -> String {
    iso8601(SystemClock.now_ms())
}

/// 同意の日付の「未来ではない」の判定に使う今日（時差の最大の +14時間まで許す）
fn today_upper() -> String {
    iso8601(SystemClock.now_ms() + 14 * 3600 * 1000)[..10].to_owned()
}

fn code(e: StoreError) -> String {
    e.code().to_owned()
}

/// 書いた人（事務所で共有しているときのメンバー。0023 の6）
fn author_of(store: &Store) -> Option<ai_share::Author> {
    store.current_author().map(|a| ai_share::Author {
        member_id: a.member_id,
        name: a.name,
    })
}

// ------------------------------------------------------------------ 世帯の保存とのつなぎ（store.rs から呼ぶ）

impl AiState {
    /// 共有の台帳（機能を有効にするコードの候補も、ここに承認待ちで置く。features.rs が読む）
    pub fn registry(&self) -> &ShareRegistry {
        &self.registry
    }

    /// 世帯を開いた: 帳面を作り（同じ起動で2回目なら、持っている記録を使う）、画面に返す本文からアプリだけが書く区画を外す
    pub fn on_opened(&self, mut o: Opened, summary: String) -> Result<Opened, String> {
        let (book, screen) =
            HouseholdBook::from_opened(&o.id, Some(o.customer_no.clone()), o.generation, &o.body)
                .map_err(str::to_owned)?;
        let mut books = lock(&self.books);
        match books.get_mut(&o.id) {
            Some(e) => {
                e.book.replace_body(&screen).map_err(str::to_owned)?;
                e.book.generation = o.generation;
                e.book.customer_no = Some(o.customer_no.clone());
                e.summary = summary;
            }
            None => {
                if !self.registry.has_records(&o.id) {
                    self.registry
                        .load_records(&o.id, book.file_ai_shares.clone());
                }
                books.insert(o.id.clone(), Entry { book, summary });
            }
        }
        o.body = screen;
        Ok(o)
    }

    /// 画面から届いた本文を保存する（アプリだけが書く区画は帳面の中身で置き換え、追記だけかを確かめてから書く）
    pub fn save(
        &self,
        store: &Store,
        id: &str,
        body: &str,
        summary: &str,
    ) -> Result<household_store::Saved, String> {
        let mut books = lock(&self.books);
        let e = books
            .get_mut(id)
            .ok_or_else(|| code(StoreError::NOT_OPEN))?;
        e.book.replace_body(body).map_err(str::to_owned)?;
        e.summary = summary.to_owned();
        let records = self.registry.records(id);
        let composed = e
            .book
            .compose(&records)
            .map_err(|_| "E_AI_RECORDS".to_owned())?;
        let saved = store.save(id, &composed, summary).map_err(code)?;
        e.book.mark_saved(&records, saved.generation);
        // 共有中なら、渡す中身を新しい世帯に置き換える（同意が無くなっていれば、その場で閉じる）
        if let Some(src) = e.book.source() {
            for sid in self.registry.active_share_ids(id) {
                self.registry.update_source(&sid, src.clone());
            }
        }
        Ok(saved)
    }

    /// 分岐を選んだ後など、世帯ファイルの中身で帳面を作り直すとき: 持っている帳面を捨てる（次の on_opened で作り直す）
    pub fn forget(&self, id: &str) {
        lock(&self.books).remove(id);
    }

    /// 事務所の作業フォルダ（AIの受け口の場所）。共有フォルダに選ばせない場所の1つ（0023 の8）
    pub fn runtime_dir(&self) -> PathBuf {
        self.runtime_dir.clone()
    }

    /// 世帯を完全削除する前: 共有を取り消し、帳面を捨てる（記録は世帯ファイルごと消える。0013 の5）
    pub fn on_deleting(&self, id: &str) {
        for sid in self.registry.active_share_ids(id) {
            self.registry.revoke(&sid);
        }
        lock(&self.books).remove(id);
    }

    /// 帳面のうち、まだ書いていない記録を世帯ファイルへ書き戻す（ロックを持った呼び出し元から）
    fn persist_locked(&self, store: &Store, books: &mut HashMap<String, Entry>) {
        for (id, e) in books.iter_mut() {
            let records = self.registry.records(id);
            if !e.book.is_dirty(&records) {
                continue;
            }
            let Ok(composed) = e.book.compose(&records) else {
                continue; // 追記だけでない記録は書かない（起こらないはずの状態）
            };
            if let Ok(saved) = store.save(id, &composed, &e.summary) {
                e.book.mark_saved(&records, saved.generation);
            }
        }
    }

    fn persist_all(&self, store: &Store) {
        let mut books = lock(&self.books);
        self.persist_locked(store, &mut books);
    }

    /// 裏の見回り（2秒ごと）: 期限切れを閉じ、届いた候補を帳面に入れ、記録を世帯ファイルへ書き戻す
    fn tick(&self, store: &Store, last_revision: &mut u64) {
        self.registry.sweep_expired();
        let proposals = self.registry.take_proposals();
        let revision = self.registry.revision();
        if proposals.is_empty() && revision == *last_revision {
            return;
        }
        let mut books = lock(&self.books);
        for p in proposals {
            if let Some(e) = books.get_mut(&p.household_id) {
                e.book.add_candidate(p);
            }
        }
        self.persist_locked(store, &mut books);
        *last_revision = revision;
    }

    /// 受け口を開ける（設定がオンで、まだ開いていないとき）
    fn ensure_endpoint(&self, store: &Store) {
        let enabled = store.ai_connector_enabled().unwrap_or(false);
        let mut ep = lock(&self.endpoint);
        if !enabled || ep.is_some() {
            return;
        }
        let handle = tauri::async_runtime::handle();
        let _guard = handle.inner().enter();
        match AppEndpoint::start(self.registry.clone(), &self.app_version, &self.runtime_dir) {
            Ok(e) => {
                *ep = Some(e);
                *lock(&self.problem) = None;
            }
            Err(_) => *lock(&self.problem) = Some("E_AI_ENDPOINT".into()),
        }
    }

    /// 受け口を閉じる（すべての共有を閉じ、app.json を消す）
    fn close_endpoint(&self) {
        if let Some(e) = lock(&self.endpoint).take() {
            e.shutdown();
        }
    }

    /// アプリの終了: すべての共有を「アプリの終了」で閉じ、記録を書き戻し、口を閉じる
    pub fn shutdown(&self, store: &Store) {
        self.registry.close_all();
        self.persist_all(store);
        self.close_endpoint();
    }
}

/// 裏の見回りを始める（アプリの起動時に1回）
pub fn start_watch<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = 0u64;
        loop {
            std::thread::sleep(TICK);
            let ai = app.state::<AiState>();
            let store = app.state::<StoreState>();
            ai.tick(&store.store, &mut last);
        }
    });
}

// ------------------------------------------------------------------ 接続口の場所と、接続の設定の文面

/// 接続口の実行ファイル（製品はアプリの実行ファイルと同じフォルダ。開発用のビルドはリポジトリの target も探す）
fn connector_path() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "lifeplan.exe"
    } else {
        "lifeplan"
    };
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
    {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for profile in ["release", "debug"] {
            let p = repo.join("target").join(profile).join(name);
            if p.is_file() {
                return p.canonicalize().ok();
            }
        }
    }
    None
}

/// 接続口の版（`lifeplan --version` の答え。1回だけ確かめる）
fn connector_version(path: &Path) -> Option<String> {
    static V: OnceLock<Option<String>> = OnceLock::new();
    V.get_or_init(|| {
        let out = std::process::Command::new(path)
            .arg("--version")
            .output()
            .ok()?;
        let s = String::from_utf8(out.stdout).ok()?;
        s.trim().strip_prefix("lifeplan ").map(str::to_owned)
    })
    .clone()
}

/// 接続の設定の文面の種類
pub const CLIENTS: [(&str, &str); 3] = [
    ("command", "コマンドで登録するAIアプリ（claude mcp add）"),
    ("json", "JSON の設定ファイル（mcpServers）に書くAIアプリ"),
    ("toml", "TOML の設定ファイル（mcp_servers）に書くAIアプリ"),
];

fn quoted(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

/// 接続の設定の文面。`runtime` は開発用のビルドだけ（作業フォルダを差し替える環境変数）
pub fn setup_text(client: &str, exe: &str, runtime: Option<&str>) -> Option<String> {
    Some(match client {
        "command" => {
            let env = runtime
                .map(|r| format!(" -e {}={}", ai_ipc::discovery::RUNTIME_DIR_ENV, quoted(r)))
                .unwrap_or_default();
            format!(
                "claude mcp add --transport stdio --scope user{env} {SERVER_NAME} -- {} mcp",
                quoted(exe)
            )
        }
        "json" => {
            let mut server = serde_json::json!({ "command": exe, "args": ["mcp"] });
            if let Some(r) = runtime {
                server["env"] = serde_json::json!({ ai_ipc::discovery::RUNTIME_DIR_ENV: r });
            }
            serde_json::to_string_pretty(
                &serde_json::json!({ "mcpServers": { SERVER_NAME: server } }),
            )
            .ok()?
        }
        "toml" => {
            let mut t = format!(
                "[mcp_servers.{SERVER_NAME}]\ncommand = {}\nargs = [\"mcp\"]\n",
                quoted(exe)
            );
            if let Some(r) = runtime {
                t.push_str(&format!(
                    "\n[mcp_servers.{SERVER_NAME}.env]\n{} = {}\n",
                    ai_ipc::discovery::RUNTIME_DIR_ENV,
                    quoted(r)
                ));
            }
            t
        }
        _ => return None,
    })
}

/// OS のクリップボードに写す（画面を通さない。本物の場所の入った文面を画面に渡さないため）
pub(crate) fn copy_to_clipboard(text: &str) -> bool {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let run = |cmd: &str, args: &[&str], bytes: &[u8]| -> bool {
        let Ok(mut child) = Command::new(cmd)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            return false;
        };
        let ok = child
            .stdin
            .take()
            .map(|mut i| i.write_all(bytes).is_ok())
            .unwrap_or(false);
        child.wait().map(|s| s.success()).unwrap_or(false) && ok
    };
    if cfg!(target_os = "macos") {
        run("/usr/bin/pbcopy", &[], text.as_bytes())
    } else if cfg!(windows) {
        // clip は先頭に BOM のある UTF-16LE を Unicode として受ける
        let mut b = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        run("clip", &[], &b)
    } else {
        run("wl-copy", &[], text.as_bytes())
            || run("xclip", &["-selection", "clipboard"], text.as_bytes())
    }
}

// ------------------------------------------------------------------ 画面に返す形

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupGuide {
    client: &'static str,
    title: &'static str,
    /// 接続口の場所を伏せた文面（本物は ai_setup_copy でクリップボードへ）
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    found: bool,
    version: Option<String>,
    /// アプリと接続口の版が同じか（違うと接続口が VERSION_MISMATCH を返す）
    version_matches: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    /// 事務所全体の設定（既定はオフ）
    enabled: bool,
    /// アプリ本体の受け口が開いているか
    running: bool,
    problem: Option<String>,
    /// 保存の部品が使えるか（事務所の鍵が無いと、設定も世帯も扱えない）
    store_ready: bool,
    connector: ConnectorInfo,
    /// 共有中の世帯（仮名・顧客番号・残り時間）
    shares: Vec<ShareStatus>,
    setup: Vec<SetupGuide>,
    durations: Vec<u32>,
    /// 開発用のビルド（作業フォルダの指定が文面に加わる）
    dev: bool,
    /// AIから届いた、機能を有効にするコードの候補の数（承認待ち。中身は feature_codes_status で読む）
    feature_code_candidates: usize,
}

fn status(ai: &AiState, store: &Store) -> AiStatus {
    let store_ready = store.ai_connector_enabled().is_ok();
    if store_ready {
        ai.ensure_endpoint(store);
    }
    let enabled = store.ai_connector_enabled().unwrap_or(false);
    let path = connector_path();
    let version = path.as_deref().and_then(connector_version);
    let dev = cfg!(debug_assertions);
    AiStatus {
        enabled,
        running: lock(&ai.endpoint).is_some(),
        problem: lock(&ai.problem).clone(),
        store_ready,
        connector: ConnectorInfo {
            found: path.is_some(),
            version_matches: version.as_deref() == Some(ai.app_version.as_str()),
            version,
        },
        shares: ai.registry.active_shares(),
        setup: CLIENTS
            .iter()
            .filter_map(|(client, title)| {
                Some(SetupGuide {
                    client,
                    title,
                    text: setup_text(client, EXE_PLACEHOLDER, dev.then_some(RUNTIME_PLACEHOLDER))?,
                })
            })
            .collect(),
        durations: DURATIONS_MIN.to_vec(),
        dev,
        feature_code_candidates: ai.registry.feature_code_candidates().len(),
    }
}

fn view(ai: &AiState, books: &HashMap<String, Entry>, id: &str) -> Result<HouseholdAiView, String> {
    let e = books.get(id).ok_or_else(|| code(StoreError::NOT_OPEN))?;
    let share = ai
        .registry
        .active_shares()
        .into_iter()
        .find(|s| s.household_id == id);
    let mut v = e.book.view(&ai.registry.records(id), share);
    v.document_proposals = ai.registry.document_proposals(id);
    Ok(v)
}

// ------------------------------------------------------------------ 命令（パス・鍵を引数に取らない・返さない）

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AiState, &Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ai = app.state::<AiState>();
        let store = app.state::<StoreState>();
        f(&ai, &store.store)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

/// AI接続口の状態（設定がオンなら受け口を開ける）
#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<AiStatus, String> {
    blocking(app, |ai, store| Ok(status(ai, store))).await
}

/// AI接続口を使うかどうか（事務所全体の設定）。オフにすると、すべての共有を取り消して口を閉じる
#[tauri::command]
pub async fn ai_set_enabled(app: AppHandle, enabled: bool) -> Result<AiStatus, String> {
    blocking(app, move |ai, store| {
        store.set_ai_connector_enabled(enabled).map_err(code)?;
        if !enabled {
            ai.registry.revoke_all();
            ai.registry.clear_feature_code_candidates();
            ai.persist_all(store);
            ai.close_endpoint();
        }
        Ok(status(ai, store))
    })
    .await
}

/// 接続の設定の文面（本物の場所の入ったもの）を OS のクリップボードに写す。写せたら true
#[tauri::command]
pub async fn ai_setup_copy(app: AppHandle, client: String) -> Result<bool, String> {
    blocking(app, move |ai, _| {
        let path = connector_path().ok_or("E_AI_CONNECTOR_MISSING")?;
        let runtime = cfg!(debug_assertions).then(|| ai.runtime_dir.to_string_lossy().into_owned());
        let text = setup_text(&client, &path.to_string_lossy(), runtime.as_deref())
            .ok_or("E_AI_CLIENT")?;
        Ok(copy_to_clipboard(&text))
    })
    .await
}

/// 世帯の「同意とAIの記録」
#[tauri::command]
pub async fn ai_household(app: AppHandle, id: String) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, _| view(ai, &lock(&ai.books), &id)).await
}

/// 外部AIへの提供の同意（同意しなかった・撤回）を記録する。すぐに世帯ファイルへ書く。撤回なら共有をすぐに取り消す
#[tauri::command]
pub async fn ai_consent_record(
    app: AppHandle,
    id: String,
    input: ExternalAiConsentInput,
) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        let mut books = lock(&ai.books);
        let e = books
            .get_mut(&id)
            .ok_or_else(|| code(StoreError::NOT_OPEN))?;
        if e.book.generation == 0 {
            return Err("E_AI_NOT_SAVED".into());
        }
        e.book
            .record_consent(&input, &today_upper(), &now_iso(), author_of(store))
            .map_err(str::to_owned)?;
        if input.decision != ai_share::ConsentDecision::Given {
            ai.registry.withdraw_consent(&id);
        }
        ai.persist_locked(store, &mut books);
        if books
            .get(&id)
            .is_some_and(|e| e.book.is_dirty(&ai.registry.records(&id)))
        {
            return Err("E_AI_PERSIST".into());
        }
        view(ai, &books, &id)
    })
    .await
}

/// 世帯をAIに渡す（期限つきの共有を作る）。同意が `given` で、AI接続口がオンのときだけ
#[tauri::command]
pub async fn ai_share_start(
    app: AppHandle,
    id: String,
    minutes: u32,
    destination: String,
) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        if !store.ai_connector_enabled().map_err(code)? {
            return Err("E_AI_OFF".into());
        }
        ai.ensure_endpoint(store);
        if lock(&ai.endpoint).is_none() {
            return Err("E_AI_ENDPOINT".into());
        }
        if !DURATIONS_MIN.contains(&minutes) {
            return Err("E_AI_DURATION".into());
        }
        let destination = destination.trim().to_owned();
        if destination.is_empty() || destination.chars().count() > MAX_DESTINATION_CHARS {
            return Err("E_AI_DESTINATION".into());
        }
        let mut books = lock(&ai.books);
        let e = books.get(&id).ok_or_else(|| code(StoreError::NOT_OPEN))?;
        if e.book.generation == 0 {
            return Err("E_AI_NOT_SAVED".into());
        }
        if !ai.registry.active_share_ids(&id).is_empty() {
            return Err("E_AI_ALREADY_SHARED".into());
        }
        let source = e.book.source().ok_or("E_AI_BODY")?;
        ai.registry
            .grant(
                source,
                GrantOptions {
                    scope: Scope::Reduced,
                    duration: Duration::from_secs(u64::from(minutes) * 60),
                    destination_declared: destination,
                    proceed_without_consent: false,
                },
            )
            .map_err(|e| match e {
                GrantError::ConsentMissing { .. } => "E_AI_NO_CONSENT".to_owned(),
                GrantError::BadDuration => "E_AI_DURATION".to_owned(),
                GrantError::DestinationMissing => "E_AI_DESTINATION".to_owned(),
                GrantError::NotAddable(_) => "E_AI_SCOPE".to_owned(),
            })?;
        ai.persist_locked(store, &mut books);
        view(ai, &books, &id)
    })
    .await
}

/// 世帯の共有を取り消す（即時。取り消した直後の読み取りから REVOKED）
#[tauri::command]
pub async fn ai_share_stop(app: AppHandle, id: String) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        for sid in ai.registry.active_share_ids(&id) {
            ai.registry.revoke(&sid);
        }
        let mut books = lock(&ai.books);
        ai.persist_locked(store, &mut books);
        view(ai, &books, &id)
    })
    .await
}

/// AIの候補についてのFPの判断を記録する（accept のときは、画面が保存したプランの ID）
#[tauri::command]
pub async fn ai_candidate_decide(
    app: AppHandle,
    id: String,
    candidate: String,
    accept: bool,
    plan: Option<String>,
) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        let mut books = lock(&ai.books);
        let e = books
            .get_mut(&id)
            .ok_or_else(|| code(StoreError::NOT_OPEN))?;
        e.book
            .decide(&candidate, accept, plan, &now_iso(), author_of(store))
            .map_err(str::to_owned)?;
        ai.persist_locked(store, &mut books);
        view(ai, &books, &id)
    })
    .await
}

/// 画面が読み取りの記録にした（または読めなかった）書類の候補を、承認待ちから外す（0151）
#[tauri::command]
pub async fn ai_documents_taken(
    app: AppHandle,
    id: String,
    candidate: String,
) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, _| {
        ai.registry.take_document_proposal(&id, &candidate);
        view(ai, &lock(&ai.books), &id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 画面に見せる文面には、本物の場所が入らない
    #[test]
    fn setup_text_for_the_screen_has_no_paths() {
        for (client, _) in CLIENTS {
            let t = setup_text(client, EXE_PLACEHOLDER, Some(RUNTIME_PLACEHOLDER)).unwrap();
            assert!(t.contains(EXE_PLACEHOLDER), "{t}");
            assert!(t.contains(SERVER_NAME));
            assert!(
                !t.contains("/Users") && !t.contains("Library") && !t.contains(":\\"),
                "{t}"
            );
            let product = setup_text(client, EXE_PLACEHOLDER, None).unwrap();
            assert!(
                !product.contains(ai_ipc::discovery::RUNTIME_DIR_ENV),
                "製品の文面に作業フォルダの指定は無い"
            );
        }
        assert!(setup_text("unknown", "x", None).is_none());
    }

    #[test]
    fn setup_text_is_valid_json_and_toml_shaped() {
        let j = setup_text("json", "/opt/x y/lifeplan", Some("/tmp/run")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        assert_eq!(v["mcpServers"][SERVER_NAME]["args"][0], "mcp");
        assert_eq!(v["mcpServers"][SERVER_NAME]["command"], "/opt/x y/lifeplan");
        let t = setup_text("toml", "C:\\Apps\\lifeplan.exe", None).unwrap();
        assert!(
            t.contains("command = \"C:\\\\Apps\\\\lifeplan.exe\""),
            "{t}"
        );
        let c = setup_text("command", "/opt/x y/lifeplan", None).unwrap();
        assert!(c.ends_with("-- \"/opt/x y/lifeplan\" mcp"), "{c}");
    }

    #[test]
    fn durations_follow_the_record() {
        assert!(DURATIONS_MIN.contains(&60), "既定の60分");
        assert!(
            DURATIONS_MIN.iter().all(|m| *m > 0 && *m <= 8 * 60),
            "最長8時間"
        );
    }
}
