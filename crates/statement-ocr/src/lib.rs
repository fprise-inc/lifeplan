//! 明細の写真・スクショ・画像だけの PDF のページの文字を、PC の中で読む（0034 の段階3。0221）。
//!
//! - 外の AI・外のサービスには送らない。OS に入っている文字認識を本体から呼ぶ: macOS は Vision（`VNRecognizeTextRequest`）、
//!   Windows は Windows.Media.Ocr。ほかの OS（Linux など）は [`OcrError::Unsupported`]（読めません）を返す。
//! - ファイルを書かない・ネットにつながない。受け取るのは画像のバイト列だけで、返すのは読んだ文字の塊（[`OcrBox`]）だけ。
//! - 座標は画像の幅・高さに対する 0〜1 の割合で、原点は左上・下向きが正（macOS と Windows でそろえる）。
//!   1つの塊は「横に続く文字のまとまり」（Vision は観測の1つ、Windows は1行の中の近い単語をつないだもの）。
//!   画面の部品（statement/ の `toLines()`）で行と欄にまとめる前提なので、表の欄をまたいでつなげない。
//! - 番号を消す（0034 の2）のは、読んだ文字を受け取った画面の部品が行う（ここでは文字をそのまま返す）。
//! - Windows は、日本語で読んだあと、同じ画像を英語でもう1回読む（[`OcrPage::digits`]。日本語の文字認識は数字を日本語の字と取り違える
//!   ことがあるため。どちらを使うかは画面の部品が数字の塊ごとに決める）。英語の文字認識が無ければ1回だけ読む。
//! - macOS は日本語を読める Vision（macOS 13 以降）でなければ [`OcrError::OldOs`]（古い Mac）。

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
    /// OS が古く、日本語を読めない（macOS 13 より前の Vision）
    OldOs,
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
            OcrError::OldOs => "E_OCR_OLD_MAC",
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

/// 1枚の画像を読んだ結果（画面の命令 `statement_ocr` が返す形）
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OcrPage {
    /// 画像の幅・高さ（画素）
    pub width: u32,
    pub height: u32,
    /// どの文字認識か（[`backend`]）
    pub engine: &'static str,
    /// 日本語で読んだ塊
    pub boxes: Vec<OcrBox>,
    /// 英語でもう1回読んだ塊（Windows だけ。英語の文字認識が無ければ無い）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digits: Option<Vec<OcrBox>>,
}

/// 画面の命令が使う読み方: 日本語で読み、Windows は英語でもう1回読む（数字の読み直し。決めたこと 2）
pub fn recognize_page(bytes: &[u8]) -> Result<OcrPage, OcrError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(OcrError::TooLarge);
    }
    if image_kind(bytes).is_none() {
        return Err(OcrError::Image);
    }
    #[cfg(target_os = "macos")]
    {
        let boxes = mac::recognize(bytes, Language::Japanese)?;
        let (width, height) = image_size(bytes).ok_or(OcrError::Image)?;
        Ok(OcrPage {
            width,
            height,
            engine: backend(),
            boxes,
            digits: None,
        })
    }
    #[cfg(windows)]
    {
        let (boxes, width, height) = win::recognize_sized(bytes, Language::Japanese)?;
        // 英語の文字認識が入っていない Windows は、日本語の1回だけ（数字の読み直しをしない）
        let digits = match win::recognize_sized(bytes, Language::English) {
            Ok((d, _, _)) => Some(d),
            Err(OcrError::NoLanguage) => None,
            Err(e) => return Err(e),
        };
        Ok(OcrPage {
            width,
            height,
            engine: backend(),
            boxes,
            digits,
        })
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Err(OcrError::Unsupported)
    }
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes(
        b.get(at..at + 2)?.try_into().ok()?,
    )))
}
fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}
fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes(
        b.get(at..at + 2)?.try_into().ok()?,
    )))
}
fn le32(b: &[u8], at: usize) -> Option<i64> {
    Some(i64::from(i32::from_le_bytes(
        b.get(at..at + 4)?.try_into().ok()?,
    )))
}

/// 画像の幅と高さ（画素。先頭の部分だけを読む）。PNG・JPEG・GIF・BMP・HEIC（いちばん大きい ispe）。読めなければ None
pub fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    let size = match image_kind(b)? {
        "png" => (be32(b, 16)?, be32(b, 20)?),
        "gif" => (le16(b, 6)?, le16(b, 8)?),
        "bmp" => (
            u32::try_from(le32(b, 18)?.abs()).ok()?,
            u32::try_from(le32(b, 22)?.abs()).ok()?,
        ),
        "jpeg" => {
            let mut i = 2;
            loop {
                if *b.get(i)? != 0xff {
                    i += 1;
                    continue;
                }
                let marker = *b.get(i + 1)?;
                if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
                    break (be16(b, i + 7)?, be16(b, i + 5)?);
                }
                if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
                    i += 2;
                    continue;
                }
                i += 2 + be16(b, i + 2)? as usize;
            }
        }
        "heic" => {
            // 画像の大きさの箱（ispe）のうち、いちばん大きいもの（縮小の絵・分けた絵の箱より、まとめた絵の箱が大きい）
            let mut best: Option<(u32, u32)> = None;
            let mut at = 0;
            while let Some(p) = b[at..].windows(4).position(|w| w == b"ispe") {
                let k = at + p;
                if let (Some(w), Some(h)) = (be32(b, k + 8), be32(b, k + 12)) {
                    if best.is_none_or(|(bw, bh)| {
                        u64::from(w) * u64::from(h) > u64::from(bw) * u64::from(bh)
                    }) {
                        best = Some((w, h));
                    }
                }
                at = k + 4;
            }
            // 回し（irot）が 90度・270度なら幅と高さを入れ替える
            let (w, h) = best?;
            match b
                .windows(4)
                .position(|w| w == b"irot")
                .and_then(|k| b.get(k + 4))
            {
                Some(r) if r & 1 == 1 => (h, w),
                _ => (w, h),
            }
        }
        _ => return None,
    };
    (size.0 > 0 && size.1 > 0).then_some(size)
}

/// 読む言語（試しの比較用。画面の命令は日本語だけを使う）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// 日本語（英数字も読む）
    Japanese,
    /// 英語だけ（数字・日付・金額の読み方を日本語と比較するため）
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
/// つなぐときは、両側が半角の英数字で隙間が文字の高さの 0.3 倍を超えるとき、またはどの字でも隙間が 0.75 倍を超えるときに空白をはさむ
/// （Windows は日本語を1字ずつ、数字を「10」「/」「01」のように区切って返すため。英語の単語の間と、店の名前と支店名の間の空白を残す。
/// 空白があれば、画面の部品が欄をまたぐ塊を空白で分けられる）
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
                if (alnum_end && alnum_start && gap > h * 0.3) || gap > h * 0.75 {
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
            word("駅", 396.0, 20.0),
            word("前", 417.0, 20.0),
            word("1", 600.0, 10.0),
            word(",", 611.0, 4.0),
            word("234", 616.0, 30.0),
        ];
        let merged = merge_line(&words);
        let texts: Vec<&str> = merged.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["10/03", "あおば", "ABC MART 駅前", "1,234"]);
        assert_eq!(merged[1].x, 100.0);
        assert_eq!(merged[0].w, 50.0);
        assert_eq!(merged[1].w, 62.0);
    }

    #[test]
    fn reads_image_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&1170u32.to_be_bytes());
        png.extend_from_slice(&2532u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((1170, 2532)));
        // JPEG: APP0 の後ろの SOF0
        let jpeg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02,
            0xf8, 0x04, 0xd8, 0x03,
        ];
        assert_eq!(image_size(&jpeg), Some((1240, 760)));
        let mut heic = b"\0\0\0\x18ftypheic\0\0\0\0".to_vec();
        for (w, h) in [(320u32, 240u32), (4032, 3024)] {
            heic.extend_from_slice(b"\0\0\0\x14ispe\0\0\0\0");
            heic.extend_from_slice(&w.to_be_bytes());
            heic.extend_from_slice(&h.to_be_bytes());
        }
        assert_eq!(image_size(&heic), Some((4032, 3024)));
        heic.extend_from_slice(b"\0\0\0\x09irot\x01");
        assert_eq!(
            image_size(&heic),
            Some((3024, 4032)),
            "90度の回しは幅と高さを入れ替える"
        );
        assert_eq!(image_size(b"%PDF-1.7"), None);
        assert_eq!(image_size(b"\x89PNG\r\n\x1a\n"), None, "途中で切れた画像");
    }

    #[test]
    fn page_rejects_non_images() {
        assert_eq!(recognize_page(b"%PDF-1.7"), Err(OcrError::Image));
        assert_eq!(OcrError::OldOs.code(), "E_OCR_OLD_MAC");
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    #[test]
    fn other_os_page_cannot_read() {
        assert_eq!(
            recognize_page(b"\x89PNG\r\n\x1a\n"),
            Err(OcrError::Unsupported)
        );
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
