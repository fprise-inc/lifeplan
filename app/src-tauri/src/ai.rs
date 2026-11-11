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
//! - **新しい世帯の候補**（0208）: AIが組み立てた世帯（計算の入力）は、受け取るときに計算エンジンで確かめ、メモリの中に承認待ちで置くだけ。
//!   世帯の一覧は変わらない。FPが画面で中身と「架空」か「お客さま」かを確かめて「世帯として作る」を押したときだけ、本体が世帯を作る
//!   （出どころの記録 `meta.origin` を本体が書き、架空なら世帯の一覧の札に印を付ける）。架空の世帯は、同意の記録が無くても渡せる
//! - **書類から読んだ値の候補**（0151）: 届いた答えはメモリの中だけに置き、世帯ファイルには書かない（番号が混ざっていても残さない）。
//!   画面が「同意とAIの記録」で受け取り、読み口（番号を落とす決まり）を通して読み取りの記録（本文の区画 `documents`）にしてから、
//!   `ai_documents_taken` で承認待ちから外す。
//!
//! 画面（WebView）には、鍵・パス（データフォルダ・作業フォルダ・接続口の実行ファイル）を渡さない（0016 の1）。
//! 接続の設定の文面は、場所を `<接続口の場所>` に伏せた形で見せ、本物の場所の入った文面は本体が OS のクリップボードに写す。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use ai_share::clock::{iso8601, Clock, SystemClock};
use ai_share::registry::ShareStatus;
use ai_share::{
    AppEndpoint, ExternalAiConsentInput, GrantError, GrantOptions, HouseholdAiView, HouseholdBook,
    HouseholdCandidate, Scope, ShareRegistry,
};
use household_store::{CreateOptions, Opened, Store, StoreError};
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
/// 同じ中身の読み取りが続いただけ（読まれた記録の回数と最後の日時だけの変化）は、前に書いてからこの間をおいて書く
/// （読まれるたびに世帯ファイルの世代を進めない。終わるとき・ほかの記録が変わったときはすぐ書く）
const READ_COUNTS_EVERY: Duration = Duration::from_secs(60);

struct Entry {
    book: HouseholdBook,
    /// 世帯の一覧に出す構成の要約（保存のときに要る）
    summary: String,
    /// この起動で、記録を世帯ファイルへ最後に書いた時（読まれた回数だけの変化を間引くため）
    written_at: Option<Instant>,
}

pub struct AiState {
    registry: Arc<ShareRegistry>,
    /// 開いた世帯ごとの帳面。帳面を変えるときと、世帯ファイルへ書き戻すときは、このロックを持ったまま行う
    books: Mutex<HashMap<String, Entry>>,
    /// 捨てた帳面（`forget`）。次にその世帯を開いたとき、世帯ファイルに無い AI の候補を引き継ぐためだけに持つ（書き戻さない）
    parked: Mutex<HashMap<String, HouseholdBook>>,
    endpoint: Mutex<Option<AppEndpoint>>,
    problem: Mutex<Option<String>>,
    runtime_dir: PathBuf,
    app_version: String,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// 画面が計算の前に足す事務所の推定の値の元（事務所データの `defaults.estimates`。無ければ None）。AI接続口の計算に添える（0184）。
/// 読み方（使える値の確かめ・エンジンへ渡す形）は画面と接続口が同じ関数（app/src/workspace/office/estimates.ts）で行うので、ここでは切り出すだけ
pub(crate) fn office_estimates_of(store: &Store) -> Option<serde_json::Value> {
    store
        .office_defaults()
        .ok()?
        .get("estimates")
        .filter(|v| v.is_object())
        .cloned()
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<AiState, Box<dyn std::error::Error>> {
    let registry = Arc::new(ShareRegistry::new());
    registry.require_consent(true);
    // AIの新しい世帯の候補は、受け取るときに画面と同じ計算エンジンで確かめる（形・範囲。スキーマに無い欄も断る）
    registry.set_household_check(Some(Arc::new(crate::engine::check_input)));
    // AI接続口の計算（calculate・explain_value の share_id）に、その時の事務所の推定の値を添える（0184）
    let handle = app.clone();
    registry.set_office_estimates(Some(Arc::new(move || {
        office_estimates_of(&handle.try_state::<StoreState>()?.store)
    })));
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
        parked: Mutex::new(HashMap::new()),
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

    /// 世帯を開いた: 世帯ファイルの中身で帳面を作り（同じ起動で前に開いた世帯でも作り直す。もう1台の PC が記録した同意・
    /// 撤回・候補の判断を読むため）、画面に返す本文からアプリだけが書く区画を外す。
    /// AIに渡した記録は、世帯ファイルの記録の後ろにこの起動の記録を足して合わせる（共有の台帳の `load_records`）。
    /// 共有中なら、渡す中身と同意を開いた世帯に合わせる（同意が無くなっていれば、その場で閉じる）
    pub fn on_opened(&self, mut o: Opened, summary: String) -> Result<Opened, String> {
        let (mut book, screen) =
            HouseholdBook::from_opened(&o.id, Some(o.customer_no.clone()), o.generation, &o.body)
                .map_err(str::to_owned)?;
        // 架空の印は世帯の一覧の札から（本文には書かない。画面からは付けられない）
        book.fictional = o.label.fictional;
        let mut books = lock(&self.books);
        let earlier = books
            .remove(&o.id)
            .map(|e| e.book)
            .or_else(|| lock(&self.parked).remove(&o.id));
        if let Some(earlier) = earlier {
            book.carry_candidates_from(&earlier);
        }
        self.registry
            .load_records(&o.id, book.file_ai_shares.clone());
        let active = self.registry.active_share_ids(&o.id);
        match book.source() {
            Some(src) => {
                for sid in &active {
                    self.registry.update_source(sid, src.clone());
                }
            }
            None => {
                for sid in &active {
                    self.registry.revoke(sid);
                }
            }
        }
        books.insert(
            o.id.clone(),
            Entry {
                book,
                summary,
                written_at: None,
            },
        );
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

    /// 分岐を選んだ後・世帯を移した後など、世帯ファイルの中身で帳面を作り直すとき: 持っている帳面を捨てる
    /// （裏の見回りが古い帳面を書き戻さないように。次の on_opened で作り直し、世帯ファイルに無い AI の候補だけ引き継ぐ）
    pub fn forget(&self, id: &str) {
        let e = lock(&self.books).remove(id);
        if let Some(e) = e {
            lock(&self.parked).insert(id.to_owned(), e.book);
        }
    }

    /// 架空の世帯をお客さまの世帯にした: 帳面の印を外し、共有中なら渡す中身を置き換える（同意が無ければ、その場で閉じる）
    pub fn on_made_client(&self, store: &Store, id: &str) {
        let mut books = lock(&self.books);
        let active = self.registry.active_share_ids(id);
        match books.get_mut(id) {
            Some(e) => {
                e.book.fictional = false;
                match e.book.source() {
                    Some(src) => {
                        for sid in &active {
                            self.registry.update_source(sid, src.clone());
                        }
                    }
                    None => {
                        for sid in &active {
                            self.registry.revoke(sid);
                        }
                    }
                }
            }
            None => {
                for sid in &active {
                    self.registry.revoke(sid);
                }
            }
        }
        if let Some(p) = lock(&self.parked).get_mut(id) {
            p.fictional = false;
        }
        self.persist_locked(store, &mut books);
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
        lock(&self.parked).remove(id);
    }

    /// 帳面のうち、まだ書いていない記録を世帯ファイルへ書き戻す（ロックを持った呼び出し元から）
    fn persist_locked(&self, store: &Store, books: &mut HashMap<String, Entry>) {
        self.persist_where(store, books, true);
    }

    /// 書き戻す。`now` でないとき（裏の見回り）は、読まれた回数だけの変化を間引く。間引いた世帯があれば false
    fn persist_where(&self, store: &Store, books: &mut HashMap<String, Entry>, now: bool) -> bool {
        let mut all = true;
        for (id, e) in books.iter_mut() {
            let records = self.registry.records(id);
            if !e.book.is_dirty(&records) {
                continue;
            }
            if !now
                && e.book.only_read_counts_moved(&records)
                && e.written_at
                    .is_some_and(|t| t.elapsed() < READ_COUNTS_EVERY)
            {
                all = false;
                continue;
            }
            let Ok(composed) = e.book.compose(&records) else {
                continue; // 追記だけでない記録は書かない（起こらないはずの状態）
            };
            if let Ok(saved) = store.save(id, &composed, &e.summary) {
                e.book.mark_saved(&records, saved.generation);
                e.written_at = Some(Instant::now());
            }
        }
        all
    }

    fn persist_all(&self, store: &Store) {
        let mut books = lock(&self.books);
        self.persist_locked(store, &mut books);
    }

    /// 裏の見回り（2秒ごと）: 期限切れを閉じ、届いた候補を帳面に入れ、記録を世帯ファイルへ書き戻す
    fn tick(&self, store: &Store, w: &mut Watch) {
        self.registry.sweep_expired();
        let proposals = self.registry.take_proposals();
        let revision = self.registry.revision();
        if proposals.is_empty() && revision == w.revision && !w.waiting {
            return;
        }
        let mut books = lock(&self.books);
        for p in proposals {
            if let Some(e) = books.get_mut(&p.household_id) {
                e.book.add_candidate(p);
            }
        }
        w.waiting = !self.persist_where(store, &mut books, false);
        w.revision = revision;
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

/// 裏の見回りが覚えておくこと
#[derive(Default)]
struct Watch {
    /// 前に見た、記録が変わった回数
    revision: u64,
    /// 読まれた回数だけの変化を、まだ書いていない世帯がある（間をおいて書く）
    waiting: bool,
}

#[cfg(test)]
impl AiState {
    pub(crate) fn for_test(dir: &Path) -> AiState {
        let registry = Arc::new(ShareRegistry::new());
        registry.require_consent(true);
        AiState {
            registry,
            books: Mutex::new(HashMap::new()),
            parked: Mutex::new(HashMap::new()),
            endpoint: Mutex::new(None),
            problem: Mutex::new(None),
            runtime_dir: dir.join("run"),
            app_version: "0.1.0".into(),
        }
    }
}

/// 裏の見回りを始める（アプリの起動時に1回）
pub fn start_watch<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = Watch::default();
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
    /// AIから届いた、新しい世帯の候補の数（承認待ち。中身は ai_household_candidates で読む）
    household_candidates: usize,
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
        household_candidates: ai.registry.household_candidates().len(),
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
            ai.registry.clear_household_candidates();
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

/// AIから届いた、新しい世帯の候補（承認待ち。届いた順。中身は信用しない: 画面の読み口で確かめてから見せる）
#[tauri::command]
pub async fn ai_household_candidates(app: AppHandle) -> Result<Vec<HouseholdCandidate>, String> {
    blocking(app, |ai, _| Ok(ai.registry.household_candidates())).await
}

/// 新しい世帯の候補を捨てる（世帯は作らない）
#[tauri::command]
pub async fn ai_household_candidate_discard(
    app: AppHandle,
    candidate: String,
) -> Result<Vec<HouseholdCandidate>, String> {
    blocking(app, move |ai, _| {
        ai.registry
            .take_household_candidate(&candidate)
            .ok_or("E_AI_CANDIDATE_UNKNOWN")?;
        Ok(ai.registry.household_candidates())
    })
    .await
}

/// 新しい世帯の候補から、世帯を作る（FPが画面で中身と種類を確かめて「世帯として作る」を押したときだけ）。
/// `kind` は FP が選んだ種類（`fictional`・`client`）、`body` は画面が候補の入力から組み立てた本文（番号らしい所を消し、値の出どころを AI にした物）。
/// 本体は、候補がまだ承認待ちであることと、本文の家族が候補の家族と同じことを確かめ、出どころの記録（`meta.origin`）を書いて作る。
/// 架空なら世帯の一覧の札に印を付ける。作ったら候補を承認待ちから外す
#[tauri::command]
pub async fn ai_household_candidate_create(
    app: AppHandle,
    candidate: String,
    kind: String,
    body: String,
    summary: String,
    category: Option<String>,
) -> Result<Opened, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ai = app.state::<AiState>();
        let store = app.state::<StoreState>();
        create_from_candidate(
            &store.store,
            &ai,
            &candidate,
            &kind,
            &body,
            summary,
            category,
        )
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

/// 家族の構成員の ID（並びの順は見ない）
fn member_ids(input: &serde_json::Value) -> Option<Vec<String>> {
    let mut v: Vec<String> = input
        .get("household")?
        .get("members")?
        .as_array()?
        .iter()
        .map(|m| {
            m.get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .collect::<Option<Vec<_>>>()?;
    v.sort();
    Some(v)
}

/// 候補から世帯を作る（ai_household_candidate_create の中身。テストから呼ぶ）
pub(crate) fn create_from_candidate(
    store: &Store,
    ai: &AiState,
    candidate: &str,
    kind: &str,
    body: &str,
    summary: String,
    category: Option<String>,
) -> Result<Opened, String> {
    if !ai_share::households::KINDS.contains(&kind) {
        return Err("E_AI_KIND".into());
    }
    let c = ai
        .registry
        .household_candidate(candidate)
        .ok_or("E_AI_CANDIDATE_UNKNOWN")?;
    let mut v: serde_json::Value =
        serde_json::from_str(body).map_err(|_| code(StoreError::BODY))?;
    let input = v
        .get("household")
        .and_then(|h| h.get("request"))
        .and_then(|r| r.get("input"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if !input.is_object() {
        return Err(code(StoreError::BODY));
    }
    // 画面が組み立てた本文が、この候補から作った物か（家族の構成員が同じ）
    if member_ids(&input).is_none() || member_ids(&input) != member_ids(&c.input) {
        return Err("E_AI_CANDIDATE_BODY".into());
    }
    let Some(obj) = v.as_object_mut() else {
        return Err(code(StoreError::BODY));
    };
    // 出どころの記録（本体が書く。本体が保存のたびに meta の知らない欄として持ち越す）
    let mut origin = serde_json::json!({
        "kind": "ai",
        "candidateId": c.candidate_id,
        "receivedAt": c.received_at,
        "createdAt": now_iso(),
        "createdAs": kind,
        "approvedBy": "fp",
    });
    if let Some(con) = &c.connector {
        origin["connector"] = serde_json::json!(con);
    }
    if let Some(a) = author_of(store) {
        origin["approvedByMember"] = serde_json::json!({ "memberId": a.member_id, "name": a.name });
    }
    let meta = obj.entry("meta").or_insert_with(|| serde_json::json!({}));
    if !meta.is_object() {
        *meta = serde_json::json!({});
    }
    meta["origin"] = origin;
    let o = crate::store::create_household(
        store,
        ai,
        v.to_string(),
        summary,
        CreateOptions {
            category,
            sample: None,
            fictional: kind == "fictional",
        },
    )?;
    ai.registry.take_household_candidate(candidate);
    Ok(o)
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

    // ---------------------------------------------------------------- 同意とAIの記録と、世帯の保存のつなぎ
    // （もう1台の PC は、同じデータフォルダを別の保存の部品と帳面で開いて代わりにする）

    use household_store::{CreateOptions, CreateRequest, ForkChoice, MemorySecretStore};

    struct Pc {
        store: Store,
        ai: AiState,
    }

    fn root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "financia-ai-{name}-{}-{}",
            std::process::id(),
            SystemClock.now_ms()
        ))
    }

    fn pc(root: &Path, secrets: &Arc<MemorySecretStore>) -> Pc {
        let store = Store::new(
            root.to_path_buf(),
            secrets.clone(),
            household_store::SystemClock,
            "0.1.0-test",
        );
        store.status().unwrap();
        Pc {
            store,
            ai: AiState::for_test(root),
        }
    }

    fn model_input() -> serde_json::Value {
        let s = crate::engine::household("single25").expect("モデル世帯");
        serde_json::from_str::<serde_json::Value>(s).unwrap()["input"].clone()
    }

    fn body() -> String {
        serde_json::json!({ "household": { "request": { "input": model_input() } } }).to_string()
    }

    fn consent(decision: &str) -> ExternalAiConsentInput {
        serde_json::from_value(serde_json::json!({
            "decision": decision, "obtainedOn": "2026-11-01", "method": "paper",
            "company": "A社", "country": "米国", "noTrainingConfirmed": true, "fpConfirmed": true
        }))
        .unwrap()
    }

    impl Pc {
        fn open(&self, id: &str) -> Opened {
            self.ai
                .on_opened(self.store.open(id).unwrap(), "本人".into())
                .unwrap()
        }

        /// ai_consent_record と同じ順
        fn record(&self, id: &str, decision: &str) {
            let mut books = lock(&self.ai.books);
            books
                .get_mut(id)
                .unwrap()
                .book
                .record_consent(
                    &consent(decision),
                    "2026-11-07",
                    "2026-11-07T00:00:00Z",
                    None,
                )
                .unwrap();
            if decision != "given" {
                self.ai.registry.withdraw_consent(id);
            }
            self.ai.persist_locked(&self.store, &mut books);
        }

        fn state(&self, id: &str) -> String {
            view(&self.ai, &lock(&self.ai.books), id)
                .unwrap()
                .consent_state
        }

        /// ai_share_start と同じ確かめ（受け口は開けない）
        fn share(&self, id: &str) -> Result<String, GrantError> {
            let mut books = lock(&self.ai.books);
            let src = books.get(id).unwrap().book.source().unwrap();
            let g = self.ai.registry.grant(
                src,
                GrantOptions {
                    destination_declared: "AIのアプリ".into(),
                    ..GrantOptions::default()
                },
            )?;
            self.ai.persist_locked(&self.store, &mut books);
            Ok(g.share_id)
        }

        fn ai_reads(&self, share: &str) {
            self.ai
                .registry
                .handle_get(
                    share,
                    "get_shared_household",
                    &ai_share::record::Caller::default(),
                )
                .unwrap();
        }

        fn tick(&self, w: &mut Watch) {
            self.ai.tick(&self.store, w);
        }
    }

    fn file_sections(root: &Path, secrets: &Arc<MemorySecretStore>, id: &str) -> serde_json::Value {
        let s = pc(root, secrets).store;
        serde_json::from_str(&s.open(id).unwrap().body).unwrap()
    }

    fn decisions(v: &serde_json::Value) -> Vec<String> {
        v["consents"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|c| c["decision"].as_str().unwrap_or("").to_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// AI接続口の計算に添える事務所の推定の値は、事務所データの defaults.estimates だけ（ほかの既定値は添えない。0184）
    #[test]
    fn office_estimates_are_cut_from_the_office_defaults() {
        let root = root("office-estimates");
        let secrets = Arc::new(MemorySecretStore::default());
        let p = pc(&root, &secrets);
        assert_eq!(
            office_estimates_of(&p.store),
            None,
            "事務所の既定値が無ければ添えない"
        );
        let est = serde_json::json!({ "values": {}, "noFill": ["engine.care"] });
        p.store
            .set_office_defaults(serde_json::json!({ "estimates": est, "endAge": 95 }))
            .unwrap();
        assert_eq!(office_estimates_of(&p.store), Some(est));
        p.store
            .set_office_defaults(serde_json::json!({ "endAge": 95 }))
            .unwrap();
        assert_eq!(office_estimates_of(&p.store), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 同じ起動の中で開き直したら、世帯ファイルの同意で帳面を作り直す。もう1台で記録した撤回が見え、渡せず、保存しても消えない
    #[test]
    fn reopening_reads_consents_written_on_another_pc() {
        let root = root("reopen");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let o = pc1
            .store
            .create(CreateRequest {
                body: body(),
                summary: "本人".into(),
            })
            .unwrap();
        let id = o.id.clone();
        pc1.ai.on_opened(o, "本人".into()).unwrap();
        pc1.record(&id, "given");
        let share = pc1.share(&id).unwrap();

        let pc2 = pc(&root, &secrets);
        pc2.open(&id);
        pc2.record(&id, "withdrawn");

        let screen = pc1.open(&id);
        assert_eq!(pc1.state(&id), "withdrawn", "撤回が見える");
        assert!(
            pc1.ai.registry.active_share_ids(&id).is_empty(),
            "開き直した世帯の同意が無ければ、共有中の共有はその場で閉じる"
        );
        assert!(pc1
            .ai
            .registry
            .handle_get(
                &share,
                "get_shared_household",
                &ai_share::record::Caller::default()
            )
            .is_err());
        assert!(matches!(
            pc1.share(&id),
            Err(GrantError::ConsentMissing { .. })
        ));
        pc1.ai.save(&pc1.store, &id, &screen.body, "本人").unwrap();
        let file = file_sections(&root, &secrets, &id);
        assert_eq!(decisions(&file), ["given", "withdrawn"], "撤回の行が残る");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 分岐で相手の版を選び直しても、そのまま保存できる（相手の版の記録の後ろに、この起動の記録を足す）
    #[test]
    fn choosing_their_version_of_a_fork_keeps_saving() {
        let root = root("fork");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let o = pc1
            .store
            .create(CreateRequest {
                body: body(),
                summary: "本人".into(),
            })
            .unwrap();
        let id = o.id.clone();
        let screen = pc1.ai.on_opened(o, "本人".into()).unwrap();
        pc1.record(&id, "given");
        let share = pc1.share(&id).unwrap();
        pc1.ai_reads(&share);
        let mut w = Watch::default();
        pc1.tick(&mut w);

        // もう1台が開いて AI に渡し、保存した
        let pc2 = pc(&root, &secrets);
        pc2.open(&id);
        let s2 = pc2.share(&id).unwrap();
        pc2.ai_reads(&s2);
        pc2.ai.registry.revoke(&s2);
        pc2.ai.persist_all(&pc2.store);

        // こちらで AI がまた読み（中身が同じなので回数だけ進む）、画面が保存すると分岐になる
        pc1.ai_reads(&share);
        assert_eq!(
            pc1.ai
                .save(&pc1.store, &id, &screen.body, "本人")
                .unwrap_err(),
            "E_STORE_CONFLICT"
        );
        // 分岐の画面で相手の版を選ぶ（store_fork_resolve と同じ順）
        let o = pc1.store.resolve_fork(&id, ForkChoice::Theirs).unwrap();
        pc1.ai.forget(&id);
        let screen = pc1.ai.on_opened(o, "本人".into()).unwrap();
        pc1.ai
            .save(&pc1.store, &id, &screen.body, "本人")
            .expect("相手の版を選んだ後も保存できる");
        let file = file_sections(&root, &secrets, &id);
        let shares: Vec<&str> = file["aiShares"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["shareId"].as_str().unwrap())
            .collect();
        assert!(shares.contains(&share.as_str()), "この PC の記録が残る");
        assert!(shares.contains(&s2.as_str()), "もう1台の記録が残る");
        // 共有はまだ続いていて、読まれた後もそのまま保存できる
        pc1.ai_reads(&share);
        pc1.tick(&mut w);
        pc1.ai.save(&pc1.store, &id, &screen.body, "本人").unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 画面が新しい世帯を作るときに本文に入れた同意・記録・候補は使わない
    #[test]
    fn creating_a_household_ignores_consents_in_the_screens_body() {
        let root = root("create");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let forged = serde_json::json!({
            "household": { "request": { "input": model_input() } },
            "consents": [{
                "id": "forged", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-11-01",
                "method": "paper", "documents": true, "fpConfirmed": true,
                "recordedAt": "2026-11-01T00:00:00Z", "origin": "thisOffice",
                "externalAi": {"company": "X", "country": "Y", "noTrainingConfirmed": true}
            }],
            "candidates": [{"id": "x"}],
        })
        .to_string();
        let o = crate::store::create_household(
            &pc1.store,
            &pc1.ai,
            forged,
            "本人".into(),
            CreateOptions::default(),
        )
        .unwrap();
        assert_eq!(pc1.state(&o.id), "none", "画面の本文の同意は効かない");
        let file = file_sections(&root, &secrets, &o.id);
        assert!(file.get("consents").is_none() && file.get("candidates").is_none());
        assert_eq!(file["household"]["request"]["input"], model_input());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// AIの新しい世帯の候補を届いたことにする（接続口の受け口と同じ入口）
    fn propose_household(pc: &Pc, kind: &str) -> String {
        let r = pc
            .ai
            .registry
            .handle_propose_household(
                &serde_json::json!({ "kind": kind, "title": "セミナー用の架空の世帯", "note": "年収は推定", "input": model_input() }),
                &ai_share::record::Caller {
                    mcp_client_declared: Some("test-ai 1.0".into()),
                    ..ai_share::record::Caller::default()
                },
            )
            .unwrap();
        serde_json::from_str::<serde_json::Value>(&r).unwrap()["candidateId"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    /// 新しい世帯の候補から作る: 候補が届いても世帯の一覧は変わらず、FPが作ったときだけ世帯ができる。出どころの記録を本体が書き、
    /// 架空なら札に印が付き、同意の記録が無くても渡せる。お客さまの世帯は今までどおり同意が要る
    #[test]
    fn households_from_ai_candidates() {
        let root = root("from-candidate");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let id_f = propose_household(&pc1, "fictional");
        assert!(
            pc1.store.list().unwrap().is_empty(),
            "候補が届いても世帯の一覧は変わらない"
        );
        // 種類・候補・本文の確かめ
        assert_eq!(
            create_from_candidate(
                &pc1.store,
                &pc1.ai,
                &id_f,
                "sample",
                &body(),
                "本人".into(),
                None
            )
            .unwrap_err(),
            "E_AI_KIND"
        );
        assert_eq!(
            create_from_candidate(
                &pc1.store,
                &pc1.ai,
                "x",
                "fictional",
                &body(),
                "本人".into(),
                None
            )
            .unwrap_err(),
            "E_AI_CANDIDATE_UNKNOWN"
        );
        let mut other = model_input();
        other["household"]["members"][0]["id"] =
            serde_json::json!("6f1b0c2e-3d4a-4b5c-8d6e-7f8091a2b3c4");
        let other_body =
            serde_json::json!({ "household": { "request": { "input": other } } }).to_string();
        assert_eq!(
            create_from_candidate(
                &pc1.store,
                &pc1.ai,
                &id_f,
                "fictional",
                &other_body,
                "本人".into(),
                None
            )
            .unwrap_err(),
            "E_AI_CANDIDATE_BODY",
            "別の世帯の本文では作らない"
        );
        assert!(pc1.store.list().unwrap().is_empty());
        // 画面の本文に入れた架空の印・同意・出どころは使わない（本体が書く）
        let forged = serde_json::json!({
            "household": { "request": { "input": model_input() } },
            "meta": { "origin": { "kind": "manual" } },
            "consents": [{ "id": "forged" }],
        })
        .to_string();
        let o = create_from_candidate(
            &pc1.store,
            &pc1.ai,
            &id_f,
            "fictional",
            &forged,
            "本人".into(),
            None,
        )
        .unwrap();
        assert!(o.label.fictional);
        assert!(
            pc1.ai.registry.household_candidate(&id_f).is_none(),
            "作った候補は外れる"
        );
        let file = file_sections(&root, &secrets, &o.id);
        assert_eq!(file["meta"]["origin"]["kind"], "ai");
        assert_eq!(file["meta"]["origin"]["candidateId"], id_f);
        assert_eq!(file["meta"]["origin"]["createdAs"], "fictional");
        assert_eq!(file["meta"]["origin"]["connector"], "test-ai 1.0");
        assert_eq!(file["meta"]["origin"]["approvedBy"], "fp");
        // 今の形式の版で書く（0206 で 0.76 になった。版を上げたら、この確かめの数も上げる）。開き直しても閲覧だけにならない
        assert_eq!(
            file["meta"]["formatVersion"],
            household_store::migrate::CURRENT
        );
        assert_eq!(file["meta"]["formatVersion"], "0.76");
        assert!(!pc1.store.open(&o.id).unwrap().read_only);
        assert!(file.get("consents").is_none());
        assert_eq!(file["household"]["request"]["input"], model_input());
        assert!(pc1.store.list().unwrap()[0].label.fictional);
        // 架空の世帯は同意の記録が無くても渡せる
        assert_eq!(pc1.state(&o.id), "none");
        assert!(
            view(&pc1.ai, &lock(&pc1.ai.books), &o.id)
                .unwrap()
                .fictional
        );
        let share = pc1.share(&o.id).expect("架空の世帯は同意なしで渡せる");
        pc1.ai_reads(&share);
        // 保存しても出どころの記録は残る（画面は meta を持たない本文で保存する）
        let screen = pc1.open(&o.id);
        pc1.ai
            .save(&pc1.store, &o.id, &screen.body, "本人")
            .unwrap();
        let file = file_sections(&root, &secrets, &o.id);
        assert_eq!(file["meta"]["origin"]["candidateId"], id_f);
        assert_eq!(file["aiShares"][0]["consentAtGrant"]["state"], "fictional");
        // お客さまの世帯にする（一方向）: 同意が無いので、共有中の共有はその場で止まり、もう渡せない
        assert!(pc1.store.make_client(&o.id).unwrap());
        pc1.ai.on_made_client(&pc1.store, &o.id);
        assert!(pc1.ai.registry.active_share_ids(&o.id).is_empty());
        assert!(matches!(
            pc1.share(&o.id),
            Err(GrantError::ConsentMissing { .. })
        ));
        let file = file_sections(&root, &secrets, &o.id);
        assert_eq!(file["aiShares"][0]["endReason"], "consentWithdrawn");
        // お客さまの世帯として作った世帯は、同意を記録するまで渡せない
        let id_c = propose_household(&pc1, "client");
        let c = create_from_candidate(
            &pc1.store,
            &pc1.ai,
            &id_c,
            "client",
            &body(),
            "本人".into(),
            None,
        )
        .unwrap_or_else(|e| panic!("{e}"));
        assert!(!c.label.fictional);
        let file = file_sections(&root, &secrets, &c.id);
        assert_eq!(file["meta"]["origin"]["createdAs"], "client");
        assert!(matches!(
            pc1.share(&c.id),
            Err(GrantError::ConsentMissing { .. })
        ));
        pc1.record(&c.id, "given");
        pc1.share(&c.id).expect("同意を記録した後は渡せる");
        // FP は作る前に種類を変えられる（AIが架空で出した候補を、お客さまの世帯として作る）
        let id_g = propose_household(&pc1, "fictional");
        let g = create_from_candidate(
            &pc1.store,
            &pc1.ai,
            &id_g,
            "client",
            &body(),
            "本人".into(),
            None,
        )
        .unwrap();
        assert!(!g.label.fictional);
        assert!(matches!(
            pc1.share(&g.id),
            Err(GrantError::ConsentMissing { .. })
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 候補の入力は、受け取るときに画面と同じ計算エンジンで確かめる（計算できない入力は理由を返して断る）
    #[test]
    fn household_candidates_are_checked_by_the_engine() {
        assert!(crate::engine::check_input(&model_input()).is_ok());
        let mut bad = model_input();
        bad["household"]["members"][0]["kind"] = serde_json::json!("boss");
        let e = crate::engine::check_input(&bad).unwrap_err();
        assert!(e.contains("calculate"), "{e}");
        let mut extra = model_input();
        extra["household"]["unknownField"] = serde_json::json!(1);
        assert!(
            crate::engine::check_input(&extra).is_err(),
            "スキーマに無い欄は断る"
        );
    }

    /// 同じ中身が読まれ続けるだけなら、世帯ファイルは読まれるたびには書き直さない（回数と最後の日時は間をおいて書く）
    #[test]
    fn repeated_identical_reads_do_not_save_the_household_every_time() {
        let root = root("reads");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let o = pc1
            .store
            .create(CreateRequest {
                body: body(),
                summary: "本人".into(),
            })
            .unwrap();
        let id = o.id.clone();
        pc1.ai.on_opened(o, "本人".into()).unwrap();
        pc1.record(&id, "given");
        let share = pc1.share(&id).unwrap();
        let mut w = Watch::default();
        pc1.ai_reads(&share);
        pc1.tick(&mut w);
        let gen = lock(&pc1.ai.books).get(&id).unwrap().book.generation;
        for _ in 0..5 {
            pc1.ai_reads(&share);
            pc1.tick(&mut w);
        }
        assert_eq!(
            lock(&pc1.ai.books).get(&id).unwrap().book.generation,
            gen,
            "回数だけの変化では書き直さない"
        );
        // 終わるときは書く
        pc1.ai.shutdown(&pc1.store);
        let file = file_sections(&root, &secrets, &id);
        assert_eq!(file["aiShares"][0]["reads"][0]["count"], 6);
        let _ = std::fs::remove_dir_all(&root);
    }
}
