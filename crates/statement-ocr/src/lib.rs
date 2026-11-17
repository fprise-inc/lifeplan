//! 明細の写真・スクショ・画像だけの PDF のページの文字を、PC の中で読む（0034 の段階3。試しの版）。
//!
//! - 外の AI・外のサービスには送らない。OS に入っている文字認識を本体から呼ぶ: macOS は Vision（`VNRecognizeTextRequest`）、
//!   Windows は Windows.Media.Ocr。ほかの OS（Linux など）は [`OcrError::Unsupported`]（読めません）を返す。
//! - ファイルを書かない・ネットにつながない。受け取るのは画像のバイト列だけで、返すのは読んだ文字の塊（[`OcrBox`]）だけ。
//! - 座標は画像の幅・高さに対する 0〜1 の割合で、原点は左上・下向きが正（macOS と Windows でそろえる）。
//!   1つの塊は「横に続く文字のまとまり」（Vision は観測の1つ、Windows は1行の中の近い単語をつないだもの）。
//!   画面の部品（statement/ の `toLines()`）で行と欄にまとめる前提なので、表の欄をまたいでつなげない。
//! - 番号を消す（0034 の2）のは、読んだ文字を受け取った画面の部品が行う（ここでは文字をそのまま返す）。

use serde::Serialize;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

/// 受け取る画像の大きさの上限（明細のファイルと同じ 10MB）
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// 読んだ文字の塊
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OcrBox {
    pub text: String,
    /// 左端（画像の幅に対する割合）
    pub x: f32,
    /// 上端（画像の高さに対する割合。上が 0）
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// 確からしさ（0〜1）。Vision だけが返す（Windows は無い）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conf: Option<f32>,
}

/// 読めなかった理由（画面にはコードだけを返す）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OcrError {
    /// この OS では文字認識を使えない（Linux など）
    Unsupported,
    /// OS に日本語の文字認識が入っていない（Windows の言語の機能が無い）
    NoLanguage,
    /// 画像として読めない（形が違う・壊れている）
    Image,
    /// 画像が大きすぎる
    TooLarge,
    /// OS の文字認識が失敗した
    Failed,
}

impl OcrError {
    pub fn code(self) -> &'static str {
        match self {
            OcrError::Unsupported => "E_OCR_UNSUPPORTED",
            OcrError::NoLanguage => "E_OCR_NO_LANGUAGE",
            OcrError::Image => "E_OCR_IMAGE",
            OcrError::TooLarge => "E_OCR_TOO_LARGE",
            OcrError::Failed => "E_OCR_FAILED",
        }
    }
}

/// 画像の形（先頭の印で見分ける）。PNG・JPEG・BMP・TIFF・GIF・HEIC
pub fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpeg")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some("tiff")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"heic" | b"heix" | b"mif1" | b"msf1")
    {
        Some("heic")
    } else {
        None
    }
}

/// どの文字認識を使うか（記録・測る道具の表示用）
pub fn backend() -> &'static str {
    if cfg!(target_os = "macos") {
        "vision"
    } else if cfg!(windows) {
        "windows-media-ocr"
    } else {
        "none"
    }
}

/// OS の文字認識が読める言語（記録・測る道具の表示用。読めない OS は空）
pub fn languages() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        mac::languages()
    }
    #[cfg(windows)]
    {
        win::languages()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Vec::new()
    }
}

/// 画像の文字を読む（日本語と英数字）。ファイルは書かない・ネットにつながない
pub fn recognize(bytes: &[u8]) -> Result<Vec<OcrBox>, OcrError> {
    recognize_in(bytes, Language::Japanese)
}

/// 読む言語（試しの比べ用。画面の命令は日本語だけを使う）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// 日本語（英数字も読む）
    Japanese,
    /// 英語だけ（数字・日付・金額の読み方を日本語と比べるため）
    English,
}

impl Language {
    #[cfg_attr(not(windows), allow(dead_code))]
    fn tag_prefix(self) -> &'static str {
        match self {
            Language::Japanese => "ja",
            Language::English => "en",
        }
    }
}

/// 言語を選んで画像の文字を読む
pub fn recognize_in(bytes: &[u8], lang: Language) -> Result<Vec<OcrBox>, OcrError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(OcrError::TooLarge);
    }
    if image_kind(bytes).is_none() {
        return Err(OcrError::Image);
    }
    #[cfg(target_os = "macos")]
    {
        mac::recognize(bytes, lang)
    }
    #[cfg(windows)]
    {
        win::recognize(bytes, lang)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = lang;
        Err(OcrError::Unsupported)
    }
}

/// 1行の中の単語（画素の単位。左上が原点）
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) struct Word {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 1行の単語を、近いものどうしでつなぐ（隙間が文字の高さの 0.9 倍を超えたら別の塊。表の欄をまたいでつながない）。
/// つなぐときは、両側が半角の英数字で、隙間が文字の高さの 0.3 倍を超えるときだけ空白をはさむ
/// （Windows は日本語を1字ずつ、数字を「10」「/」「01」のように区切って返すため。英語の単語の間の空白だけを残す）
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn merge_line(words: &[Word]) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    for w in words {
        if w.text.trim().is_empty() {
            continue;
        }
        if let Some(last) = out.last_mut() {
            let gap = w.x - (last.x + last.w);
            let h = last.h.max(w.h);
            if gap <= h * 0.9 {
                let alnum_end = last
                    .text
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_ascii_alphanumeric());
                let alnum_start = w
                    .text
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric());
                if alnum_end && alnum_start && gap > h * 0.3 {
                    last.text.push(' ');
                }
                last.text.push_str(&w.text);
                let right = (last.x + last.w).max(w.x + w.w);
                let bottom = (last.y + last.h).max(w.y + w.h);
                last.x = last.x.min(w.x);
                last.y = last.y.min(w.y);
                last.w = right - last.x;
                last.h = bottom - last.y;
                continue;
            }
        }
        out.push(w.clone());
    }
    out
}

/// 画素の単位の塊を、画像の大きさに対する割合にする（0〜1 に収める）
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn normalize(w: &Word, width: f32, height: f32, conf: Option<f32>) -> OcrBox {
    let c = |v: f32| v.clamp(0.0, 1.0);
    OcrBox {
        text: w.text.clone(),
        x: c(w.x / width),
        y: c(w.y / height),
        w: c(w.w / width),
        h: c(w.h / height),
        conf,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: f32, w: f32) -> Word {
        Word {
            text: text.to_owned(),
            x,
            y: 10.0,
            w,
            h: 20.0,
        }
    }

    #[test]
    fn kinds_by_magic() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nxxxx"), Some("png"));
        assert_eq!(image_kind(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpeg"));
        assert_eq!(image_kind(b"\0\0\0\x18ftypheic\0\0"), Some("heic"));
        assert_eq!(image_kind(b"%PDF-1.7"), None);
        assert_eq!(image_kind(b""), None);
    }

    #[test]
    fn rejects_non_images_and_large_bytes() {
        assert_eq!(recognize(b"%PDF-1.7"), Err(OcrError::Image));
        let big = vec![0u8; MAX_IMAGE_BYTES + 1];
        assert_eq!(recognize(&big), Err(OcrError::TooLarge));
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    #[test]
    fn other_os_cannot_read() {
        assert_eq!(recognize(b"\x89PNG\r\n\x1a\n"), Err(OcrError::Unsupported));
        assert!(languages().is_empty());
    }

    #[test]
    fn merges_close_words_but_not_across_columns() {
        // 「10」「/」「03」「あ」「お」「ば」…「1」「,」「234」: 日付と店は欄が離れているので別の塊。
        // 日本語の1字ずつの単語と、区切られた数字は空白なしでつなぐ。英語の単語の間（隙間が高さの 0.3 倍より大きい）は空白
        let words = [
            word("10", 0.0, 20.0),
            word("/", 21.0, 8.0),
            word("03", 30.0, 20.0),
            word("あ", 100.0, 20.0),
            word("お", 121.0, 20.0),
            word("ば", 142.0, 20.0),
            word("ABC", 300.0, 30.0),
            word("MART", 340.0, 40.0),
            word("1", 600.0, 10.0),
            word(",", 611.0, 4.0),
            word("234", 616.0, 30.0),
        ];
        let merged = merge_line(&words);
        let texts: Vec<&str> = merged.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["10/03", "あおば", "ABC MART", "1,234"]);
        assert_eq!(merged[1].x, 100.0);
        assert_eq!(merged[0].w, 50.0);
        assert_eq!(merged[1].w, 62.0);
    }

    #[test]
    fn normalizes_to_ratios() {
        let b = normalize(&word("x", 50.0, 100.0), 200.0, 100.0, None);
        assert_eq!((b.x, b.y, b.w, b.h), (0.25, 0.1, 0.5, 0.2));
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"text":"x","x":0.25,"y":0.1,"w":0.5,"h":0.2}"#
        );
    }
}
