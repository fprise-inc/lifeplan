//! 持ち帰り用のレポート（0030）: 画面が作った HTML ファイル1つを、平文の書き出しの出口（export.rs）で保存する前の確かめ。
//!
//! - 中身（許可した値・つまみ・制度データ・計算エンジン）と、パスワードを付けたときの暗号化は画面の側（WebCrypto）で作る。
//!   ファイルを開く側（顧客のブラウザ）も同じ部品で開くため。パスワードは本体に渡らない。
//! - 本体は、決まった形の HTML か（先頭・CSP の meta で外への通信を止めているか・データの見出し）を確かめ、
//!   「パスワードを付けた」と画面が言うときは、見出しに暗号の値があることを確かめてから保存する（記録の「パスワードの有無」が正しいように）。
//! - 既定のファイル名は作成日だけ（宛名・顧客番号は入れない。顧客に渡すファイルなので、事務所の中の番号も出さない）。

/// 大きさの上限（目安は数 MB。計算エンジンと制度データを縮めて入れて約1MB）
pub const TAKEAWAY_MAX_BYTES: usize = 20 * 1024 * 1024;

/// HTML の中の、外への通信を止める CSP の meta（html.ts の csp と同じ並び）
const CSP_PREFIX: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'sha256-";
const CSP_MUST: &[&str] = &[
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
];
const HEADER_OPEN: &str = "<script type=\"application/json\" id=\"fx-header\">";

/// 確かめた結果（記録に使う）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Checked {
    pub encrypted: bool,
}

/// 保存してよい形か。encrypted は画面が「パスワードを付けた」と言ったか
pub fn check(bytes: &[u8], encrypted: bool) -> Result<Checked, String> {
    if bytes.len() > TAKEAWAY_MAX_BYTES {
        return Err("E_TAKEAWAY_TOO_LARGE".to_owned());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "E_TAKEAWAY_BODY".to_owned())?;
    if !text.starts_with("<!doctype html>") {
        return Err("E_TAKEAWAY_BODY".to_owned());
    }
    let head_end = text
        .find("</head>")
        .ok_or_else(|| "E_TAKEAWAY_BODY".to_owned())?;
    let head = &text[..head_end];
    let csp_at = head
        .find(CSP_PREFIX)
        .ok_or_else(|| "E_TAKEAWAY_CSP".to_owned())?;
    let csp_end = head[csp_at..]
        .find("\">")
        .map(|i| csp_at + i)
        .ok_or_else(|| "E_TAKEAWAY_CSP".to_owned())?;
    let csp = &head[csp_at..csp_end];
    if CSP_MUST.iter().any(|d| !csp.contains(d))
        || csp.contains("unsafe-")
        || csp.contains("http:")
        || csp.contains("https:")
    {
        return Err("E_TAKEAWAY_CSP".to_owned());
    }
    // CSP の meta は、style・script より前
    if head.find("<style").is_some_and(|s| s < csp_at) || head.contains("<script") {
        return Err("E_TAKEAWAY_CSP".to_owned());
    }
    let h_at = text
        .find(HEADER_OPEN)
        .ok_or_else(|| "E_TAKEAWAY_BODY".to_owned())?
        + HEADER_OPEN.len();
    let h_end = text[h_at..]
        .find("</script>")
        .map(|i| h_at + i)
        .ok_or_else(|| "E_TAKEAWAY_BODY".to_owned())?;
    let header: serde_json::Value =
        serde_json::from_str(&text[h_at..h_end]).map_err(|_| "E_TAKEAWAY_BODY".to_owned())?;
    if header.get("format").and_then(|v| v.as_str()) != Some("financia.takeaway") {
        return Err("E_TAKEAWAY_BODY".to_owned());
    }
    let enc = header.get("enc").filter(|v| !v.is_null());
    let has_enc = enc.is_some_and(|e| {
        e.get("cipher").and_then(|v| v.as_str()) == Some("AES-256-GCM")
            && e.get("kdf").and_then(|v| v.as_str()) == Some("PBKDF2-SHA256")
            && e.get("iter").and_then(|v| v.as_u64()).unwrap_or(0) >= 600_000
    });
    if has_enc != encrypted || (enc.is_some() && !has_enc) {
        return Err("E_TAKEAWAY_ENCRYPTION".to_owned());
    }
    Ok(Checked { encrypted })
}

/// 既定のファイル名（作成日だけ。宛名・顧客番号は入れない）
pub fn default_name(exported_on: &str, encrypted: bool) -> String {
    let mut name = "ライフプランの試算".to_owned();
    if crate::export::is_date(exported_on) {
        name.push('_');
        name.push_str(exported_on);
    }
    if encrypted {
        name.push_str("_パスワードつき");
    }
    name.push_str(".html");
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html(enc: &str, csp_extra: &str) -> String {
        format!(
            "<!doctype html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"utf-8\">\n{CSP_PREFIX}AAAA' blob:; style-src 'sha256-BBBB'; img-src 'none'; font-src 'none'; connect-src 'none'{csp_extra}; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'\">\n<style>x</style>\n</head>\n<body>\n{HEADER_OPEN}{{\"format\":\"financia.takeaway\",\"v\":1,\"zip\":\"gzip\",\"enc\":{enc}}}</script>\n</body></html>\n"
        )
    }
    const ENC: &str =
        r#"{"cipher":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":600000,"salt":"AA==","iv":"AA=="}"#;

    #[test]
    fn accepts_the_expected_shape() {
        assert_eq!(
            check(html("null", "").as_bytes(), false).unwrap(),
            Checked { encrypted: false }
        );
        assert_eq!(
            check(html(ENC, "").as_bytes(), true).unwrap(),
            Checked { encrypted: true }
        );
    }

    #[test]
    fn the_password_flag_must_match_the_file() {
        assert_eq!(
            check(html("null", "").as_bytes(), true).unwrap_err(),
            "E_TAKEAWAY_ENCRYPTION"
        );
        assert_eq!(
            check(html(ENC, "").as_bytes(), false).unwrap_err(),
            "E_TAKEAWAY_ENCRYPTION"
        );
        let weak = ENC.replace("600000", "1000");
        assert_eq!(
            check(html(&weak, "").as_bytes(), true).unwrap_err(),
            "E_TAKEAWAY_ENCRYPTION"
        );
    }

    #[test]
    fn refuses_files_that_could_talk_to_the_outside() {
        let open = html("null", "").replace("connect-src 'none'", "connect-src *");
        assert_eq!(check(open.as_bytes(), false).unwrap_err(), "E_TAKEAWAY_CSP");
        let remote = html("null", " https://example.com");
        assert_eq!(
            check(remote.as_bytes(), false).unwrap_err(),
            "E_TAKEAWAY_CSP"
        );
        let no_csp = html("null", "").replace("Content-Security-Policy", "X");
        assert_eq!(
            check(no_csp.as_bytes(), false).unwrap_err(),
            "E_TAKEAWAY_CSP"
        );
        let script_in_head = html("null", "").replace("<style>x</style>", "<script>1</script>");
        assert_eq!(
            check(script_in_head.as_bytes(), false).unwrap_err(),
            "E_TAKEAWAY_CSP"
        );
        assert_eq!(check(b"%PDF-1.7", false).unwrap_err(), "E_TAKEAWAY_BODY");
        assert_eq!(
            check(&vec![b' '; TAKEAWAY_MAX_BYTES + 1], false).unwrap_err(),
            "E_TAKEAWAY_TOO_LARGE"
        );
    }

    #[test]
    fn default_name_has_only_the_date() {
        assert_eq!(
            default_name("2026-10-21", false),
            "ライフプランの試算_2026-10-21.html"
        );
        assert_eq!(
            default_name("2026-10-21", true),
            "ライフプランの試算_2026-10-21_パスワードつき.html"
        );
        assert_eq!(default_name("../x", false), "ライフプランの試算.html");
    }

    /// 持ち帰り用のレポートの必須の記載は、提案書の PDF と同じ文（画面の build.ts の STANDARD_NOTICES）
    #[test]
    fn notices_match_the_proposal() {
        let ts = include_str!("../../src/workspace/takeaway/build.ts");
        for n in crate::report::STANDARD_NOTICES {
            assert!(ts.contains(&format!("\"{n}\"")), "{n}");
        }
    }
}
