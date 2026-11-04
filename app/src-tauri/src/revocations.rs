//! 配信元の取り下げの一覧（0117 の3 (3)）を取りに行き、機能を有効にするコードの取り下げ（`revoked.featureCodes`）と、
//! 取り下げた鍵（`revoked.keys`）を当てる（0110 の追記 2026-11-04・0017 の4）。
//!
//! - 取りに行くのは、この PC に機能を有効にするコードが入っているときだけ。起動したときと、動いている間は1日1回
//!   （取れなかったときは1時間後にもう一度）と、FP が画面の「今すぐ確かめる」を押したとき・コードを入れたとき。
//! - 送るのは一覧の取得の依頼（`GET`）だけ。コード・名前・世帯の情報・PC を見分ける値は送らず、クエリも付けない。
//!   クッキーは持たず、ほかのホストへの転送には従わない。相手は配布元の設定の `host`（配信元）だけで、https だけ。
//!   アプリの版・OS も送らない（User-Agent は決まった文字だけ）。
//! - 取れた一覧は取り下げ用の鍵（配布元の設定の `[keys]` の `revocation`。コードの鍵とは別）で確かめ、
//!   この PC のアプリのデータ（`feature-codes/revocations.json`）に保存する。つながらない・署名が合わない・古いときは、最後に取れた一覧のまま
//!   （一覧が一度も取れていなければ、何も止めない）。確かめは配布の部品（`distribution::revocations::apply_fetch`）。
//!   期限（`expiresAt`）の切れた一覧も、載っている取り下げは当て続ける（0117 の3 (3)）。
//! - 一覧のほかの欄（最低版・取り下げた版・制度の値など）は、まだ当てない（アプリ本体の更新のつなぎの回。0117 の未確定）。
//! - 同じファイルに、期限の切れた・止めたコードの知らせの記録（分かった日・閉じた。feature-code の `notice`）も置く
//!   （この PC だけの記録。同期しない。知らせは分かった日から7日で出さなくなる。0110 の追記 2026-11-02）。
//! - 開発用のビルド（debug）だけ、環境変数 `FINANCIA_DEV_FEATURE_REVOCATIONS_URL` で、この PC の中（127.0.0.1・localhost）の一覧を読める
//!   （止めた・外したの見え方を確かめるため。http も可。署名は開発用の取り下げ用の鍵〔`[dev_keys]` の `revocation`〕でもよい）。
//!   製品のビルドは配布元の設定の URL と本番の鍵だけ。

use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use distribution::keys::KeyRing;
use distribution::revocations::{self, Fetch};
use distribution::MAX_DOCUMENT_BYTES;
use feature_code::notice;
use feature_code::{PublicKey, Status};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::keyring::{ring, DISTRIBUTION_HOST, REVOCATIONS_URL};
use crate::store::StoreState;

/// 取れたときの次の確かめまで
const DAILY: Duration = Duration::from_secs(24 * 3600);
/// 取れなかったときの次の確かめまで
const RETRY: Duration = Duration::from_secs(3600);
/// 起動してから最初に確かめるまで（起動の重さを避ける）
const FIRST_DELAY: Duration = Duration::from_secs(5);
/// 見回りの間隔（保存先が使えるようになった・コードが入ったのを拾う）
const POLL: Duration = Duration::from_secs(60);
/// 通信の時間の上限
const TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 送る User-Agent（版・OS は入れない）
const USER_AGENT: &str = "financia";

/// 保存する中身（この PC のアプリのデータ）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Saved {
    /// 最後に取れて、確かめられた一覧（配信元のファイルの中身のまま）
    #[serde(default)]
    list: Option<String>,
    /// 最後に取りに行った日時（UTC）
    #[serde(default)]
    checked_at: Option<String>,
    /// 最後に取れた日時（UTC）
    #[serde(default)]
    ok_at: Option<String>,
    /// 最後に取りに行った結果（"ok"・"offline"・受け付けなかった符号）
    #[serde(default)]
    last: Option<String>,
    /// 期限の切れた・止めたコードの知らせの記録（コードの印ごとの、分かった日と閉じた印）
    #[serde(default)]
    notices: Vec<notice::Record>,
}

/// 画面に返す、確かめの様子（中身の一覧は返さない）
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckView {
    pub checked_at: Option<String>,
    pub ok_at: Option<String>,
    /// "ok"・"offline"・"rejected"（一度も取りに行っていなければ null）
    pub result: Option<&'static str>,
    /// 今使っている一覧の通し番号（一度も取れていなければ null）
    pub serial: Option<u64>,
    /// 今止めているコードの数（この PC に入っているかどうかにかかわらず、一覧に載っている数）
    pub listed: usize,
}

struct Inner {
    saved: Saved,
    /// 保存した一覧の止めるコードの番号（確かめ直したもの）
    revoked: Vec<String>,
    /// 保存した一覧で取り下げた鍵の名前（コードの鍵が漏れたとき。束から外す）
    revoked_keys: Vec<String>,
    serial: Option<u64>,
    /// この起動で最後に取りに行った時（次の確かめの判定に使う）
    last_attempt: Option<Instant>,
    last_ok: bool,
    /// 画面から「今すぐ確かめる」を頼まれた
    requested: bool,
}

pub struct RevocationState {
    inner: Mutex<Inner>,
    wake: Condvar,
    path: Option<PathBuf>,
    /// 一覧を確かめる鍵の束（取り下げた鍵を外す前。アプリでは [`ring`]、テストでは使い捨ての鍵）
    ring: KeyRing,
}

fn lock(m: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_iso() -> String {
    ai_share::clock::iso8601(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or(0),
    )
}

/// 保存した一覧から、止めるコードの番号・取り下げた鍵・通し番号を読み直す（確かめられなければ、どれも無し＝何も止めない）
fn read_list(list: Option<&str>, ring: &KeyRing) -> (Vec<String>, Vec<String>, Option<u64>) {
    match revocations::saved_list(list.map(str::as_bytes), ring) {
        Some(v) => (
            feature_code::revoked_ids(&v),
            v.list.revoked.keys.clone(),
            Some(v.list.serial),
        ),
        None => (vec![], vec![], None),
    }
}

impl RevocationState {
    fn from_saved(saved: Saved, path: Option<PathBuf>, ring: KeyRing) -> RevocationState {
        let (revoked, revoked_keys, serial) = read_list(saved.list.as_deref(), &ring);
        RevocationState {
            inner: Mutex::new(Inner {
                revoked,
                revoked_keys,
                serial,
                saved,
                last_attempt: None,
                last_ok: false,
                requested: false,
            }),
            wake: Condvar::new(),
            path,
            ring,
        }
    }

    /// 今止めているコードの番号（最後に取れた一覧。一度も取れていなければ空）
    pub fn revoked(&self) -> Vec<String> {
        lock(&self.inner).revoked.clone()
    }

    /// 機能を有効にするコードを確かめる鍵（このビルドの束から、最後に取れた一覧で取り下げた鍵を外したもの）
    pub fn code_keys(&self) -> Vec<PublicKey> {
        let g = lock(&self.inner);
        feature_code::keys_from_ring(&self.ring.without(&g.revoked_keys))
    }

    pub fn view(&self) -> CheckView {
        let g = lock(&self.inner);
        CheckView {
            checked_at: g.saved.checked_at.clone(),
            ok_at: g.saved.ok_at.clone(),
            result: g.saved.last.as_deref().map(|l| match l {
                "ok" => "ok",
                "offline" => "offline",
                _ => "rejected",
            }),
            serial: g.serial,
            listed: g.revoked.len(),
        }
    }

    /// 状態に知らせの記録を当てる（切れた・止めたと初めて見たコードは今日を分かった日にする。使える・外したコードの記録は消す）。
    /// 記録が変わったときだけ保存する（画面は1分ごとに状態を読むので、毎回は書かない）
    pub fn apply_notices(&self, status: &mut Status) {
        let mut g = lock(&self.inner);
        let next = notice::apply(status, &g.saved.notices);
        if next != g.saved.notices {
            g.saved.notices = next;
            if let Some(p) = &self.path {
                write_saved(p, &g.saved);
            }
        }
    }

    /// 印で指したコードの知らせを閉じる（先に [`Self::apply_notices`] で記録を当てておく）
    pub fn dismiss_notice(&self, reference: &str) -> Result<(), feature_code::Error> {
        let mut g = lock(&self.inner);
        let next = notice::dismiss(&g.saved.notices, reference)?;
        if next != g.saved.notices {
            g.saved.notices = next;
            if let Some(p) = &self.path {
                write_saved(p, &g.saved);
            }
        }
        Ok(())
    }

    /// 画面から「今すぐ確かめる」（裏の見回りを起こす）
    pub fn request(&self) {
        lock(&self.inner).requested = true;
        self.wake.notify_all();
    }

    /// 取りに行った結果を当てて保存する
    fn apply(&self, fetched: Option<Vec<u8>>) -> Fetch {
        let mut g = lock(&self.inner);
        let saved = g.saved.list.clone();
        let (next, outcome) = revocations::apply_fetch(
            saved.as_deref().map(str::as_bytes),
            fetched.as_deref(),
            &self.ring,
        );
        let now = now_iso();
        g.saved.checked_at = Some(now.clone());
        g.saved.last = Some(match outcome {
            Fetch::Ok => "ok".to_owned(),
            Fetch::Offline => "offline".to_owned(),
            Fetch::Rejected(e) => e.code().to_owned(),
        });
        if outcome == Fetch::Ok {
            g.saved.ok_at = Some(now);
        }
        g.saved.list = next.and_then(|b| String::from_utf8(b).ok());
        let (revoked, revoked_keys, serial) = read_list(g.saved.list.as_deref(), &self.ring);
        g.revoked = revoked;
        g.revoked_keys = revoked_keys;
        g.serial = serial;
        g.last_attempt = Some(Instant::now());
        g.last_ok = outcome == Fetch::Ok;
        if let Some(p) = &self.path {
            write_saved(p, &g.saved);
        }
        outcome
    }

    /// 次に取りに行くか（この起動でまだ・前回から1日〔取れなかったら1時間〕・頼まれた）
    fn due(&self) -> bool {
        let g = lock(&self.inner);
        g.requested
            || match g.last_attempt {
                None => true,
                Some(t) => t.elapsed() >= if g.last_ok { DAILY } else { RETRY },
            }
    }
}

fn saved_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("feature-codes");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("revocations.json"))
}

fn read_saved(p: &PathBuf) -> Saved {
    std::fs::read(p)
        .ok()
        .filter(|b| b.len() <= MAX_DOCUMENT_BYTES * 2)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_saved(p: &PathBuf, s: &Saved) {
    let Ok(text) = serde_json::to_vec_pretty(s) else {
        return;
    };
    // 書きかけで壊れないよう、別の名前に書いてから置き換える
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, p);
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> RevocationState {
    let path = saved_path(app);
    let saved = path.as_ref().map(read_saved).unwrap_or_default();
    RevocationState::from_saved(saved, path, ring().clone())
}

/// 取りに行く場所（製品は配布元の設定の URL だけ。開発用のビルドだけ、この PC の中の一覧に差し替えられる）
fn target_url() -> (String, bool) {
    if cfg!(debug_assertions) {
        if let Some(u) = std::env::var("FINANCIA_DEV_FEATURE_REVOCATIONS_URL")
            .ok()
            .filter(|u| !u.is_empty())
        {
            return (u, true);
        }
    }
    (REVOCATIONS_URL.to_owned(), false)
}

/// 取りに行ってよい URL か: 配信元のホストの https で、クエリ・名前とパスワード・転送の印が無いもの。
/// `dev_loopback` のときだけ、この PC の中（127.0.0.1・localhost）の http も許す
pub fn allowed_url(url: &str, host: &str, dev_loopback: bool) -> Option<reqwest::Url> {
    let u = reqwest::Url::parse(url).ok()?;
    if u.query().is_some()
        || u.fragment().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return None;
    }
    let h = u.host_str()?;
    let ok = if dev_loopback {
        matches!(u.scheme(), "http" | "https") && matches!(h, "127.0.0.1" | "localhost")
    } else {
        u.scheme() == "https" && h == host && u.port().is_none()
    };
    ok.then_some(u)
}

fn install_crypto() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// 一覧を取りに行く（取れなければ None。理由は区別しない＝どれも「最後に取れた一覧のまま」）
pub async fn fetch(url: &str, host: &str, dev_loopback: bool) -> Option<Vec<u8>> {
    let u = allowed_url(url, host, dev_loopback)?;
    install_crypto();
    let client = reqwest::Client::builder()
        .https_only(!dev_loopback)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .ok()?;
    let mut resp = client.get(u).send().await.ok()?;
    if resp.status() != reqwest::StatusCode::OK {
        return None;
    }
    if resp
        .content_length()
        .is_some_and(|n| n > MAX_DOCUMENT_BYTES as u64)
    {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_DOCUMENT_BYTES {
            return None;
        }
    }
    Some(body)
}

/// 1回確かめる（コードが入っていなければ取りに行かない）。取りに行ったら true
fn check_once<R: Runtime>(app: &AppHandle<R>) -> bool {
    let rs = app.state::<RevocationState>();
    let has_codes = app
        .state::<StoreState>()
        .store
        .feature_codes()
        .is_ok_and(|c| !c.is_empty());
    if !has_codes {
        lock(&rs.inner).requested = false;
        return false;
    }
    lock(&rs.inner).requested = false;
    let (url, dev) = target_url();
    let fetched = tauri::async_runtime::block_on(fetch(&url, DISTRIBUTION_HOST, dev));
    rs.apply(fetched);
    true
}

/// 裏の見回りを始める（アプリの起動時に1回）
pub fn start_watch<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_DELAY);
        loop {
            let rs = app.state::<RevocationState>();
            if rs.due() {
                check_once(&app);
            }
            let g = lock(&rs.inner);
            let _ = rs.wake.wait_timeout_while(g, POLL, |i| !i.requested);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// この PC の中の小さな HTTP の相手（決まった返事を1回返し、届いた依頼の文を渡す）
    fn serve_once(response: Vec<u8>) -> (String, mpsc::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
                let _ = s.write_all(&response);
            }
        });
        (format!("http://127.0.0.1:{port}/v1/list.json"), rx)
    }

    fn ok_response(body: &[u8]) -> Vec<u8> {
        let mut r = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        r.extend_from_slice(body);
        r
    }

    fn run<T>(f: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn urls_are_limited_to_the_distribution_host() {
        let h = "updates.example.test";
        assert!(allowed_url("https://updates.example.test/v1/a.json", h, false).is_some());
        for bad in [
            "http://updates.example.test/v1/a.json",
            "https://other.example.test/v1/a.json",
            "https://updates.example.test.evil.test/a.json",
            "https://updates.example.test/a.json?id=0001",
            "https://updates.example.test/a.json#x",
            "https://user:pw@updates.example.test/a.json",
            "https://updates.example.test:8443/a.json",
            "https://127.0.0.1/a.json",
            "file:///etc/hosts",
        ] {
            assert!(allowed_url(bad, h, false).is_none(), "{bad}");
        }
        // 開発用の差し替えは、この PC の中だけ
        assert!(allowed_url("http://127.0.0.1:1433/a.json", h, true).is_some());
        assert!(allowed_url("http://localhost:1433/a.json", h, true).is_some());
        assert!(allowed_url("http://192.168.0.2/a.json", h, true).is_none());
        assert!(allowed_url("https://updates.example.test/a.json", h, true).is_none());
        // 配布元の設定の URL そのものは通る
        assert!(allowed_url(REVOCATIONS_URL, DISTRIBUTION_HOST, false).is_some());
    }

    #[test]
    fn fetch_sends_only_the_request() {
        let (url, rx) = serve_once(ok_response(b"{\"x\":1}"));
        let got = run(fetch(&url, "unused", true));
        assert_eq!(got.as_deref(), Some(&b"{\"x\":1}"[..]));
        let req = rx.recv().unwrap().to_ascii_lowercase();
        let first = req.lines().next().unwrap().to_owned();
        assert_eq!(first, "get /v1/list.json http/1.1");
        // クッキー・版・OS・PC を見分ける値は送らない
        assert!(!req.contains("cookie"), "{req}");
        assert!(req.contains("user-agent: financia\r\n"), "{req}");
        assert!(!req.contains(env!("CARGO_PKG_VERSION")), "{req}");
        for os in ["mac", "windows", "linux", "darwin"] {
            assert!(!req.contains(os), "{req}");
        }
    }

    #[test]
    fn fetch_fails_quietly() {
        // 転送には従わない
        let (url, _rx) = serve_once(
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_vec(),
        );
        assert_eq!(run(fetch(&url, "unused", true)), None);
        // 見つからない
        let (url, _rx) = serve_once(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        );
        assert_eq!(run(fetch(&url, "unused", true)), None);
        // 大きすぎる
        let big = vec![b'a'; MAX_DOCUMENT_BYTES + 10];
        let (url, _rx) = serve_once(ok_response(&big));
        assert_eq!(run(fetch(&url, "unused", true)), None);
        // つながらない（誰も待っていない口）
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert_eq!(
            run(fetch(
                &format!("http://127.0.0.1:{port}/a.json"),
                "unused",
                true
            )),
            None
        );
        // 許していない場所には、つなぎに行かない
        assert_eq!(
            run(fetch(
                "https://other.example.test/a.json",
                "updates.example.test",
                false
            )),
            None
        );
    }

    /// 使い捨ての鍵の束（コードの鍵と取り下げ用の鍵。決まった種から作る）と、その鍵で署名した取り下げの一覧
    fn test_ring(code_key: &feature_code::SecretKey) -> KeyRing {
        use base64::Engine as _;
        let rv = format!(
            "rv-test:{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(rv_key().verifying_key().to_bytes())
        );
        let fc = code_key.public().line();
        KeyRing::from_config(&distribution::keys::KeyConfig {
            feature_code: &[fc.as_str()],
            revocation: &[rv.as_str()],
            ..Default::default()
        })
        .unwrap()
    }

    fn rv_key() -> ed25519_dalek::SigningKey {
        ed25519_dalek::SigningKey::from_bytes(&[41; 32])
    }

    fn signed_list(serial: u64, codes: &[&str], keys: &[&str]) -> Vec<u8> {
        let mut d = revocations::empty_draft(1_800_000_000);
        d.serial = serial;
        d.revoked.feature_codes = codes.iter().map(|s| (*s).to_owned()).collect();
        d.revoked.keys = keys.iter().map(|s| (*s).to_owned()).collect();
        distribution::envelope::seal(
            &serde_json::to_string(&d).unwrap(),
            revocations::ENVELOPE_FORMAT,
            &[("rv-test", &rv_key())],
        )
        .into_bytes()
    }

    #[test]
    fn distribution_list_stops_codes_and_keys() {
        let k = feature_code::SecretKey::generate("fc-test").unwrap();
        let st = RevocationState::from_saved(Saved::default(), None, test_ring(&k));
        assert_eq!(st.code_keys().len(), 1);
        assert_eq!(st.apply(Some(signed_list(1, &["0007"], &[]))), Fetch::Ok);
        assert_eq!(st.revoked(), vec!["0007"]);
        assert_eq!((st.view().serial, st.view().listed), (Some(1), 1));
        // 古い一覧は受け付けない（止めたままにする）
        assert_eq!(
            st.apply(Some(signed_list(0, &[], &[]))),
            Fetch::Rejected(distribution::Reject::OLDER)
        );
        assert_eq!(st.revoked(), vec!["0007"]);
        // コードの鍵を取り下げると、その鍵のコードは確かめられなくなる（外せば戻る）
        assert_eq!(st.apply(Some(signed_list(2, &[], &["fc-test"]))), Fetch::Ok);
        assert!(st.code_keys().is_empty());
        assert!(st.revoked().is_empty());
        assert_eq!(st.apply(Some(signed_list(3, &[], &[]))), Fetch::Ok);
        assert_eq!(st.code_keys().len(), 1);
    }

    #[test]
    fn offline_keeps_the_last_list_and_bad_lists_are_ignored() {
        // 取れない・形が違う一覧では、前の状態が残る
        let st = RevocationState::from_saved(Saved::default(), None, ring().clone());
        assert_eq!(st.apply(None), Fetch::Offline);
        assert!(st.revoked().is_empty());
        assert_eq!(st.view().result, Some("offline"));
        assert_eq!(st.view().ok_at, None);
        assert_eq!(
            st.apply(Some(b"<html>maintenance</html>".to_vec())),
            Fetch::Rejected(distribution::Reject::FORMAT)
        );
        assert_eq!(st.view().result, Some("rejected"));
        assert!(st.revoked().is_empty());
        // 取れなかったら1時間後、頼まれたらすぐ
        assert!(!st.due());
        st.request();
        assert!(st.due());
        // 保存しておいた一覧が確かめられない（鍵を差し替えた後など）ときは、何も止めない
        let broken = Saved {
            list: Some("{\"format\":\"fprise-lifeplan-revocations-envelope\",\"formatVersion\":\"1.0\",\"payload\":\"{}\",\"signatures\":[{\"keyId\":\"dev-rv2\",\"alg\":\"ed25519\",\"sig\":\"AA\"}]}".into()),
            ..Saved::default()
        };
        let st = RevocationState::from_saved(broken, None, ring().clone());
        assert!(st.revoked().is_empty());
        assert_eq!(st.view().serial, None);
        assert!(st.due());
    }

    #[test]
    fn notice_records_are_kept_on_this_pc() {
        // 期限の切れたコードの知らせの記録（分かった日・閉じた）を、止めた一覧と同じファイルに置き、取りに行った後も残す
        let k = feature_code::SecretKey::generate("test-1").unwrap();
        let keys = [k.public()];
        let code = feature_code::issue(
            &k,
            &feature_code::Request {
                id: "0001".into(),
                name: "見本 花子".into(),
                features: vec!["combinedBs".into()],
                issued: "2026-11-01".into(),
                expires: Some("2026-11-30".into()),
            },
        )
        .unwrap();
        let codes = [code.clone()];
        let dir = std::env::temp_dir().join(format!("financia-notice-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("revocations.json");
        let st = RevocationState::from_saved(Saved::default(), Some(path.clone()), ring().clone());
        let status_on = |st: &RevocationState, today: &str| {
            let mut s = feature_code::status(&codes, &keys, today, &st.revoked());
            st.apply_notices(&mut s);
            s
        };
        let s = status_on(&st, "2026-12-01");
        assert!(s.codes[0].notice);
        assert_eq!(s.codes[0].notice_since.as_deref(), Some("2026-12-01"));
        // 知らせの無いコードは閉じられない
        assert_eq!(
            st.dismiss_notice("0000000000000000"),
            Err(feature_code::Error::NOT_FOUND)
        );
        st.dismiss_notice(&feature_code::reference(&code)).unwrap();
        assert_eq!(st.apply(None), Fetch::Offline);
        // 読み直しても、分かった日と閉じた印が残る（取りに行った後も消えない）
        let again =
            RevocationState::from_saved(read_saved(&path), Some(path.clone()), ring().clone());
        let s = status_on(&again, "2026-12-02");
        assert!(!s.codes[0].notice);
        assert_eq!(s.codes[0].notice_since.as_deref(), Some("2026-12-01"));
        assert_eq!(again.view().result, Some("offline"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
