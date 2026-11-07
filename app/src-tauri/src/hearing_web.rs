//! Web のヒアリング（0125）: 受け付けのサーバー（配布元の設定の `[hearing_web]` の `relay`）とのやりとりと、受け取った書類の保存。
//!
//! - 画面は通信しない（CSP の connect-src は本体だけ。0016）。本体のこの命令だけが、FP が押したときに受け付けのサーバーと話す
//!   （自動の通信ではない。0012 の5 の一覧の外。0012 の4 の「ヒアリング」の行）。
//! - 相手は `relay` の https のホストだけ。道（path）は決まった形（依頼・答え・書類のファイル・状況）だけを通す。クエリ・転送・クッキーは無し。
//!   User-Agent は決まった文字だけ（版・OS は送らない）。送る体は画面が作った JSON（暗号文と合言葉のハッシュ。鍵は送らない）。
//! - 開発用のビルド（debug）だけ、環境変数 `FINANCIA_DEV_HEARING_RELAY`（例 `http://127.0.0.1:8787/api/hearing/v1`）で、この PC の中の
//!   受け付け（`wrangler dev`）を向ける。お客さまのページの URL も `FINANCIA_DEV_HEARING_PAGE` で差し替えられる。製品のビルドは配布元の設定だけ
//! - ログに体・合言葉・答えを書かない（誤りは符号だけを画面に返す）

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, WebviewWindow};

use crate::export::{self, ExportKind, SaveOutcome};

include!(concat!(env!("OUT_DIR"), "/hearing_web.rs"));

const TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = "financia";
/// 送る体の上限（問い・答え・書類の暗号文の JSON。書類1つ 10MB の暗号文の base64url に余裕を足した値）
const BODY_MAX: usize = 15 * 1024 * 1024;
/// 受ける体の上限
const RESPONSE_MAX: usize = 16 * 1024 * 1024;
/// 受け取った書類の保存の上限
const DOCUMENT_MAX: usize = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebConfig {
    pub page_url: String,
    pub dev: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelayResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CallInput {
    pub method: String,
    pub path: String,
    pub token: Option<String>,
    pub body: Option<String>,
}

/// 受け付けの API の頭と、お客さまのページ（製品は配布元の設定。開発用のビルドだけ環境変数で差し替え）
fn targets() -> (String, String, bool) {
    if cfg!(debug_assertions) {
        if let Some(r) = std::env::var("FINANCIA_DEV_HEARING_RELAY")
            .ok()
            .filter(|v| !v.is_empty())
        {
            let page = std::env::var("FINANCIA_DEV_HEARING_PAGE")
                .ok()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| {
                    format!(
                        "{}/h/",
                        r.trim_end_matches('/').trim_end_matches("/api/hearing/v1")
                    )
                });
            return (r, page, true);
        }
    }
    (HEARING_RELAY.to_owned(), HEARING_PAGE.to_owned(), false)
}

fn b64url_ok(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 通してよい道か: /requests・/requests/<id>・/requests/<id>/(answers|status|extend)・/requests/<id>/files/<fileId>・
/// /requests/<id>/batches/<batchId>。FP のアプリが使う動き（作る・状況・答え・書類の送りと書類・受け取った分を消す・延長・消す。0158）だけ
pub fn allowed_call(method: &str, path: &str) -> bool {
    let parts: Vec<&str> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    match (method, parts.as_slice()) {
        ("POST", ["requests"]) => true,
        ("DELETE", ["requests", id]) => b64url_ok(id, 22),
        ("GET", ["requests", id, "status" | "answers"]) => b64url_ok(id, 22),
        ("DELETE", ["requests", id, "answers"]) => b64url_ok(id, 22),
        ("POST", ["requests", id, "extend"]) => b64url_ok(id, 22),
        ("GET", ["requests", id, "files", f]) => b64url_ok(id, 22) && b64url_ok(f, 16),
        ("GET" | "DELETE", ["requests", id, "batches", b]) => b64url_ok(id, 22) && b64url_ok(b, 16),
        _ => false,
    }
}

/// 送り先の URL（API の頭の後ろに道を足す）。製品は https・配布元の設定のホストだけ。開発用のビルドの差し替えはこの PC の中だけ
pub fn target_url(base: &str, path: &str, dev: bool) -> Option<reqwest::Url> {
    let u = reqwest::Url::parse(&format!("{}{}", base.trim_end_matches('/'), path)).ok()?;
    if u.query().is_some()
        || u.fragment().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return None;
    }
    let host = u.host_str()?;
    let ok = if dev {
        matches!(u.scheme(), "http" | "https") && matches!(host, "127.0.0.1" | "localhost")
    } else {
        let base_host = reqwest::Url::parse(base)
            .ok()?
            .host_str()
            .map(str::to_owned)?;
        u.scheme() == "https" && host == base_host && u.port().is_none()
    };
    ok.then_some(u)
}

fn install_crypto() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub async fn call(input: CallInput) -> Result<RelayResponse, String> {
    if !allowed_call(&input.method, &input.path) {
        return Err("E_HEARING_WEB_PATH".to_owned());
    }
    if input.body.as_ref().is_some_and(|b| b.len() > BODY_MAX) {
        return Err("E_RELAY_TOO_LARGE".to_owned());
    }
    if input.token.as_ref().is_some_and(|t| !b64url_ok(t, 43)) {
        return Err("E_HEARING_WEB_TOKEN".to_owned());
    }
    let (base, _, dev) = targets();
    let url = target_url(&base, &input.path, dev).ok_or_else(|| "E_HEARING_WEB_URL".to_owned())?;
    install_crypto();
    let client = reqwest::Client::builder()
        .https_only(!dev)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "E_RELAY_UNREACHABLE".to_owned())?;
    let method = reqwest::Method::from_bytes(input.method.as_bytes())
        .map_err(|_| "E_HEARING_WEB_PATH".to_owned())?;
    let mut req = client.request(method, url);
    if let Some(t) = &input.token {
        req = req.bearer_auth(t);
    }
    if let Some(b) = input.body {
        req = req.header("content-type", "application/json").body(b);
    }
    let mut resp = req
        .send()
        .await
        .map_err(|_| "E_RELAY_UNREACHABLE".to_owned())?;
    let status = resp.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|_| "E_RELAY_UNREACHABLE".to_owned())?
    {
        body.extend_from_slice(&chunk);
        if body.len() > RESPONSE_MAX {
            return Err("E_RELAY_TOO_LARGE".to_owned());
        }
    }
    Ok(RelayResponse {
        status,
        body: String::from_utf8(body).map_err(|_| "E_RELAY_BAD".to_owned())?,
    })
}

#[tauri::command]
pub fn hearing_web_config() -> WebConfig {
    let (_, page, dev) = targets();
    WebConfig {
        page_url: page,
        dev,
    }
}

#[tauri::command]
pub async fn hearing_web_call(
    method: String,
    path: String,
    token: Option<String>,
    body: Option<String>,
) -> Result<RelayResponse, String> {
    call(CallInput {
        method,
        path,
        token,
        body,
    })
    .await
}

/// 受け取った書類（写真・PDF。画面が世帯ファイルの中から取り出したバイト列）を、平文の書き出しの出口で保存する。
/// 見出し: x-file-name（既定のファイル名。URL の形で符号化。氏名は入らない）。形は見出しのバイトで確かめる
#[tauri::command]
pub async fn hearing_document_save(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<SaveOutcome, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("E_HEARING_DOC_BODY".to_owned());
    };
    let Some(ext) = document_ext(bytes) else {
        return Err("E_HEARING_DOC_BODY".to_owned());
    };
    if bytes.len() > DOCUMENT_MAX {
        return Err("E_HEARING_DOC_BODY".to_owned());
    }
    let raw = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let name = document_name(raw, ext);
    export::save(&app, &window, ExportKind::HearingDocument, &name, bytes).await
}

/// 書類の形（見出しのバイト）から拡張子。受け付けない形は None
pub fn document_ext(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if b.starts_with(b"%PDF-") {
        return Some("pdf");
    }
    if b.len() >= 12
        && &b[4..8] == b"ftyp"
        && matches!(
            &b[8..12],
            b"heic" | b"heix" | b"heim" | b"heis" | b"hevc" | b"hevx" | b"mif1" | b"msf1"
        )
    {
        return Some("heic");
    }
    None
}

/// 既定のファイル名（画面が付けた名前を URL の符号から戻し、使えない字を外し、拡張子は中身の形にそろえる）
pub fn document_name(raw: &str, ext: &str) -> String {
    let decoded = percent_decode(raw);
    // 道の区切りの後ろだけ（フォルダを指せないように）
    let base = decoded.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = match base.rsplit_once('.') {
        Some((a, e))
            if !a.is_empty() && e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            a
        }
        _ => base,
    };
    let stem: String = stem
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .take(60)
        .collect();
    let stem = stem.trim().trim_start_matches('.');
    format!("{}.{ext}", if stem.is_empty() { "書類" } else { stem })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(x), Some(y)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((x * 16 + y) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_fp_calls_are_allowed() {
        let id = "A".repeat(22);
        let f = "B".repeat(16);
        assert!(allowed_call("POST", "/requests"));
        assert!(allowed_call("GET", &format!("/requests/{id}/status")));
        assert!(allowed_call("GET", &format!("/requests/{id}/answers")));
        assert!(allowed_call("GET", &format!("/requests/{id}/files/{f}")));
        assert!(allowed_call("DELETE", &format!("/requests/{id}")));
        // 受け取った分を消す・書類の送りを読む・延長（0158）
        assert!(allowed_call("DELETE", &format!("/requests/{id}/answers")));
        assert!(allowed_call("GET", &format!("/requests/{id}/batches/{f}")));
        assert!(allowed_call(
            "DELETE",
            &format!("/requests/{id}/batches/{f}")
        ));
        assert!(allowed_call("POST", &format!("/requests/{id}/extend")));
        // お客さまの動き（答えを送る・書類を置く・書類の送りを送る・書類を外す）・知らない道・形の違う名前は通さない
        assert!(!allowed_call("PUT", &format!("/requests/{id}/answers")));
        assert!(!allowed_call("PUT", &format!("/requests/{id}/files/{f}")));
        assert!(!allowed_call(
            "DELETE",
            &format!("/requests/{id}/files/{f}")
        ));
        assert!(!allowed_call("PUT", &format!("/requests/{id}/batches/{f}")));
        assert!(!allowed_call("GET", &format!("/requests/{id}/extend")));
        assert!(!allowed_call(
            "GET",
            &format!("/requests/{id}/batches/short")
        ));
        assert!(!allowed_call("GET", &format!("/requests/{id}")));
        assert!(!allowed_call("GET", "/requests/short/status"));
        assert!(!allowed_call("GET", &format!("/requests/{id}/status/x")));
        assert!(!allowed_call("GET", &format!("/requests/{id}/../../x")));
    }

    #[test]
    fn urls_are_limited_to_the_relay_host() {
        let base = "https://relay.example/api/hearing/v1";
        assert!(target_url(base, "/requests", false).is_some());
        assert!(target_url("http://relay.example/api/hearing/v1", "/requests", false).is_none());
        assert!(target_url(base, "/requests?x=1", false).is_none());
        assert!(target_url(base, "/requests#x", false).is_none());
        assert!(target_url("https://relay.example:8443/api", "/requests", false).is_none());
        // 開発用の差し替えは、この PC の中だけ
        assert!(target_url("http://127.0.0.1:8787/api/hearing/v1", "/requests", true).is_some());
        assert!(target_url("http://relay.example/api/hearing/v1", "/requests", true).is_none());
    }

    #[test]
    fn documents_are_checked_by_their_bytes() {
        assert_eq!(document_ext(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(document_ext(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(
            document_ext(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            None
        );
        assert_eq!(document_ext(b"<html>"), None);
        assert_eq!(
            document_ext(&[0, 0, 0, 24, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c']),
            Some("heic")
        );
        assert_eq!(
            document_name("A0042_%E6%BA%90%E6%B3%89_1.png", "jpg"),
            "A0042_源泉_1.jpg"
        );
        assert_eq!(document_name("../..%2Fetc%2Fpasswd", "pdf"), "passwd.pdf");
        assert_eq!(document_name("", "pdf"), "書類.pdf");
    }

    #[test]
    fn the_distribution_relay_is_https() {
        assert!(HEARING_RELAY.starts_with("https://"));
        assert!(HEARING_PAGE.starts_with("https://") && HEARING_PAGE.ends_with('/'));
    }
}
