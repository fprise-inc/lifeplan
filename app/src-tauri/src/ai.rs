//! AI接続口をアプリにつなぐ（0014・0015・0016）。中身は ai-share（共有の台帳・縮約版・記録・同意・候補）。
//!
//! - **事務所全体の設定**: AI接続口を使うかどうか（既定はオフ。事務所データに暗号化して保存）。オンのときだけ、
//!   アプリ本体の受け口（そのOSユーザー専用のソケット・`app.json`）を開ける。オフにすると、すべての共有を取り消して口を閉じる。
//! - **世帯ごとの同意**: 外部AIへの提供の同意の記録（0014 の2）。同意が `given` の世帯と、事務所の設定で「事務所のプライバシーポリシーに
//!   AI の利用を書いている」を確かめていてお客さまが「同意しない」と答えていない世帯だけを渡せる（共有の台帳の `require_consent`。
//!   判定は ai-share の `basis` の1か所。0226）。撤回すると、その世帯の共有をすぐに取り消す。
//! - **世帯を渡す**: FPが画面で「AIに渡す」を押したときだけ、期限つきの共有を作る（既定60分・最長8時間）。渡るのは縮約版だけ
//!   （FPのメモなどの文章は渡さない）。世帯の中身は、保存した本文（本体が復号したもの）から作る。
//! - **まとめて渡す**（0248）: 世帯の一覧で選んだ世帯（絞り込みの結果）を、1件ずつと同じ確かめ・期限・申告・記録でまとめて渡す
//!   （`ai_share_bulk_check`・`ai_share_bulk_start`・`ai_share_bulk_stop`）。画面で開いていない世帯は、開いた印を変えずに開いて帳面を作る
//!   （`Store::open_unmarked`。読まれた記録を世帯ファイルへ書き戻すため）。上限は共有中の世帯と合わせて `MAX_BULK_SHARES` 件。
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
//! - **Web のヒアリング**（0222）: 接続口の `issue_hearing_url` は、ここで発行の仕事（`HearingJobs`）として画面に頼み、画面の答えを待つ。
//!   鍵の組・合言葉は画面が FP の画面と同じ部品で作り、世帯ファイルか事務所データ（`office_hearing_put`）にだけ置く（本体の受け口は鍵を持たない）。
//!   画面は3秒ごとの読み直しで `hearingJobs` の数を見て、`ai_hearing_jobs` で仕事を受け取り、`ai_hearing_job_done` で答える。事務所のひな形の案は
//!   メモリの中に承認待ちで置くだけ（`ai_hearing_template_candidates`・`ai_hearing_template_take`）。保存は画面が事務所の既定値に書く
//!
//! 画面（WebView）には、鍵・パス（データフォルダ・作業フォルダ・接続口の実行ファイル）を渡さない（0016 の1）。
//! 接続の設定の文面は、場所を `<接続口の場所>` に伏せた形で見せ、本物の場所の入った文面は本体が OS のクリップボードに写す。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use ai_share::clock::{iso8601, Clock, SystemClock};
use ai_share::registry::ShareStatus;
use ai_share::{
    ai_use, AiUse, AppEndpoint, DisplayCandidate, ExternalAiConsentInput, GrantError, GrantOptions,
    HearingJob, HearingTemplateCandidate, HouseholdAiView, HouseholdBook, HouseholdCandidate,
    HouseholdDisplayPending, Scope, ShareRegistry,
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
/// まとめて AI に渡せる世帯の数の上限（選んだ世帯と、いま共有中の世帯の合計。0248 の3）
pub const MAX_BULK_SHARES: usize = 50;
/// 裏の見回りの間隔（期限切れを閉じる・届いた候補を入れる・記録を世帯ファイルへ書き戻す）
const TICK: Duration = Duration::from_secs(2);
/// 同じ中身の読み取りが続いただけ（読まれた記録の回数と最後の日時だけの変化）は、前に書いてからこの間をおいて書く
/// （読まれるたびに世帯ファイルの世代を進めない。終わるとき・ほかの記録が変わったときはすぐ書く）
const READ_COUNTS_EVERY: Duration = Duration::from_secs(60);
/// 共有中の世帯の世帯ファイルを見る間隔（ほかの PC での撤回・完全削除に気づくまでの目安。0248 の追記）
const FILES_CHECK_EVERY: Duration = Duration::from_secs(30);

/// 画面に頼んでいる Web のヒアリングの発行（0222。アプリのメモリの中だけ。画面が答えるか、待つ長さを過ぎると外す）
#[derive(Default)]
pub(crate) struct HearingJobs {
    next: Mutex<u64>,
    list: Mutex<Vec<PendingJob>>,
}

struct PendingJob {
    id: String,
    job: HearingJob,
    tx: std::sync::mpsc::SyncSender<Result<serde_json::Value, String>>,
}

/// 画面に渡す発行の仕事（世帯の依頼は、その世帯の内部ID・顧客番号と、見直しの前回の値を作るための世帯の本文）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HearingJobView {
    job_id: String,
    issue: serde_json::Value,
    household_id: Option<String>,
    customer_number: Option<String>,
    /// 見直しを含む世帯の依頼だけ: 本体の帳面の本文（画面がその世帯を開いていないとき、前回の値を作る）
    body: Option<String>,
    connector: Option<String>,
    received_at: String,
}

/// 画面が答えないときの理由（AI に見せる）
const HEARING_TIMEOUT_MESSAGE: &str = "アプリの画面が時間内に答えませんでした（アプリの窓が開いているか、事務所の鍵が使えるかを確かめてください）。発行されたかどうかは、アプリの上の帯と「発行した URL」で確かめられます。";

impl HearingJobs {
    /// 画面に頼んで、答えを待つ（待つ長さを過ぎたら外して断る）
    fn submit(&self, job: HearingJob) -> Result<serde_json::Value, String> {
        self.submit_within(job, ai_share::hearing::ISSUE_WAIT)
    }

    fn submit_within(&self, job: HearingJob, wait: Duration) -> Result<serde_json::Value, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let id = {
            let mut n = lock(&self.next);
            *n += 1;
            format!("j{}", *n)
        };
        lock(&self.list).push(PendingJob {
            id: id.clone(),
            job,
            tx,
        });
        let out = rx.recv_timeout(wait);
        lock(&self.list).retain(|j| j.id != id);
        out.unwrap_or_else(|_| Err(HEARING_TIMEOUT_MESSAGE.to_owned()))
    }

    fn len(&self) -> usize {
        lock(&self.list).len()
    }

    /// 画面の答え（届いた仕事を外す）。もう待っていなければ false
    fn done(&self, id: &str, result: serde_json::Value) -> bool {
        let mut list = lock(&self.list);
        let Some(at) = list.iter().position(|j| j.id == id) else {
            return false;
        };
        let j = list.remove(at);
        j.tx.send(Ok(result)).is_ok()
    }

    /// AI接続口をオフにしたとき: 待っている仕事を全部断る
    fn fail_all(&self, why: &str) {
        for j in lock(&self.list).drain(..) {
            let _ = j.tx.send(Err(why.to_owned()));
        }
    }
}

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
    /// 画面がいま開いている世帯（最後に画面から開いた・作った世帯）。ほかの帳面（この起動で前に開いた世帯・まとめて渡すときに
    /// 画面に出さずに開いた世帯。0248）は、記録を書き戻す前に世帯ファイルを読み直す（ほかのメンバーが間に保存していても分岐にしない）
    current: Mutex<Option<String>>,
    endpoint: Mutex<Option<AppEndpoint>>,
    problem: Mutex<Option<String>>,
    runtime_dir: PathBuf,
    app_version: String,
    /// 画面に頼んでいる Web のヒアリングの発行（0222）
    hearing: Arc<HearingJobs>,
}

/// 事務所で共有しているとき、ほかのメンバー（ほかの PC）が今開いている世帯（0248 の追記）。一覧を読めなければ None
/// （分からないときは、渡さない・書かずに待つ側に倒す）
fn opened_by_others(store: &Store) -> Option<HashSet<String>> {
    store.list().ok().map(|l| {
        l.into_iter()
            .filter(|h| !h.open_by.is_empty())
            .map(|h| h.id)
            .collect()
    })
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

/// 事務所の既定値のうち見せ方だけの欄（AI接続口の表示の設定。0213）。切り出し方（どの欄を写すか）は ai-share の `display::office_display_of`
/// の1か所で、計算の設定・推定の値・名前やロゴ・ヒアリングのひな形は写さない。事務所データを読めなければ None
pub(crate) fn office_display_of(store: &Store, active: &[String]) -> Option<serde_json::Value> {
    let defaults = store.office_defaults().ok()?;
    Some(ai_share::display::office_display_of(&defaults, active))
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
    // AI接続口の表示の設定（get_display_settings。0213）に、その時の事務所の既定値の見せ方だけの欄を返す（読むだけ）
    let handle = app.clone();
    registry.set_office_display(Some(Arc::new(move || {
        let store = &handle.try_state::<StoreState>()?.store;
        let active = handle
            .try_state::<crate::revocations::RevocationState>()
            .map(|rs| crate::features::active_features(store, &rs))
            .unwrap_or_default();
        office_display_of(store, &active)
    })));
    // Web のヒアリングの事務所のひな形（get_hearing_options・issue_hearing_url。0222。読むだけ）
    let handle = app.clone();
    registry.set_office_hearing(Some(Arc::new(move || {
        let d = handle.try_state::<StoreState>()?.store.office_defaults().ok()?;
        Some(serde_json::json!({
            "templates": d.get("hearingTemplates").cloned().unwrap_or_else(|| serde_json::json!([])),
        }))
    })));
    // 顧客のフォローの要約（summarize_shared_households。0248）の区分の名前（記号 → 名前。読むだけ）
    let handle = app.clone();
    registry.set_office_categories(Some(Arc::new(move || {
        let c = handle.try_state::<StoreState>()?.store.categories().ok()?;
        Some(serde_json::Value::Object(
            c.categories
                .into_iter()
                .map(|c| (c.code, serde_json::Value::String(c.name)))
                .collect(),
        ))
    })));
    // エラーの記録（get_error_log。0234。読むだけ。世帯の中身ではないので「AIに渡した記録」には残さず、読んだ回数をエラーの記録の中に残す）
    if let Some(path) = crate::errlog::path_of(app) {
        registry.set_error_log(Some(Arc::new(move || {
            crate::errlog::read_for_ai(&path, SystemClock.now_ms())
        })));
    }
    // Web のヒアリングの発行は画面に頼む（鍵は画面だけが作る。0222）
    let hearing = Arc::new(HearingJobs::default());
    let jobs = hearing.clone();
    registry.set_hearing_issuer(Some(Arc::new(move |job| jobs.submit(job))));
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
        current: Mutex::new(None),
        endpoint: Mutex::new(None),
        problem: Mutex::new(None),
        runtime_dir,
        app_version: app.package_info().version.to_string(),
        hearing,
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
    pub fn on_opened(&self, o: Opened, summary: String) -> Result<Opened, String> {
        *lock(&self.current) = Some(o.id.clone());
        self.on_opened_background(o, summary)
    }

    /// 画面に出さずに世帯の帳面を作る（まとめて渡すとき。0248）。画面がいま開いている世帯は変えない
    fn on_opened_background(&self, mut o: Opened, summary: String) -> Result<Opened, String> {
        let (mut book, screen) =
            HouseholdBook::from_opened(&o.id, Some(o.customer_no.clone()), o.generation, &o.body)
                .map_err(str::to_owned)?;
        // 架空の印は世帯の一覧の札から（本文には書かない。画面からは付けられない）
        book.fictional = o.label.fictional;
        // 区分の記号も札から（顧客のフォローの要約だけに使う。0248）
        book.category = o.label.category.clone();
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

    /// 区分を変えた・区分の記号を付け替えた後: 帳面の区分の記号を世帯の一覧の札に合わせ、共有中なら渡す中身を置き換える
    /// （顧客のフォローの要約の区分。0248）。一覧を読めなければ何もしない
    pub fn refresh_categories(&self, store: &Store) {
        let Ok(list) = store.list() else { return };
        let mut books = lock(&self.books);
        for h in list {
            let Some(e) = books.get_mut(&h.id) else {
                continue;
            };
            if e.book.category == h.label.category {
                continue;
            }
            e.book.category = h.label.category.clone();
            if let Some(src) = e.book.source() {
                for sid in self.registry.active_share_ids(&h.id) {
                    self.registry.update_source(&sid, src.clone());
                }
            }
        }
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
        self.registry.forget_household_display(id);
        lock(&self.books).remove(id);
        lock(&self.parked).remove(id);
    }

    /// 帳面のうち、まだ書いていない記録を世帯ファイルへ書き戻す（ロックを持った呼び出し元から）
    fn persist_locked(&self, store: &Store, books: &mut HashMap<String, Entry>) {
        self.persist_where(store, books, true, false);
    }

    /// 書き戻す。ただし、ほかのメンバー（ほかの PC）が今開いている世帯は書かずに、閉じた後の見回りに回す（0248 の追記）。
    /// 開いている相手の次の保存が分岐にならないように。取り消し・まとめて渡す・裏の見回りから
    fn persist_quiet(&self, store: &Store, books: &mut HashMap<String, Entry>) {
        self.persist_where(store, books, true, true);
    }

    /// 書き戻す。`now` でないとき（裏の見回り）は、読まれた回数だけの変化を間引く。`quiet` のときは、ほかのメンバーが
    /// 開いている世帯を書かない。間引いた・書かなかった世帯があれば false
    fn persist_where(
        &self,
        store: &Store,
        books: &mut HashMap<String, Entry>,
        now: bool,
        quiet: bool,
    ) -> bool {
        let mut all = true;
        let mut busy: Option<Option<HashSet<String>>> = None;
        for (id, e) in books.iter_mut() {
            let records = self.registry.records(id);
            if !e.book.is_dirty(&records) {
                continue;
            }
            if quiet
                && busy
                    .get_or_insert_with(|| opened_by_others(store))
                    .as_ref()
                    .is_none_or(|b| b.contains(id))
            {
                all = false;
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
            // 画面がいま開いていない世帯は、書く前に世帯ファイルを読み直す（間にほかの保存があっても、その上に記録を足す）。
            // 読み直すのは、帳面だけの変化（同意の記録・候補の判断）が無いときだけ（アプリの終了のときも同じ）
            let records = if lock(&self.current).as_deref() != Some(id.as_str())
                && e.book.only_additions_pending()
            {
                if self.reload_background(store, id, e).is_err() {
                    all = false;
                    continue;
                }
                self.registry.records(id)
            } else {
                records
            };
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

    /// 共有中で、画面がいま開いていない世帯の世帯ファイルを見る（0248 の追記）。一覧から消えた世帯（ほかの PC で完全削除した・見本へ移した）は
    /// 共有を取り消して帳面を捨てる。ほかの世帯は読み直す（同意が無くなっていれば、読み直しで共有が閉じる）。読み直すだけで書かない
    fn check_shared_files(&self, store: &Store) {
        let current = lock(&self.current).clone();
        let mut ids: Vec<String> = self
            .registry
            .active_shares()
            .into_iter()
            .map(|s| s.household_id)
            .filter(|id| current.as_deref() != Some(id.as_str()))
            .collect();
        ids.sort();
        ids.dedup();
        if ids.is_empty() {
            return;
        }
        let Ok(list) = store.list() else { return };
        let mut books = lock(&self.books);
        for id in ids {
            if !list.iter().any(|h| h.id == id) {
                for sid in self.registry.active_share_ids(&id) {
                    self.registry.revoke(&sid);
                }
                self.registry.forget_household_display(&id);
                books.remove(&id);
                lock(&self.parked).remove(&id);
                continue;
            }
            let Some(e) = books.get_mut(&id) else {
                continue;
            };
            // 保存の日時は秒までなので、変わり目を見落とさないよう、間をおいて毎回読み直す（共有中の世帯だけ・50件まで）
            if e.book.only_additions_pending() {
                let _ = self.reload_background(store, &id, e);
            }
        }
    }

    /// 画面がいま開いていない世帯の帳面を、世帯ファイルの今の中身で作り直す（開いた印は変えない。AI の候補は引き継ぎ、記録はこの起動の分と合わせる）
    fn reload_background(&self, store: &Store, id: &str, e: &mut Entry) -> Result<(), String> {
        let o = store.open_unmarked(id).map_err(code)?;
        let (mut book, _) =
            HouseholdBook::from_opened(&o.id, Some(o.customer_no.clone()), o.generation, &o.body)
                .map_err(str::to_owned)?;
        book.fictional = o.label.fictional;
        book.category = o.label.category.clone();
        book.carry_candidates_from(&e.book);
        self.registry.load_records(id, book.file_ai_shares.clone());
        match book.source() {
            Some(src) => {
                for sid in self.registry.active_share_ids(id) {
                    self.registry.update_source(&sid, src.clone());
                }
            }
            // 入力が読めない世帯は渡さない（開いたときと同じ）
            None => {
                for sid in self.registry.active_share_ids(id) {
                    self.registry.revoke(&sid);
                }
            }
        }
        e.book = book;
        Ok(())
    }

    fn persist_all(&self, store: &Store) {
        let mut books = lock(&self.books);
        self.persist_locked(store, &mut books);
    }

    /// 裏の見回り（2秒ごと）: 期限切れを閉じ、届いた候補を帳面に入れ、記録を世帯ファイルへ書き戻す
    fn tick(&self, store: &Store, w: &mut Watch) {
        self.registry.sweep_expired();
        // 共有中の世帯の世帯ファイルを間をおいて見る（ほかの PC での撤回・完全削除に気づく。0248 の追記）
        if w.files_at.is_none_or(|t| t.elapsed() >= FILES_CHECK_EVERY) {
            w.files_at = Some(Instant::now());
            self.check_shared_files(store);
        }
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
        w.waiting = !self.persist_where(store, &mut books, false, true);
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
    /// 共有中の世帯の世帯ファイルを最後に見た時（0248 の追記）
    files_at: Option<Instant>,
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
            current: Mutex::new(None),
            endpoint: Mutex::new(None),
            problem: Mutex::new(None),
            runtime_dir: dir.join("run"),
            app_version: "0.1.0".into(),
            hearing: Arc::new(HearingJobs::default()),
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
pub(crate) fn connector_path() -> Option<PathBuf> {
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
    /// 事務所の設定で FP が「事務所のプライバシーポリシーに AI の利用を書いている」ことを確かめた日時（0226。確かめていなければ None）。
    /// 確かめていると、外部AIへの提供の同意の答えが無い世帯も渡せる（「同意しない」と答えた世帯・撤回した世帯は渡せない）
    privacy_policy_confirmed_at: Option<String>,
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
    /// AIから届いた、表示の設定の案の数（承認待ち。中身は ai_display_candidates で読む。0215）
    display_candidates: usize,
    /// AIから世帯ごとの表示の設定の案が届いている世帯（顧客番号・呼び名・数。中身はその世帯の ai_household の displayProposals）
    household_display_candidates: Vec<HouseholdDisplayPending>,
    /// AI接続口から頼まれた、Web のヒアリングの発行の仕事の数（画面が ai_hearing_jobs で受け取る。0222）
    hearing_jobs: usize,
    /// AIから届いた、Web のヒアリングの事務所のひな形の案の数（承認待ち。中身は ai_hearing_template_candidates で読む。0222）
    hearing_template_candidates: usize,
}

/// 事務所の設定の「事務所のプライバシーポリシーに AI の利用を書いている」の確かめを、共有の台帳に入れる（0226）。
/// 確かめた日時を返す。事務所データを読めなければ確かめていない側（渡せない側）にする
fn sync_office_policy(ai: &AiState, store: &Store) -> Option<String> {
    // AIに渡した記録に、どの PC が作った共有かを残す（ほかの PC の共有を閉じないため。0248 の追記）
    ai.registry.set_device(store.pc_id());
    let at = store.ai_privacy_policy_confirmed_at().ok().flatten();
    if ai.registry.set_office_policy(at.is_some()) > 0 {
        ai.persist_all(store);
    }
    at
}

fn status(ai: &AiState, store: &Store) -> AiStatus {
    let store_ready = store.ai_connector_enabled().is_ok();
    if store_ready {
        ai.ensure_endpoint(store);
    }
    let privacy_policy_confirmed_at = sync_office_policy(ai, store);
    let enabled = store.ai_connector_enabled().unwrap_or(false);
    let path = connector_path();
    let version = path.as_deref().and_then(connector_version);
    let dev = cfg!(debug_assertions);
    AiStatus {
        enabled,
        privacy_policy_confirmed_at,
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
        display_candidates: ai.registry.display_candidates().len(),
        household_display_candidates: ai.registry.household_display_pending(),
        hearing_jobs: ai.hearing.len(),
        hearing_template_candidates: ai.registry.hearing_template_candidates().len(),
    }
}

fn view(ai: &AiState, books: &HashMap<String, Entry>, id: &str) -> Result<HouseholdAiView, String> {
    let e = books.get(id).ok_or_else(|| code(StoreError::NOT_OPEN))?;
    let share = ai
        .registry
        .active_shares()
        .into_iter()
        .find(|s| s.household_id == id);
    let mut v = e
        .book
        .view(&ai.registry.records(id), share, ai.registry.office_policy());
    v.document_proposals = ai.registry.document_proposals(id);
    v.display_proposals = ai.registry.household_display_candidates(id);
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
            ai.registry.clear_display_candidates();
            ai.registry.clear_hearing_templates();
            ai.hearing
                .fail_all("アプリの AI接続口がオフになりました（URL は発行していません）。");
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

/// 事務所の設定の「事務所のプライバシーポリシーに AI の利用を書いている」を確かめた・外した（FP が事務所の設定の画面で操作したときだけ。0226）。
/// 外すと、それを理由に渡していた共有（同意の答えが無い世帯）を、その場で取り消す
#[tauri::command]
pub async fn ai_set_privacy_policy(app: AppHandle, confirmed: bool) -> Result<AiStatus, String> {
    blocking(app, move |ai, store| {
        store
            .set_ai_privacy_policy_confirmed(confirmed)
            .map_err(code)?;
        Ok(status(ai, store))
    })
    .await
}

/// 世帯の「同意とAIの記録」
#[tauri::command]
pub async fn ai_household(app: AppHandle, id: String) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        sync_office_policy(ai, store);
        view(ai, &lock(&ai.books), &id)
    })
    .await
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

/// 世帯をAIに渡す（期限つきの共有を作る）。AI接続口がオンで、渡す理由（同意がある・事務所のプライバシーポリシーを確かめていてお客さまが断っていない・
/// 架空の世帯。0226）があるときだけ
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
        share_start(ai, store, &id, minutes, destination)
    })
    .await
}

/// 1件ずつ渡す（受け口の確かめの後）。期限・申告・上限・ほかの人が開いているか・渡す理由を確かめて共有を作る
pub(crate) fn share_start(
    ai: &AiState,
    store: &Store,
    id: &str,
    minutes: u32,
    destination: String,
) -> Result<HouseholdAiView, String> {
    let id = id.to_owned();
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
    // ほかのメンバーが開いている世帯は渡さない（AIに渡した記録を書くと、相手の次の保存が分岐になる。0248 の追記）
    if opened_by_others(store).is_none_or(|b| b.contains(&id)) {
        return Err("E_AI_OPEN_BY_OTHERS".into());
    }
    // 上限は、まとめて渡すときと同じく共有中の世帯と合わせて数える（0248 の追記）
    if active_households(ai) >= MAX_BULK_SHARES {
        return Err("E_AI_SHARE_LIMIT".into());
    }
    let source = e.book.source().ok_or("E_AI_BODY")?;
    // 渡せるかは共有の台帳が basis の1か所で決める（同意・事務所のプライバシーポリシー・架空の世帯。0226）
    ai.registry.set_office_policy(
        store
            .ai_privacy_policy_confirmed_at()
            .ok()
            .flatten()
            .is_some(),
    );
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
}

/// 世帯の共有を取り消す（即時。取り消した直後の読み取りから REVOKED）
#[tauri::command]
pub async fn ai_share_stop(app: AppHandle, id: String) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, store| {
        for sid in ai.registry.active_share_ids(&id) {
            ai.registry.revoke(&sid);
        }
        let mut books = lock(&ai.books);
        ai.persist_quiet(store, &mut books);
        view(ai, &books, &id)
    })
    .await
}

// ------------------------------------------------------------------ まとめて渡す（0248）

/// まとめて渡すときに渡さなかった世帯の理由（画面は理由ごとに件数と顧客番号を出す）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BulkBlock {
    /// お客さまが「同意しない」と答えた（0226。事務所の設定では上書きしない）
    Refused,
    /// お客さまが同意を撤回した
    Withdrawn,
    /// 同意の答えが無く、事務所のプライバシーポリシーも確かめていない
    NoBasis,
    /// 見本の世帯（見本の棚。AI には渡さない）
    Sample,
    /// 保存していない世帯
    NotSaved,
    /// 閲覧だけで開く世帯（AIに渡した記録を世帯ファイルに残せない）
    ReadOnly,
    /// ほかのメンバー（ほかの PC）が今開いている世帯（AIに渡した記録を書くと、相手の次の保存が分岐になる。0248 の追記）
    OpenByOthers,
    /// 開けなかった世帯（壊れている・鍵が無い・新しい版の形式など）
    Unreadable,
    /// 一覧に無い世帯（消した・ほかの PC で移した）
    Unknown,
}

impl BulkBlock {
    fn of(u: AiUse) -> BulkBlock {
        match u {
            AiUse::Refused => BulkBlock::Refused,
            AiUse::Withdrawn => BulkBlock::Withdrawn,
            _ => BulkBlock::NoBasis,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkHousehold {
    id: String,
    customer_no: String,
    /// 見本の世帯だけ: 見本の名前（見本は番号を持たないので、行はこの名前で出す。0247）
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkReady {
    id: String,
    customer_no: String,
    /// 渡す理由（同意・事務所のプライバシーポリシー・架空の世帯）
    basis: AiUse,
    /// 渡した後だけ: AI に見える仮名（例「共有中の世帯A」。FP が AI の答えの仮名と顧客番号を結びつけるため）
    alias: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkGroup {
    reason: BulkBlock,
    households: Vec<BulkHousehold>,
}

/// まとめて渡す確かめ・結果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkOutcome {
    /// 確かめ: 渡せる世帯。渡した後: 渡した世帯
    ready: Vec<BulkReady>,
    /// もう共有中の世帯（期限はそのまま。新しい共有は作らない）
    already: Vec<BulkHousehold>,
    /// 渡せない・渡さなかった世帯（理由ごと。理由の順）
    blocked: Vec<BulkGroup>,
    /// 上限（共有中の世帯と合わせた数）
    limit: usize,
    /// いま共有中の世帯の数（この確かめ・結果の前）
    active: usize,
}

enum Eval {
    Ready {
        h: BulkHousehold,
        basis: AiUse,
        /// 画面で開いていない世帯: 開いた印を変えずに開いた中身（渡すときに帳面にする）
        opened: Option<Box<(Opened, String)>>,
    },
    Already(BulkHousehold),
    Blocked(BulkBlock, BulkHousehold),
}

/// 見本の名前（見本でなければ None。名前が空なら「名前のない見本」）
fn sample_name(e: &household_store::HouseholdEntry) -> Option<String> {
    let s = e.label.sample.as_ref()?;
    let n = s.name.trim();
    Some(if n.is_empty() {
        "名前のない見本".to_owned()
    } else {
        n.to_owned()
    })
}

/// 共有中の世帯の数（同じ世帯の共有は1つに数える）
fn active_households(ai: &AiState) -> usize {
    let mut ids: Vec<String> = ai
        .registry
        .active_shares()
        .into_iter()
        .map(|s| s.household_id)
        .collect();
    ids.sort();
    ids.dedup();
    ids.len()
}

/// 選んだ世帯の内部IDを、重ねずに並びのまま（空は除く）。上限を超えれば E_AI_BULK_LIMIT
fn bulk_ids(ids: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let id = id.trim();
        if !id.is_empty() && !out.iter().any(|x| x == id) {
            out.push(id.to_owned());
        }
    }
    if out.is_empty() {
        return Err("E_AI_BULK_EMPTY".into());
    }
    if out.len() > MAX_BULK_SHARES {
        return Err("E_AI_BULK_LIMIT".into());
    }
    Ok(out)
}

/// 選んだ世帯を1件ずつ確かめる（渡す理由の判定は 1件ずつと同じ ai_share::ai_use。0226）。共有は作らない
fn bulk_evaluate(ai: &AiState, store: &Store, ids: &[String]) -> Result<Vec<Eval>, String> {
    let customers = store.list().map_err(code)?;
    let samples = store.list_samples().unwrap_or_default();
    let policy = sync_office_policy(ai, store).is_some();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(entry) = customers.iter().find(|e| &e.id == id) else {
            let sample = samples.iter().find(|e| &e.id == id);
            let h = BulkHousehold {
                id: id.clone(),
                customer_no: sample.map(|e| e.customer_no.clone()).unwrap_or_default(),
                name: sample.and_then(sample_name),
            };
            let why = if samples.iter().any(|e| &e.id == id) {
                BulkBlock::Sample
            } else {
                BulkBlock::Unknown
            };
            out.push(Eval::Blocked(why, h));
            continue;
        };
        let h = BulkHousehold {
            id: id.clone(),
            customer_no: entry.customer_no.clone(),
            name: sample_name(entry),
        };
        // 見本は顧客の一覧に入らないが、念のため札でも確かめる（見本は AI に渡さない）
        if entry.label.is_sample() {
            out.push(Eval::Blocked(BulkBlock::Sample, h));
            continue;
        }
        if !ai.registry.active_share_ids(id).is_empty() {
            out.push(Eval::Already(h));
            continue;
        }
        if !entry.open_by.is_empty() {
            out.push(Eval::Blocked(BulkBlock::OpenByOthers, h));
            continue;
        }
        // この起動で前に開いた世帯（画面がいま開いていない世帯）は、世帯ファイルを読み直してから確かめる（ほかの PC での撤回などを見落とさない。
        // 0248 の追記）。画面がいま開いている世帯は、持っている帳面で確かめる（保存の状態を作り直さない）
        if lock(&ai.current).as_deref() != Some(id.as_str()) {
            let mut books = lock(&ai.books);
            if let Some(e) = books.get_mut(id) {
                if e.book.only_additions_pending() && ai.reload_background(store, id, e).is_err() {
                    drop(books);
                    out.push(Eval::Blocked(BulkBlock::Unreadable, h));
                    continue;
                }
            }
        }
        let known = lock(&ai.books).get(id).map(|e| {
            (
                e.book.generation,
                e.book.source().is_some(),
                ai_use(e.book.consent().as_ref(), policy, e.book.fictional),
            )
        });
        if let Some((generation, has_source, basis)) = known {
            out.push(if generation == 0 {
                Eval::Blocked(BulkBlock::NotSaved, h)
            } else if !has_source {
                Eval::Blocked(BulkBlock::Unreadable, h)
            } else if !basis.allowed() {
                Eval::Blocked(BulkBlock::of(basis), h)
            } else {
                Eval::Ready {
                    h,
                    basis,
                    opened: None,
                }
            });
            continue;
        }
        // 確かめでは保存の状態を作らずに読む（渡すときに、改めて開いた印を付けずに開く）
        let Ok(o) = store.read_unmarked(id) else {
            out.push(Eval::Blocked(BulkBlock::Unreadable, h));
            continue;
        };
        if o.read_only {
            out.push(Eval::Blocked(BulkBlock::ReadOnly, h));
            continue;
        }
        let Ok((mut book, _)) =
            HouseholdBook::from_opened(&o.id, Some(o.customer_no.clone()), o.generation, &o.body)
        else {
            out.push(Eval::Blocked(BulkBlock::Unreadable, h));
            continue;
        };
        book.fictional = o.label.fictional;
        let basis = ai_use(book.consent().as_ref(), policy, book.fictional);
        out.push(if book.generation == 0 {
            Eval::Blocked(BulkBlock::NotSaved, h)
        } else if book.source().is_none() {
            Eval::Blocked(BulkBlock::Unreadable, h)
        } else if !basis.allowed() {
            Eval::Blocked(BulkBlock::of(basis), h)
        } else {
            Eval::Ready {
                h,
                basis,
                opened: Some(Box::new((o, entry.summary.clone()))),
            }
        });
    }
    Ok(out)
}

fn outcome(
    ready: Vec<BulkReady>,
    already: Vec<BulkHousehold>,
    blocked: Vec<(BulkBlock, BulkHousehold)>,
    active: usize,
) -> BulkOutcome {
    let mut groups: Vec<BulkGroup> = Vec::new();
    let mut blocked = blocked;
    blocked.sort_by_key(|(r, _)| *r);
    for (reason, h) in blocked {
        match groups.last_mut() {
            Some(g) if g.reason == reason => g.households.push(h),
            _ => groups.push(BulkGroup {
                reason,
                households: vec![h],
            }),
        }
    }
    BulkOutcome {
        ready,
        already,
        blocked: groups,
        limit: MAX_BULK_SHARES,
        active,
    }
}

/// まとめて渡す前の確かめ（共有は作らない。世帯ファイルにも書かない）
pub(crate) fn bulk_check(
    ai: &AiState,
    store: &Store,
    ids: &[String],
) -> Result<BulkOutcome, String> {
    let ids = bulk_ids(ids)?;
    let active = active_households(ai);
    let (mut ready, mut already, mut blocked) = (Vec::new(), Vec::new(), Vec::new());
    for e in bulk_evaluate(ai, store, &ids)? {
        match e {
            Eval::Ready { h, basis, .. } => ready.push(BulkReady {
                id: h.id,
                customer_no: h.customer_no,
                basis,
                alias: None,
            }),
            Eval::Already(h) => already.push(h),
            Eval::Blocked(r, h) => blocked.push((r, h)),
        }
    }
    Ok(outcome(ready, already, blocked, active))
}

/// まとめて渡す（受け口の確かめの後。期限・接続先の申告・縮約版・記録は1件ずつと同じ）。渡せない世帯は渡さずに理由を返す。
/// 共有中の世帯と合わせて上限を超えるときは、1件も渡さずに E_AI_BULK_LIMIT
pub(crate) fn bulk_grant(
    ai: &AiState,
    store: &Store,
    ids: &[String],
    minutes: u32,
    destination: &str,
) -> Result<BulkOutcome, String> {
    if !DURATIONS_MIN.contains(&minutes) {
        return Err("E_AI_DURATION".into());
    }
    let destination = destination.trim().to_owned();
    if destination.is_empty() || destination.chars().count() > MAX_DESTINATION_CHARS {
        return Err("E_AI_DESTINATION".into());
    }
    let ids = bulk_ids(ids)?;
    let active = active_households(ai);
    let evals = bulk_evaluate(ai, store, &ids)?;
    let new = evals
        .iter()
        .filter(|e| matches!(e, Eval::Ready { .. }))
        .count();
    if active + new > MAX_BULK_SHARES {
        return Err("E_AI_BULK_LIMIT".into());
    }
    let (mut ready, mut already, mut blocked) = (Vec::new(), Vec::new(), Vec::new());
    for e in evals {
        let (h, opened) = match e {
            Eval::Ready { h, opened, .. } => (h, opened),
            Eval::Already(h) => {
                already.push(h);
                continue;
            }
            Eval::Blocked(r, h) => {
                blocked.push((r, h));
                continue;
            }
        };
        // 画面で開いていない世帯は、ここで帳面にする（世帯ファイルの AI に渡した記録を読み込み、この後の記録を書き戻せるようにする）。
        // 確かめの間に画面が開いていれば、そちらの帳面を使う
        if let Some(b) = opened {
            let (_, summary) = *b;
            if !lock(&ai.books).contains_key(&h.id) {
                // 渡すときに、開いた印を付けずに開き直す（読まれた記録を書き戻すための保存の状態を作る）
                let opened = store.open_unmarked(&h.id).map_err(code);
                if opened
                    .and_then(|o| ai.on_opened_background(o, summary))
                    .is_err()
                {
                    blocked.push((BulkBlock::Unreadable, h));
                    continue;
                }
            }
        }
        let source = lock(&ai.books).get(&h.id).and_then(|e| e.book.source());
        let Some(source) = source else {
            blocked.push((BulkBlock::Unreadable, h));
            continue;
        };
        if !ai.registry.active_share_ids(&h.id).is_empty() {
            already.push(h);
            continue;
        }
        match ai.registry.grant(
            source,
            GrantOptions {
                scope: Scope::Reduced,
                duration: Duration::from_secs(u64::from(minutes) * 60),
                destination_declared: destination.clone(),
                proceed_without_consent: false,
            },
        ) {
            Ok(g) => ready.push(BulkReady {
                id: h.id,
                customer_no: h.customer_no,
                basis: g.basis,
                alias: Some(g.alias),
            }),
            Err(GrantError::ConsentMissing { state }) => {
                let why = match state.as_str() {
                    "refused" => BulkBlock::Refused,
                    "withdrawn" => BulkBlock::Withdrawn,
                    _ => BulkBlock::NoBasis,
                };
                blocked.push((why, h));
            }
            Err(GrantError::BadDuration) => return Err("E_AI_DURATION".into()),
            Err(GrantError::DestinationMissing) => return Err("E_AI_DESTINATION".into()),
            Err(GrantError::NotAddable(_)) => return Err("E_AI_SCOPE".into()),
        }
    }
    let mut books = lock(&ai.books);
    ai.persist_quiet(store, &mut books);
    drop(books);
    // 書き戻しの読み直しで閉じた共有（ほかの PC で同意が無くなっていた など）は、渡した世帯から外して理由つきで返す（0248 の追記）
    let (still, closed): (Vec<BulkReady>, Vec<BulkReady>) = ready
        .into_iter()
        .partition(|r| !ai.registry.active_share_ids(&r.id).is_empty());
    let policy = ai.registry.office_policy();
    for r in closed {
        let why = lock(&ai.books)
            .get(&r.id)
            .map(|e| BulkBlock::of(ai_use(e.book.consent().as_ref(), policy, e.book.fictional)))
            .unwrap_or(BulkBlock::Unknown);
        blocked.push((
            why,
            BulkHousehold {
                id: r.id,
                customer_no: r.customer_no,
                name: None,
            },
        ));
    }
    Ok(outcome(still, already, blocked, active))
}

/// まとめて取り消す（選んだ世帯の共有をすべて。即時）。取り消した世帯の数を返す
pub(crate) fn bulk_revoke(ai: &AiState, store: &Store, ids: &[String]) -> usize {
    // 選んだ世帯のうち共有中の世帯だけを、共有中の一覧から探す（選んだ数では切らない）
    let chosen: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let mut done: HashSet<String> = HashSet::new();
    for s in ai.registry.active_shares() {
        if chosen.contains(s.household_id.as_str()) && ai.registry.revoke(&s.share_id) {
            done.insert(s.household_id);
        }
    }
    let n = done.len();
    let mut books = lock(&ai.books);
    ai.persist_quiet(store, &mut books);
    n
}

/// まとめて渡す前の確かめ（世帯の一覧で選んだ世帯。渡せる世帯・もう共有中の世帯・渡せない世帯を理由ごとに。共有は作らない。0248）
#[tauri::command]
pub async fn ai_share_bulk_check(app: AppHandle, ids: Vec<String>) -> Result<BulkOutcome, String> {
    blocking(app, move |ai, store| bulk_check(ai, store, &ids)).await
}

/// 選んだ世帯をまとめて AI に渡す（1件ずつと同じ確かめ・期限・申告・記録。渡せない世帯は渡さずに理由を返す。0248）
#[tauri::command]
pub async fn ai_share_bulk_start(
    app: AppHandle,
    ids: Vec<String>,
    minutes: u32,
    destination: String,
) -> Result<BulkOutcome, String> {
    blocking(app, move |ai, store| {
        if !store.ai_connector_enabled().map_err(code)? {
            return Err("E_AI_OFF".into());
        }
        ai.ensure_endpoint(store);
        if lock(&ai.endpoint).is_none() {
            return Err("E_AI_ENDPOINT".into());
        }
        bulk_grant(ai, store, &ids, minutes, &destination)
    })
    .await
}

/// 選んだ世帯の共有をまとめて取り消す（即時。0248）。取り消した世帯の数
#[tauri::command]
pub async fn ai_share_bulk_stop(app: AppHandle, ids: Vec<String>) -> Result<usize, String> {
    blocking(app, move |ai, store| Ok(bulk_revoke(ai, store, &ids))).await
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

/// AIから届いた、表示の設定の案（承認待ち。届いた順。0215）。中身は信用しない: 画面が表示の設定の一覧の選べる値で確かめてから「今 → 案」を出す
#[tauri::command]
pub async fn ai_display_candidates(app: AppHandle) -> Result<Vec<DisplayCandidate>, String> {
    blocking(app, |ai, _| Ok(ai.registry.display_candidates())).await
}

/// 表示の設定の案の1つの設定を、承認待ちから外す（FPが画面で「反映する」を押して事務所の既定値に書いた後か、「捨てる」を押したとき）。
/// 本体は設定を変えない（反映は画面が事務所の既定値の保存の命令で書く）
#[tauri::command]
pub async fn ai_display_change_take(
    app: AppHandle,
    candidate: String,
    setting: String,
) -> Result<Vec<DisplayCandidate>, String> {
    blocking(app, move |ai, _| {
        ai.registry
            .take_display_change(&candidate, &setting)
            .ok_or("E_AI_CANDIDATE_UNKNOWN")?;
        Ok(ai.registry.display_candidates())
    })
    .await
}

/// 世帯ごとの表示の設定の案の1つの設定を、承認待ちから外す（FPがその世帯を開いて「反映する」を押し、画面がその世帯に書いた後か、「捨てる」を押したとき）。
/// 本体は設定を変えない（反映は画面がその世帯の表示の設定に書き、自動保存で世帯ファイルに書く）
/// Web のヒアリングの発行の仕事（AI 接続口から頼まれ、画面の答えを待っている物。0222）。見直しを含む世帯の依頼には、前回の値を作るための
/// その世帯の本文を添える（画面がその世帯を開いていないとき使う。AI には渡さない）
#[tauri::command]
pub async fn ai_hearing_jobs(app: AppHandle) -> Result<Vec<HearingJobView>, String> {
    blocking(app, |ai, _| {
        let books = lock(&ai.books);
        Ok(lock(&ai.hearing.list)
            .iter()
            .map(|j| {
                let h = j.job.household.as_ref();
                let review = ai_share::hearing::has_review(&j.job.issue["selection"]);
                HearingJobView {
                    job_id: j.id.clone(),
                    issue: j.job.issue.clone(),
                    household_id: h.map(|h| h.household_id.clone()),
                    customer_number: h.and_then(|h| h.customer_number.clone()),
                    body: h
                        .filter(|_| review)
                        .and_then(|h| books.get(&h.household_id))
                        .map(|e| e.book.screen_body()),
                    connector: j.job.connector.clone(),
                    received_at: j.job.received_at.clone(),
                }
            })
            .collect())
    })
    .await
}

/// Web のヒアリングの発行の仕事の答え（画面が発行して記録を書いた後か、断ったとき。`result` は `{ ok, … }`）。もう待っていなければ false
#[tauri::command]
pub async fn ai_hearing_job_done(
    app: AppHandle,
    job: String,
    result: serde_json::Value,
) -> Result<bool, String> {
    blocking(app, move |ai, _| Ok(ai.hearing.done(&job, result))).await
}

/// AIからの Web のヒアリングの事務所のひな形の案（承認待ち。0222）
#[tauri::command]
pub async fn ai_hearing_template_candidates(
    app: AppHandle,
) -> Result<Vec<HearingTemplateCandidate>, String> {
    blocking(app, |ai, _| Ok(ai.registry.hearing_template_candidates())).await
}

/// Web のヒアリングの事務所のひな形の案を承認待ちから外す（FP が画面で保存した後か、「捨てる」を押したとき。事務所の既定値は変えない）
#[tauri::command]
pub async fn ai_hearing_template_take(
    app: AppHandle,
    candidate: String,
) -> Result<Vec<HearingTemplateCandidate>, String> {
    blocking(app, move |ai, _| {
        ai.registry.take_hearing_template(&candidate);
        Ok(ai.registry.hearing_template_candidates())
    })
    .await
}

#[tauri::command]
pub async fn ai_household_display_take(
    app: AppHandle,
    id: String,
    candidate: String,
    setting: String,
) -> Result<HouseholdAiView, String> {
    blocking(app, move |ai, _| {
        ai.registry
            .take_household_display_change(&id, &candidate, &setting)
            .ok_or("E_AI_CANDIDATE_UNKNOWN")?;
        view(ai, &lock(&ai.books), &id)
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
            ..Default::default()
        },
    )?;
    ai.registry.take_household_candidate(candidate);
    Ok(o)
}

#[cfg(test)]
mod tests {
    use super::HearingJobs;

    fn hearing_job() -> ai_share::HearingJob {
        ai_share::HearingJob {
            issue: serde_json::json!({ "selection": {} }),
            household: None,
            connector: Some("test-ai 1.0".into()),
            received_at: "2026-11-17T00:00:00Z".into(),
        }
    }

    /// Web のヒアリングの発行の仕事（0222）: 画面が受け取って答えると、待っていた依頼に答えが届く。答えないと時間切れで外す。
    /// AI接続口をオフにすると、待っている仕事を全部断る
    #[test]
    fn hearing_jobs_wait_for_the_screen() {
        let jobs = std::sync::Arc::new(HearingJobs::default());
        let j2 = jobs.clone();
        let waiter = std::thread::spawn(move || {
            j2.submit_within(hearing_job(), std::time::Duration::from_secs(10))
        });
        while jobs.len() == 0 {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let id = super::lock(&jobs.list)[0].id.clone();
        assert!(!jobs.done("j-unknown", serde_json::json!({})));
        assert!(jobs.done(
            &id,
            serde_json::json!({ "ok": true, "requestId": "R-TEST01" })
        ));
        let got = waiter.join().unwrap().unwrap();
        assert_eq!(got["requestId"], "R-TEST01");
        assert_eq!(jobs.len(), 0);
        // 答えが無いと時間切れで外す（発行されたかはアプリで確かめるよう伝える）
        let e = jobs
            .submit_within(hearing_job(), std::time::Duration::from_millis(30))
            .unwrap_err();
        assert!(e.contains("時間内に答えませんでした"), "{e}");
        assert_eq!(jobs.len(), 0);
        // オフにしたら断る
        let j3 = jobs.clone();
        let waiter = std::thread::spawn(move || {
            j3.submit_within(hearing_job(), std::time::Duration::from_secs(10))
        });
        while jobs.len() == 0 {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        jobs.fail_all("オフ");
        assert_eq!(waiter.join().unwrap().unwrap_err(), "オフ");
    }

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

    /// AI接続口の表示の設定に返す事務所の既定値は、見せ方だけの欄（0213）。計算の設定・推定の値・名前やロゴ・ヒアリングのひな形は返さない
    #[test]
    fn office_display_is_cut_from_the_office_defaults() {
        let root = root("office-display");
        let secrets = Arc::new(MemorySecretStore::default());
        let p = pc(&root, &secrets);
        p.store
            .set_office_defaults(serde_json::json!({
                "levers": { "shown": ["lever:nisaMonthly"] },
                "scenes": { "open": "income" },
                "assumptions": { "inflation": "0.02" },
                "estimates": { "values": {}, "noFill": ["engine.care"] },
                "branding": { "name": "事務所" },
                "hearingTemplates": [],
                "features": { "combinedBs": true },
                "endAge": 95,
                // 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値（0213 の段C）は渡し、AI の案を反映する前の値は渡さない
                "display": { "result": { "atAge": 90, "metrics": ["takeHome"] }, "balance": { "points": ["now", "age80"] } },
                "displayHistory": { "result.atAge": [{ "value": 95, "at": "2026-11-15T00:00:00Z", "reason": "ai" }] },
            }))
            .unwrap();
        let v = office_display_of(&p.store, &[]).unwrap();
        assert_eq!(v["levers"]["shown"][0], "lever:nisaMonthly");
        assert_eq!(v["display"]["result"]["atAge"], 90);
        assert_eq!(v["display"]["balance"]["points"][1], "age80");
        assert_eq!(v["scenes"]["open"], "income");
        assert_eq!(v["features"]["combinedBs"], true);
        assert_eq!(v["featureCodes"], serde_json::json!([]));
        for k in [
            "assumptions",
            "estimates",
            "branding",
            "hearingTemplates",
            "endAge",
            "displayHistory",
        ] {
            assert!(v.get(k).is_none(), "{k} は返さない");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 渡された世帯ごとの表示の設定の案（0213 の段B の後半）: その世帯の「同意とAIの記録」に出て、状態にはどの世帯に届いたかが出る。
    /// 案を出したことは世帯ファイルの AIに渡した記録に残り、案そのものは世帯ファイルに書かない。設定ごとに外せ、世帯を消す前には消える
    #[test]
    fn household_display_proposals_reach_the_household_view() {
        let root = root("display-household");
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
        let r: serde_json::Value = serde_json::from_str(
            &pc1.ai
                .registry
                .handle_propose_share_display(
                    &share,
                    &serde_json::json!({ "changes": [
                        { "id": "result.atAge", "value": 85 },
                        { "id": "balance.health", "value": false }
                    ] }),
                    &ai_share::record::Caller::default(),
                )
                .unwrap(),
        )
        .unwrap();
        let candidate = r["candidateId"].as_str().unwrap().to_owned();
        let v = view(&pc1.ai, &lock(&pc1.ai.books), &id).unwrap();
        assert_eq!(v.display_proposals.len(), 1);
        assert_eq!(v.display_proposals[0].changes.len(), 2);
        let st = pc1.ai.registry.household_display_pending();
        assert_eq!(st.len(), 1);
        assert_eq!(st[0].household_id, id);
        assert_eq!(st[0].count, 2);
        // 記録は世帯ファイルに書く（案を出したこと）。案そのもの（値・理由）は書かない
        pc1.ai.persist_all(&pc1.store);
        let file = file_sections(&root, &secrets, &id);
        let text = file.to_string();
        assert!(text.contains(&candidate), "記録の proposals に残る");
        assert!(
            !text.contains("balance.health"),
            "案の中身は世帯ファイルに書かない"
        );
        // 設定ごとに外す（全部外れたら案ごと）
        assert!(pc1
            .ai
            .registry
            .take_household_display_change(&id, &candidate, "result.atAge")
            .is_some());
        let v = view(&pc1.ai, &lock(&pc1.ai.books), &id).unwrap();
        assert_eq!(v.display_proposals[0].changes.len(), 1);
        // 世帯を消す前には消える
        pc1.ai.on_deleting(&id);
        assert!(pc1.ai.registry.household_display_pending().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 見本を完全削除するとき（確かめは見本の名前。0247）も、先に AI への共有を取り消して帳面を捨てる。空白だけの確かめでは何もしない
    #[test]
    fn deleting_a_sample_by_its_name_revokes_shares_and_forgets_the_book() {
        let root = root("delete-sample");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        let o = pc1
            .store
            .create_with(
                CreateRequest {
                    body: body(),
                    summary: "本人".into(),
                },
                CreateOptions {
                    sample: Some(household_store::SampleRequest {
                        family: 1,
                        age: 2,
                        name: "研修用".into(),
                        traits: vec![],
                        origin: None,
                    }),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(o.customer_no, "");
        let id = o.id.clone();
        pc1.open(&id);
        pc1.record(&id, "given");
        let share = pc1
            .share(&id)
            .expect("本体は見本でも渡せる（画面が止めている）");
        assert!(!pc1.ai.registry.active_share_ids(&id).is_empty());
        // 空白だけ・違う名前では、共有も帳面もそのまま
        for wrong in [" ", "", "研修"] {
            assert!(crate::store::delete_household(&pc1.store, &pc1.ai, &id, wrong).is_err());
            assert!(lock(&pc1.ai.books).contains_key(&id), "{wrong:?}");
            assert!(pc1.ai.registry.active_share_ids(&id).contains(&share));
        }
        // 見本の名前で消すと、共有が取り消され帳面も消える
        crate::store::delete_household(&pc1.store, &pc1.ai, &id, " 研修用 ").unwrap();
        assert!(pc1.ai.registry.active_share_ids(&id).is_empty());
        assert!(!lock(&pc1.ai.books).contains_key(&id));
        assert!(pc1.store.list_samples().unwrap().is_empty());
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
        // 今の形式の版で書く（見本の持ち方〔0247〕で 0.87 になった。版を上げたら、この確かめの数も上げる）。開き直しても閲覧だけにならない
        assert_eq!(
            file["meta"]["formatVersion"],
            household_store::migrate::CURRENT
        );
        assert_eq!(file["meta"]["formatVersion"], "0.87");
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

    // ---------------------------------------------------------------- まとめて渡す（0248）

    /// 区分を使う（A 顧問契約・B 単発相談・C 見込み客）
    fn use_categories(p: &Pc) {
        let edit = |code: &str, name: &str| household_store::CategoryEdit {
            from: None,
            code: code.into(),
            name: name.into(),
        };
        p.store
            .set_categories(&[
                edit("A", "顧問契約"),
                edit("B", "単発相談"),
                edit("C", "見込み客"),
            ])
            .unwrap();
    }

    fn create(p: &Pc, category: Option<&str>, fictional: bool) -> String {
        crate::store::create_household(
            &p.store,
            &p.ai,
            body(),
            "本人".into(),
            CreateOptions {
                category: category.map(str::to_owned),
                sample: None,
                fictional,
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    fn reasons(o: &BulkOutcome) -> Vec<(BulkBlock, Vec<String>)> {
        o.blocked
            .iter()
            .map(|g| {
                (
                    g.reason,
                    g.households.iter().map(|h| h.id.clone()).collect(),
                )
            })
            .collect()
    }

    fn ready_ids(o: &BulkOutcome) -> Vec<String> {
        o.ready.iter().map(|r| r.id.clone()).collect()
    }

    /// 渡せる世帯と渡せない世帯が混ざったとき: 渡せる世帯だけ渡し、渡せない世帯は理由ごとに返す。見本は渡さない。
    /// 画面で開いていない世帯は、開いた印（前回開いた世帯）を変えずに開き、AIに渡した記録を世帯ファイルに残す
    #[test]
    fn bulk_share_mixes_shareable_and_blocked_households() {
        let root = root("bulk-mixed");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        use_categories(&pc1);
        let given = create(&pc1, Some("A"), false);
        let refused = create(&pc1, Some("A"), false);
        let withdrawn = create(&pc1, Some("A"), false);
        let none = create(&pc1, Some("B"), false);
        let fictional = create(&pc1, Some("C"), true);
        pc1.record(&given, "given");
        pc1.record(&refused, "refused");
        pc1.record(&withdrawn, "given");
        pc1.record(&withdrawn, "withdrawn");
        let sample = pc1
            .store
            .create_with(
                CreateRequest {
                    body: body(),
                    summary: "本人".into(),
                },
                CreateOptions {
                    category: None,
                    sample: Some(household_store::SampleRequest {
                        family: 1,
                        age: 3,
                        name: "見本".into(),
                        traits: vec![],
                        origin: None,
                    }),
                    fictional: false,
                    ..Default::default()
                },
            )
            .unwrap()
            .id;
        // アプリを開き直した PC（まだどの世帯も開いていない）で、画面は「同意あり」の世帯を開いている
        let pc2 = pc(&root, &secrets);
        pc2.open(&given);
        // 見本を画面で開いていても、まとめて渡す対象にはしない
        pc2.open(&sample);
        pc2.open(&given);
        let last = || pc2.store.status().unwrap().last_opened;
        assert_eq!(last().as_deref(), Some(given.as_str()));
        let ids: Vec<String> = [
            &given, &refused, &withdrawn, &none, &fictional, &sample, &given,
        ]
        .iter()
        .map(|s| (*s).clone())
        .collect();

        // 確かめ: 共有は作らず、帳面も作らない。保存の状態も作らない（確かめた世帯はこの戻り値では保存できない）
        let c = bulk_check(&pc2.ai, &pc2.store, &ids).unwrap();
        assert_eq!(
            pc2.store.save(&fictional, &body(), "本人").unwrap_err(),
            StoreError::NOT_OPEN
        );
        assert_eq!(ready_ids(&c), vec![given.clone(), fictional.clone()]);
        assert_eq!(
            reasons(&c),
            vec![
                (BulkBlock::Refused, vec![refused.clone()]),
                (BulkBlock::Withdrawn, vec![withdrawn.clone()]),
                (BulkBlock::NoBasis, vec![none.clone()]),
                (BulkBlock::Sample, vec![sample.clone()]),
            ]
        );
        assert_eq!((c.limit, c.active), (MAX_BULK_SHARES, 0));
        // 見本は番号を持たないので、断った行は見本の名前で出す（行を空白にしない。0247）。顧客の行は名前を持たない
        let sample_row = &c
            .blocked
            .iter()
            .find(|g| g.reason == BulkBlock::Sample)
            .unwrap()
            .households[0];
        assert_eq!(sample_row.name.as_deref(), Some("見本"));
        assert!(c
            .blocked
            .iter()
            .filter(|g| g.reason != BulkBlock::Sample)
            .all(|g| g
                .households
                .iter()
                .all(|h| h.name.is_none() && !h.customer_no.is_empty())));
        let json = serde_json::to_value(&c).unwrap();
        assert!(json.to_string().contains("\"name\":\"見本\""));
        assert!(pc2.ai.registry.active_shares().is_empty());
        assert!(!lock(&pc2.ai.books).contains_key(&fictional));
        assert_eq!(
            last().as_deref(),
            Some(given.as_str()),
            "開いた印は変えない"
        );

        // 期限・申告の確かめは1件ずつと同じ
        assert_eq!(
            bulk_grant(&pc2.ai, &pc2.store, &ids, 7, "AIのアプリ").unwrap_err(),
            "E_AI_DURATION"
        );
        assert_eq!(
            bulk_grant(&pc2.ai, &pc2.store, &ids, 60, " ").unwrap_err(),
            "E_AI_DESTINATION"
        );
        // 渡す: 渡せる世帯だけ
        let g = bulk_grant(&pc2.ai, &pc2.store, &ids, 60, "AIのアプリ").unwrap();
        assert_eq!(ready_ids(&g), vec![given.clone(), fictional.clone()]);
        assert_eq!(g.ready[1].basis, AiUse::Fictional);
        assert!(g.ready.iter().all(|r| r
            .alias
            .as_deref()
            .is_some_and(|a| a.starts_with("共有中の世帯"))));
        assert!(c.ready.iter().all(|r| r.alias.is_none()));
        assert_eq!(g.blocked.len(), 4);
        let shares = pc2.ai.registry.active_shares();
        assert_eq!(shares.len(), 2);
        assert!(shares
            .iter()
            .all(|s| s.household_id == given || s.household_id == fictional));
        assert_eq!(
            last().as_deref(),
            Some(given.as_str()),
            "開いた印は変えない"
        );
        // 開いていなかった世帯も、AIに渡した記録が世帯ファイルに残る（申告・期限も1件ずつと同じ）
        let file = file_sections(&root, &secrets, &fictional);
        assert_eq!(file["aiShares"][0]["destinationDeclared"], "AIのアプリ");
        assert_eq!(file["aiShares"][0]["consentAtGrant"]["state"], "fictional");
        // 読まれた記録も書き戻す。フォローの要約の区分は札から
        let sid = shares
            .iter()
            .find(|s| s.household_id == fictional)
            .unwrap()
            .share_id
            .clone();
        let out = pc2
            .ai
            .registry
            .handle_get_followup(&sid, "summarize_shared_households", &Default::default())
            .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["followup"]["category"], "C");
        assert!(!out.contains(&fictional), "内部ID は渡さない");
        pc2.ai.persist_all(&pc2.store);
        let file = file_sections(&root, &secrets, &fictional);
        assert_eq!(
            file["aiShares"][0]["reads"][0]["tool"],
            "summarize_shared_households"
        );

        // もう一度: 共有中の世帯は「もう共有中」（新しい共有は作らない）
        let again = bulk_grant(&pc2.ai, &pc2.store, &ids, 60, "AIのアプリ").unwrap();
        assert!(again.ready.is_empty());
        assert_eq!(again.already.len(), 2);
        assert_eq!(again.active, 2);
        assert_eq!(pc2.ai.registry.active_shares().len(), 2);

        // 事務所のプライバシーポリシーを確かめると、同意の答えが無い世帯も渡せる（断った・撤回した世帯は渡せない）
        pc2.store.set_ai_privacy_policy_confirmed(true).unwrap();
        let p = bulk_grant(&pc2.ai, &pc2.store, &ids, 60, "AIのアプリ").unwrap();
        assert_eq!(ready_ids(&p), vec![none.clone()]);
        assert_eq!(p.ready[0].basis, AiUse::OfficePolicy);
        assert_eq!(
            reasons(&p),
            vec![
                (BulkBlock::Refused, vec![refused.clone()]),
                (BulkBlock::Withdrawn, vec![withdrawn.clone()]),
                (BulkBlock::Sample, vec![sample.clone()]),
            ]
        );

        // まとめて取り消す
        assert_eq!(bulk_revoke(&pc2.ai, &pc2.store, &ids), 3);
        assert!(pc2.ai.registry.active_shares().is_empty());
        let file = file_sections(&root, &secrets, &none);
        assert_eq!(file["aiShares"][0]["endReason"], "revoked");
        // 空の選択・知らない世帯
        assert_eq!(
            bulk_check(&pc2.ai, &pc2.store, &[" ".into()]).unwrap_err(),
            "E_AI_BULK_EMPTY"
        );
        let unknown = bulk_check(
            &pc2.ai,
            &pc2.store,
            &["00000000-0000-4000-8000-000000000000".into()],
        )
        .unwrap();
        assert_eq!(reasons(&unknown)[0].0, BulkBlock::Unknown);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 上限ちょうど（50件）は渡せ、超えると1件も渡さない（選んだ数・共有中と合わせた数のどちらも）
    #[test]
    fn bulk_share_limit() {
        let root = root("bulk-limit");
        let secrets = Arc::new(MemorySecretStore::default());
        let pc1 = pc(&root, &secrets);
        use_categories(&pc1);
        pc1.store.set_ai_privacy_policy_confirmed(true).unwrap();
        let ids: Vec<String> = (0..=MAX_BULK_SHARES)
            .map(|_| create(&pc1, Some("A"), false))
            .collect();
        let (first, last) = ids.split_at(MAX_BULK_SHARES);
        assert_eq!(
            bulk_check(&pc1.ai, &pc1.store, &ids).unwrap_err(),
            "E_AI_BULK_LIMIT"
        );
        assert_eq!(
            bulk_grant(&pc1.ai, &pc1.store, &ids, 60, "AIのアプリ").unwrap_err(),
            "E_AI_BULK_LIMIT"
        );
        assert!(pc1.ai.registry.active_shares().is_empty());
        let ok = bulk_grant(&pc1.ai, &pc1.store, first, 60, "AIのアプリ").unwrap();
        assert_eq!(ok.ready.len(), MAX_BULK_SHARES);
        // 共有中の50件と合わせると超える
        assert_eq!(
            bulk_grant(&pc1.ai, &pc1.store, last, 60, "AIのアプリ").unwrap_err(),
            "E_AI_BULK_LIMIT"
        );
        assert_eq!(pc1.ai.registry.active_shares().len(), MAX_BULK_SHARES);
        // 確かめは数を返すだけ（画面が上限を出す）
        let c = bulk_check(&pc1.ai, &pc1.store, last).unwrap();
        assert_eq!((c.ready.len(), c.active), (1, MAX_BULK_SHARES));
        // 1件ずつ渡すときも、共有中の世帯と合わせて数える（0248 の追記）
        assert_eq!(
            share_start(&pc1.ai, &pc1.store, &last[0], 60, "AIのアプリ".into()).unwrap_err(),
            "E_AI_SHARE_LIMIT"
        );
        // まとめて取り消すは、選んだ数で切らずに共有中の世帯から探す（選んだ世帯に共有の無い世帯が混ざっていても）
        let mut many: Vec<String> = (0..1500).map(|i| format!("x-{i}")).collect();
        many.push(first[0].clone());
        // 1件取り消すと渡せる
        assert_eq!(bulk_revoke(&pc1.ai, &pc1.store, &many), 1);
        assert_eq!(
            bulk_grant(&pc1.ai, &pc1.store, last, 60, "AIのアプリ")
                .unwrap()
                .ready
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 事務所の共有で、ほかのメンバーが開いている世帯（0248 の追記）: 開いた印を付けずに開いて記録を書き戻すと、相手の次の保存が分岐になる。
    /// そのため、まとめて渡すとき・1件ずつ渡すときに断り、渡した後に相手が開いたら、相手が閉じるまで記録を書き戻さない
    #[test]
    fn households_open_on_another_pc_are_not_shared_or_written() {
        let base = root("bulk-office");
        let shared = base.join("共有フォルダ");
        std::fs::create_dir_all(&shared).unwrap();
        let a = pc(&base.join("pc-a"), &Arc::new(MemorySecretStore::default()));
        let b = pc(&base.join("pc-b"), &Arc::new(MemorySecretStore::default()));
        a.store.office_start(&shared, "担当A", true, &[]).unwrap();
        a.store.acknowledge_recovery().unwrap();
        let st = b.store.office_join(&shared, "担当B", true, &[]).unwrap();
        let req = a.store.office_status().unwrap().requests;
        a.store
            .office_approve(&req[0].request_id, &st.my_fingerprint.unwrap())
            .unwrap();
        assert_eq!(b.store.office_status().unwrap().state, "member");
        a.store.set_ai_privacy_policy_confirmed(true).unwrap();
        let x = create(&a, None, false);
        let y = create(&a, None, false);
        let z = create(&a, None, false);

        // 分岐が起きることの確かめ: B が開いている間に、A が開いた印なしで開いて書くと、B の次の保存は分岐になる
        let ob = b.store.open(&x).unwrap();
        let o = a.store.open_unmarked(&x).unwrap();
        a.store.save(&x, &o.body, "本人").unwrap();
        assert_eq!(
            b.store.save(&x, &ob.body, "本人").unwrap_err(),
            StoreError::CONFLICT
        );

        // まとめて渡す: B が開いている世帯は断る
        let ids = vec![x.clone(), y.clone()];
        let c = bulk_check(&a.ai, &a.store, &ids).unwrap();
        assert_eq!(ready_ids(&c), vec![y.clone()]);
        assert_eq!(
            reasons(&c),
            vec![(BulkBlock::OpenByOthers, vec![x.clone()])]
        );
        let g = bulk_grant(&a.ai, &a.store, &ids, 60, "AIのアプリ").unwrap();
        assert_eq!(ready_ids(&g), vec![y.clone()]);

        // 渡した後に B が開いたら、AI に読まれても A は書き戻さない（B の保存は分岐にならない）
        let oy = b.store.open(&y).unwrap();
        let sid = a.ai.registry.active_shares()[0].share_id.clone();
        a.ai_reads(&sid);
        let mut w = Watch::default();
        a.tick(&mut w);
        assert!(w.waiting, "書かずに待つ");
        b.store.save(&y, &oy.body, "本人").unwrap();
        // 取り消しも、B が開いている間は書かない
        assert_eq!(bulk_revoke(&a.ai, &a.store, std::slice::from_ref(&y)), 1);
        // B が別の世帯を開く（y を閉じる）と、次の見回りで書く
        b.store.open(&z).unwrap();
        a.tick(&mut w);
        assert!(!w.waiting);
        let back = b.store.open(&y).unwrap();
        let file: serde_json::Value = serde_json::from_str(&back.body).unwrap();
        assert_eq!(file["aiShares"][0]["endReason"], "revoked");
        assert_eq!(file["aiShares"][0]["reads"][0]["count"], 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 事務所の共有（A が始め、B が参加する）
    fn office(name: &str) -> (PathBuf, Pc, Pc) {
        let base = root(name);
        let shared = base.join("共有フォルダ");
        std::fs::create_dir_all(&shared).unwrap();
        let a = pc(&base.join("pc-a"), &Arc::new(MemorySecretStore::default()));
        let b = pc(&base.join("pc-b"), &Arc::new(MemorySecretStore::default()));
        a.store.office_start(&shared, "担当A", true, &[]).unwrap();
        a.store.acknowledge_recovery().unwrap();
        let st = b.store.office_join(&shared, "担当B", true, &[]).unwrap();
        let req = a.store.office_status().unwrap().requests;
        a.store
            .office_approve(&req[0].request_id, &st.my_fingerprint.unwrap())
            .unwrap();
        assert_eq!(b.store.office_status().unwrap().state, "member");
        for p in [&a, &b] {
            p.ai.registry.set_device(p.store.pc_id());
        }
        (base, a, b)
    }

    /// 世帯ファイルの記録（申告・終わりの理由・読まれた回数）
    fn file_records(p: &Pc, id: &str) -> Vec<(String, serde_json::Value, u64)> {
        let o = p.store.open_unmarked(id).unwrap();
        let f: serde_json::Value = serde_json::from_str(&o.body).unwrap();
        f["aiShares"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|r| {
                        (
                            r["destinationDeclared"].as_str().unwrap_or("").to_owned(),
                            r["endReason"].clone(),
                            r["reads"].as_array().map_or(0, |x| {
                                x.iter().map(|y| y["count"].as_u64().unwrap_or(0)).sum()
                            }),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 2台が同じ世帯をそれぞれ渡しているとき（0248 の追記）: 片方の書き戻しが、相手の渡している最中の記録を「アプリの終了」で閉じない。
    /// どちらの記録も終わらず、読まれた回数が残る
    #[test]
    fn two_pcs_sharing_the_same_household_keep_each_others_records() {
        let (base, a, b) = office("two-pcs");
        let x = create(&a, None, false);
        a.record(&x, "given");
        let _ = create(&a, None, false);
        let ids = vec![x.clone()];
        bulk_grant(&a.ai, &a.store, &ids, 60, "AのAI").unwrap();
        let gb = bulk_grant(&b.ai, &b.store, &ids, 60, "BのAI").unwrap();
        assert_eq!(gb.ready.len(), 1, "{:?}", reasons(&gb));
        let sa = a.ai.registry.active_shares()[0].share_id.clone();
        let sb = b.ai.registry.active_shares()[0].share_id.clone();
        let (mut wa, mut wb) = (Watch::default(), Watch::default());
        a.ai_reads(&sa);
        a.tick(&mut wa);
        b.ai_reads(&sb);
        b.tick(&mut wb);
        b.ai_reads(&sb);
        b.ai.persist_all(&b.store);
        a.ai_reads(&sa);
        a.ai.persist_all(&a.store);
        let recs = file_records(&a, &x);
        assert_eq!(recs.len(), 2, "{recs:?}");
        for (who, end, reads) in &recs {
            assert_eq!(
                *end,
                serde_json::Value::Null,
                "{who} の記録が閉じられた: {recs:?}"
            );
            assert_eq!(*reads, 2, "{who}: {recs:?}");
        }
        // 1件ずつ: A が渡した後に、B が画面で開いて保存しても、A の記録は閉じない
        let y = create(&a, None, false);
        a.record(&y, "given");
        let sy = a.share(&y).unwrap();
        let _ = create(&a, None, false);
        let ob = b.open(&y);
        crate::store::create_household(
            &b.store,
            &b.ai,
            body(),
            "本人".into(),
            CreateOptions::default(),
        )
        .ok();
        let _ = ob;
        a.ai_reads(&sy);
        a.tick(&mut wa);
        let recs = file_records(&a, &y);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].1, serde_json::Value::Null, "{recs:?}");
        assert_eq!(recs[0].2, 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    fn read_ok(p: &Pc, sid: &str) -> bool {
        p.ai.registry
            .handle_get(sid, "get_shared_household", &Default::default())
            .is_ok()
    }

    /// 見回りの「世帯ファイルを見る」間隔を待たずに、次の見回りで見る
    fn tick_now(p: &Pc, w: &mut Watch) {
        w.files_at = None;
        p.tick(w);
    }

    /// 前に開いた世帯（いまは画面に無い）の同意を、ほかの PC で撤回した後にまとめて渡す（0248 の追記）: 世帯ファイルを読み直して確かめるので、渡さない
    #[test]
    fn bulk_check_reads_the_file_again_for_households_opened_earlier() {
        let (base, a, b) = office("stale-book");
        let x = create(&a, None, false);
        a.record(&x, "given");
        let _ = create(&a, None, false); // A の画面はほかの世帯へ
        b.open(&x);
        b.record(&x, "withdrawn");
        let _ = create(&b, None, false); // B は x を閉じる
        let ids = vec![x.clone()];
        let c = bulk_check(&a.ai, &a.store, &ids).unwrap();
        assert!(c.ready.is_empty());
        assert_eq!(reasons(&c), vec![(BulkBlock::Withdrawn, vec![x.clone()])]);
        let g = bulk_grant(&a.ai, &a.store, &ids, 60, "AIのアプリ").unwrap();
        assert!(g.ready.is_empty());
        assert!(a.ai.registry.active_shares().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// まとめて渡した後の、ほかの PC での撤回・完全削除（0248 の追記）: 見回りが間をおいて世帯ファイルを見て、相手が開いたままでも共有を閉じる。
    /// 読み取りが無くても気づく
    #[test]
    fn withdrawal_or_deletion_on_another_pc_reaches_bulk_shares() {
        let (base, a, b) = office("remote-end");
        a.store.set_ai_privacy_policy_confirmed(true).unwrap();
        let x = create(&a, None, false);
        a.record(&x, "given");
        let y = create(&a, None, false);
        let _ = create(&a, None, false);
        let ids = vec![x.clone(), y.clone()];
        bulk_grant(&a.ai, &a.store, &ids, 60, "AIのアプリ").unwrap();
        let sid = |id: &str| {
            a.ai.registry
                .active_shares()
                .into_iter()
                .find(|s| s.household_id == id)
                .map(|s| s.share_id)
        };
        let (sx, sy) = (sid(&x).unwrap(), sid(&y).unwrap());
        let mut w = Watch::default();
        a.tick(&mut w);
        // B が x を開いて撤回する（開いたまま）
        b.open(&x);
        b.record(&x, "withdrawn");
        tick_now(&a, &mut w);
        assert!(!read_ok(&a, &sx), "撤回が届いていない");
        assert!(sid(&x).is_none());
        // B が y を完全削除する
        let no = a
            .store
            .list()
            .unwrap()
            .into_iter()
            .find(|e| e.id == y)
            .unwrap()
            .customer_no;
        crate::store::delete_household(&b.store, &b.ai, &y, &no).unwrap();
        assert!(read_ok(&a, &sy));
        tick_now(&a, &mut w);
        assert!(!read_ok(&a, &sy), "完全削除が届いていない");
        assert!(a.ai.registry.active_shares().is_empty());
        assert!(!lock(&a.ai.books).contains_key(&y));
        // 閉じた記録は、B が x を閉じた後の見回りで書く（B が開いている間は書かずに待つ）
        tick_now(&a, &mut w);
        assert!(w.waiting);
        let _ = create(&b, None, false);
        tick_now(&a, &mut w);
        assert!(!w.waiting);
        let recs = file_records(&a, &x);
        assert_eq!(recs[0].1, "consentWithdrawn", "{recs:?}");
        let _ = std::fs::remove_dir_all(&base);
    }
}
