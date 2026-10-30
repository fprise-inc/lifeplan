//! お知らせの一覧と要望・不具合の受付番号（0087）。
//!
//! - 配信元のお知らせ（「ファイナンシアから」「制度・データの更新」）を読む口は [`notices_feed`] の1か所。
//!   署名した封筒（`payload` に一覧の JSON の文字列、`signatures` に切り離した署名）を受け取り、データ用の鍵（0017 の5）で確かめて、
//!   確かめた中身だけを画面に渡す。今は鍵が無く、更新の仕組み（通信）も入れていないので、製品のビルドは何も渡さない。
//!   開発用のビルドだけ、`FINANCIA_DEV_NOTICES` に書いた手元のファイル（見本は app/schemas/notices.dev-sample.json）を読む（署名なしを受け付けるのは開発用のビルドだけ）。
//! - 既読の印と受付番号は、この PC のアプリのデータ（`notices/local.json`）にだけ置く。配信元には何も送り返さない（0087 の4）。
//! - 要望・不具合のフォームは、配布元の設定のひな形（build.rs が config/distribution.toml から写す）に、受付番号・アプリの版・OS だけを差し込み、
//!   既定のブラウザで開く。画面からは受付番号しか受け取らない（任意の URL は開かない）。
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

include!(concat!(env!("OUT_DIR"), "/distribution.rs"));

/// 封筒の形式の名前
const ENVELOPE_FORMAT: &str = "financia-notices-envelope";
/// お知らせの一覧の形式の名前（中身の検査は画面の parseFeed が1件ずつ行う。ここでは名前と MAJOR だけ確かめる）
const FEED_FORMAT: &str = "financia-notices";
/// 手元の状態のファイルの大きさの上限
const LOCAL_MAX_BYTES: usize = 512 * 1024;
/// 封筒の大きさの上限
const FEED_MAX_BYTES: usize = 1024 * 1024;

/// お知らせに署名してよい鍵（0017 の5: お知らせはデータ用の鍵。現用＋次期）。
/// 署名を入れる回で、build.rs が config/distribution.toml の `[keys] data` から作る。今は空（どの署名も受け付けない）
const DATA_KEY_IDS: &[&str] = &[];

/// 封筒を受け付けなかった理由（テストで確かめる）
#[derive(Debug, PartialEq, Eq)]
pub enum Reject {
    Shape,
    Format,
    Unsigned,
    UnknownKey,
    BadSignature,
}

/// 封筒を確かめて、中身（お知らせの一覧の JSON の文字列）を返す。
/// - `trusted`: 受け付ける鍵の ID（データ用の鍵だけ。ほかの役割の鍵は渡さない）
/// - `allow_unsigned`: 署名なしを受け付ける（開発用のビルドの見本だけ。製品のビルドでは常に false）
pub fn verify(envelope: &str, trusted: &[&str], allow_unsigned: bool) -> Result<String, Reject> {
    if envelope.len() > FEED_MAX_BYTES {
        return Err(Reject::Shape);
    }
    let v: Value = serde_json::from_str(envelope).map_err(|_| Reject::Shape)?;
    if v.get("format").and_then(Value::as_str) != Some(ENVELOPE_FORMAT) {
        return Err(Reject::Format);
    }
    let payload = v
        .get("payload")
        .and_then(Value::as_str)
        .ok_or(Reject::Shape)?;
    let sigs = v
        .get("signatures")
        .and_then(Value::as_array)
        .ok_or(Reject::Shape)?;
    if sigs.is_empty() {
        if !allow_unsigned {
            return Err(Reject::Unsigned);
        }
    } else {
        // 知らない鍵の署名は拒否する（0017 の5）。どれか1つが正しく確かめられれば受け付ける
        let mut ok = false;
        for s in sigs {
            let key = s.get("keyId").and_then(Value::as_str).unwrap_or("");
            if s.get("alg").and_then(Value::as_str) != Some("ed25519") || !trusted.contains(&key) {
                continue;
            }
            // Ed25519 の確認は、鍵を入れる回でここに差し込む（payload の UTF-8 のバイト列への切り離した署名）。
            // それまでは trusted が空なので、ここには来ない
            ok = verify_ed25519(
                key,
                payload.as_bytes(),
                s.get("sig").and_then(Value::as_str),
            );
            if ok {
                break;
            }
        }
        if !ok {
            let known = sigs
                .iter()
                .any(|s| trusted.contains(&s.get("keyId").and_then(Value::as_str).unwrap_or("")));
            return Err(if known {
                Reject::BadSignature
            } else {
                Reject::UnknownKey
            });
        }
    }
    let doc: Value = serde_json::from_str(payload).map_err(|_| Reject::Shape)?;
    let major = doc
        .get("formatVersion")
        .and_then(Value::as_str)
        .and_then(|s| s.split('.').next())
        .and_then(|s| s.parse::<u32>().ok());
    if doc.get("format").and_then(Value::as_str) != Some(FEED_FORMAT) || major != Some(1) {
        return Err(Reject::Format);
    }
    Ok(payload.to_owned())
}

/// 署名の確認（鍵を入れる回で実装する。今は常に受け付けない）
fn verify_ed25519(_key_id: &str, _message: &[u8], _sig: Option<&str>) -> bool {
    false
}

/// 配信元のお知らせ（確かめた一覧の JSON。無ければ null）。読む口はここ1か所（更新の仕組みが入ったら、受け取って保存した最新の封筒をここで読む）
#[tauri::command]
pub fn notices_feed() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        let path = std::env::var_os("FINANCIA_DEV_NOTICES").filter(|v| !v.is_empty())?;
        let text = std::fs::read_to_string(PathBuf::from(path)).ok()?;
        verify(&text, DATA_KEY_IDS, true).ok()
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

fn local_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|_| "E_NOTICE_DIR")?;
    let mut dir = base.join(if cfg!(debug_assertions) {
        "notices-dev"
    } else {
        "notices"
    });
    // 開発のときだけ（debug のビルド）: 試験用のデータフォルダの中に置く（store.rs と同じ変数）
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("FINANCIA_DEV_STORE_DIR").filter(|v| !v.is_empty()) {
            dir = PathBuf::from(d).join("notices");
        }
    }
    Ok(dir.join("local.json"))
}

/// 手元の状態（既読の印と受付番号）の形を確かめる（オブジェクトで、`read` は文字列の値のオブジェクト、`receipts` は並び）
pub fn valid_local(v: &Value) -> bool {
    let Some(o) = v.as_object() else { return false };
    let read_ok = o.get("read").is_none_or(|r| {
        r.as_object()
            .is_some_and(|m| m.values().all(Value::is_string))
    });
    let receipts_ok = o.get("receipts").is_none_or(|r| {
        r.as_array().is_some_and(|a| {
            a.len() <= 200
                && a.iter().all(|x| {
                    x.get("code")
                        .and_then(Value::as_str)
                        .is_some_and(valid_receipt)
                })
        })
    });
    read_ok && receipts_ok && o.keys().all(|k| k == "read" || k == "receipts")
}

/// 受付番号の形（R- と、0・O・1・I・L を除いた英大文字・数字4文字）
pub fn valid_receipt(code: &str) -> bool {
    const CHARS: &str = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    code.len() == 6 && code.starts_with("R-") && code[2..].chars().all(|c| CHARS.contains(c))
}

/// 手元の状態を読む（無ければ空のオブジェクト）
#[tauri::command]
pub fn notice_local_get(app: AppHandle) -> Result<Value, String> {
    let p = local_path(&app)?;
    match std::fs::read(&p) {
        Ok(b) => Ok(serde_json::from_slice::<Value>(&b)
            .ok()
            .filter(valid_local)
            .unwrap_or_else(|| serde_json::json!({}))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(_) => Err("E_NOTICE_READ".into()),
    }
}

/// 手元の状態を書く（一時ファイルに書いてから置き換える）
#[tauri::command]
pub fn notice_local_put(app: AppHandle, value: Value) -> Result<(), String> {
    if !valid_local(&value) {
        return Err("E_NOTICE_SHAPE".into());
    }
    let bytes = serde_json::to_vec(&value).map_err(|_| "E_NOTICE_SHAPE")?;
    if bytes.len() > LOCAL_MAX_BYTES {
        return Err("E_NOTICE_SIZE".into());
    }
    let p = local_path(&app)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|_| "E_NOTICE_WRITE")?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|_| "E_NOTICE_WRITE")?;
    std::fs::rename(&tmp, &p).map_err(|_| "E_NOTICE_WRITE")?;
    Ok(())
}

/// OS のおおまかな名前（画面の osName と同じ呼び方）
fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        _ => "不明",
    }
}

/// URL の形に直す（RFC 3986 の予約されていない文字のほかは %XX。画面の encodeURIComponent と同じ結果になる文字だけを使う）
fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// フォームの URL（ひな形に受付番号・アプリの版・OS だけを差し込む。画面の feedbackFormUrl と同じ）
pub fn form_url(template: &str, code: &str, version: &str, os: &str) -> String {
    template
        .replace("{受付番号}", &encode(code))
        .replace("{版}", &encode(version))
        .replace("{OS}", &encode(os))
}

/// 既定のブラウザで URL を開く（https だけ）
fn open_in_browser(url: &str) -> bool {
    use std::process::Command;
    if !url.starts_with("https://") || url.chars().any(char::is_control) {
        return false;
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("/usr/bin/open").arg(url).status()
    } else if cfg!(windows) {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
    status.map(|s| s.success()).unwrap_or(false)
}

/// 要望・不具合のフォームを既定のブラウザで開く（受付番号だけを受け取る。版と OS は本体が入れる）
#[tauri::command]
pub fn feedback_form_open(app: AppHandle, code: String) -> Result<(), String> {
    if !valid_receipt(&code) {
        return Err("E_RECEIPT".into());
    }
    let version = app.package_info().version.to_string();
    let url = form_url(FEEDBACK_FORM, &code, &version, os_name());
    if open_in_browser(&url) {
        Ok(())
    } else {
        Err("E_FEEDBACK_OPEN".into())
    }
}

/// 受付番号を写す（クリップボード。受付番号の形のものだけ）。写せたら true
#[tauri::command]
pub fn feedback_copy(code: String) -> Result<bool, String> {
    if !valid_receipt(&code) {
        return Err("E_RECEIPT".into());
    }
    Ok(crate::ai::copy_to_clipboard(&code))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(payload: &str, sigs: &str) -> String {
        format!(
            r#"{{"format":"financia-notices-envelope","formatVersion":"1.0","payload":{},"signatures":{sigs}}}"#,
            serde_json::to_string(payload).unwrap()
        )
    }
    const FEED: &str = r#"{"format":"financia-notices","formatVersion":"1.0","issuedAt":"2026-10-30T00:00:00Z","notices":[]}"#;

    #[test]
    fn unsigned_is_rejected_outside_development() {
        assert_eq!(
            verify(&envelope(FEED, "[]"), &[], false),
            Err(Reject::Unsigned)
        );
        assert_eq!(
            verify(&envelope(FEED, "[]"), &[], true),
            Ok(FEED.to_owned())
        );
    }

    #[test]
    fn unknown_keys_and_bad_signatures_are_rejected() {
        let sig = r#"[{"keyId":"k-other","alg":"ed25519","sig":"AAAA"}]"#;
        assert_eq!(
            verify(&envelope(FEED, sig), &["k-data"], true),
            Err(Reject::UnknownKey)
        );
        let sig = r#"[{"keyId":"k-data","alg":"ed25519","sig":"AAAA"}]"#;
        assert_eq!(
            verify(&envelope(FEED, sig), &["k-data"], true),
            Err(Reject::BadSignature)
        );
        // 今の製品のビルドは鍵が無いので、署名つきでも受け付けない
        assert!(verify(&envelope(FEED, sig), DATA_KEY_IDS, false).is_err());
    }

    #[test]
    fn format_and_shape_are_checked() {
        assert_eq!(verify("{}", &[], true), Err(Reject::Format));
        assert_eq!(verify("x", &[], true), Err(Reject::Shape));
        let other = r#"{"format":"financia-notices","formatVersion":"2.0","notices":[]}"#;
        assert_eq!(
            verify(&envelope(other, "[]"), &[], true),
            Err(Reject::Format)
        );
    }

    #[test]
    fn the_development_sample_is_a_valid_unsigned_envelope() {
        let text = include_str!("../../schemas/notices.dev-sample.json");
        assert!(verify(text, &[], true).is_ok());
        assert_eq!(verify(text, &[], false), Err(Reject::Unsigned));
    }

    #[test]
    fn receipts_and_local_state() {
        assert!(valid_receipt("R-7K2Q"));
        for bad in [
            "R-7K2O", "R-1ABC", "R-ABCL", "R-ABCI", "R-0ABC", "R-ABC", "X-7K2Q", "R-7k2q",
        ] {
            assert!(!valid_receipt(bad), "{bad}");
        }
        assert!(valid_local(&serde_json::json!({})));
        assert!(valid_local(
            &serde_json::json!({"read": {"feed:a": "2026-10-30"}, "receipts": [{"code": "R-7K2Q", "on": "2026-10-30"}]})
        ));
        assert!(!valid_local(&serde_json::json!({"read": {"a": 1}})));
        assert!(!valid_local(
            &serde_json::json!({"receipts": [{"code": "R-0000"}]})
        ));
        assert!(!valid_local(&serde_json::json!({"other": 1})));
    }

    #[test]
    fn the_form_url_carries_only_the_receipt_version_and_os() {
        let url = form_url(
            "https://example.com/f?no={受付番号}&ver={版}&os={OS}",
            "R-7K2Q",
            "0.1.0",
            "macOS",
        );
        assert_eq!(url, "https://example.com/f?no=R-7K2Q&ver=0.1.0&os=macOS");
        assert_eq!(encode("不明 &x"), "%E4%B8%8D%E6%98%8E%20%26x");
        assert!(FEEDBACK_FORM.starts_with("https://"));
        assert!(FEEDBACK_FORM.contains("{受付番号}"));
    }
}
