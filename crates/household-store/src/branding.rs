//! 事務所の見た目（0121）: 事務所の名前・ロゴの画像・基調の色と、この PC の画面の明るさ（明るい・暗い・OS に合わせる）。
//!
//! - 事務所データ（暗号化。0011 の6）の任意の欄に持つ。事務所で共有していても、この PC の設定（共有フォルダには置かない。0073 と同じ）。
//! - ロゴの画像は PNG と JPEG だけ（0016。SVG は中にスクリプトを持てるので受けない）。大きさの上限は [`LOGO_MAX_BYTES`]・
//!   [`LOGO_MAX_SIDE`]。ここでは見出しのバイト（種類の印と縦横の画素）を確かめる。中身を絵にできるかは呼ぶ側（アプリ本体が帳票の
//!   部品で組んでみる）が確かめる。
//! - 画像のバイトは事務所データの JSON の中に base64 の文字で持つ。外に返すときも同じ形（画面は `img` の URL にせず、
//!   `createImageBitmap` でキャンバスに描く。CSP の `img-src 'self'` を変えない）。

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::StoreError;

/// ロゴの画像のバイトの上限（256KB）
pub const LOGO_MAX_BYTES: usize = 256 * 1024;
/// ロゴの画像の縦・横の画素の上限と下限
pub const LOGO_MAX_SIDE: u32 = 2000;
pub const LOGO_MIN_SIDE: u32 = 8;
/// 事務所の名前の文字数の上限
pub const NAME_MAX_CHARS: usize = 40;

/// 画面の明るさ（この PC の設定）
pub const APPEARANCES: &[&str] = &["light", "dark", "system"];

/// ロゴの画像（種類・縦横の画素・バイト）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logo {
    /// `image/png` か `image/jpeg`
    pub mime: String,
    pub width: u32,
    pub height: u32,
    /// 画像のバイト（JSON では base64 の文字）
    #[serde(with = "b64")]
    pub data: Vec<u8>,
}

/// 事務所の見た目。どの欄も任意（無ければ今までの見た目）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branding {
    /// 事務所の名前（左上に出す。提案書の表紙にも）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 基調の色（`#rrggbb` の小文字。画面が見やすさを確かめて導いた色にする前の、選んだ色）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 画面の明るさ（`light`・`dark`・`system`。無ければ `system`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<Logo>,
}

impl Branding {
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.color.is_none()
            && self.appearance.is_none()
            && self.logo.is_none()
    }
}

/// 画像の見出しを読んだ結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogoInfo {
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

/// ロゴの画像を確かめる（PNG・JPEG の見出し・大きさ・縦横の画素）。合わなければ `E_STORE_LOGO`（大きすぎるときは `E_STORE_LOGO_TOO_LARGE`）
pub fn check_logo(bytes: &[u8]) -> Result<LogoInfo, StoreError> {
    if bytes.len() > LOGO_MAX_BYTES {
        return Err(StoreError::LOGO_TOO_LARGE);
    }
    let (mime, width, height) = if let Some((w, h)) = png_size(bytes) {
        ("image/png", w, h)
    } else if let Some((w, h)) = jpeg_size(bytes) {
        ("image/jpeg", w, h)
    } else {
        return Err(StoreError::LOGO);
    };
    if width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE {
        return Err(StoreError::LOGO);
    }
    if width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE {
        return Err(StoreError::LOGO_TOO_LARGE);
    }
    Ok(LogoInfo {
        mime,
        width,
        height,
    })
}

/// PNG の縦横（印と最初の IHDR の塊）
fn png_size(b: &[u8]) -> Option<(u32, u32)> {
    const SIG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if b.len() < 33 || &b[..8] != SIG || b[8..12] != [0, 0, 0, 13] || &b[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(b[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(b[20..24].try_into().ok()?);
    Some((w, h))
}

/// JPEG の縦横（SOI の後の区切りをたどり、最初の SOF の塊から読む）
fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 4 || b[0] != 0xff || b[1] != 0xd8 {
        return None;
    }
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xff {
            return None;
        }
        let m = b[i + 1];
        if m == 0xff {
            i += 1;
            continue;
        }
        // 長さを持たない区切り
        if m == 0x01 || (0xd0..=0xd7).contains(&m) {
            i += 2;
            continue;
        }
        if m == 0xd9 || m == 0xda {
            return None;
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if len < 2 || i + 2 + len > b.len() {
            return None;
        }
        let sof = matches!(m, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf);
        if sof {
            if len < 7 {
                return None;
            }
            let h = u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32;
            let w = u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32;
            return Some((w, h));
        }
        i += 2 + len;
    }
    None
}

/// `#rrggbb`（大文字も読む）を小文字にする
fn color_of(s: &str) -> Option<String> {
    let t = s.trim();
    let hex = t.strip_prefix('#')?;
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(format!("#{}", hex.to_ascii_lowercase()))
    } else {
        None
    }
}

/// 受け取った見た目を確かめて整える（名前は前後の空白を外し、空なら無し。色は小文字。画像は見出しを読み直して種類・縦横を付け直す）
pub fn normalize(b: Branding) -> Result<Branding, StoreError> {
    let name = match b.name {
        Some(n) => {
            let t = n.trim().to_owned();
            if t.chars().count() > NAME_MAX_CHARS || t.chars().any(|c| c.is_control()) {
                return Err(StoreError::BRANDING);
            }
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }
        None => None,
    };
    let color = match b.color {
        Some(c) => Some(color_of(&c).ok_or(StoreError::BRANDING)?),
        None => None,
    };
    let appearance = match b.appearance {
        Some(a) if APPEARANCES.contains(&a.as_str()) => Some(a),
        Some(_) => return Err(StoreError::BRANDING),
        None => None,
    };
    let logo = match b.logo {
        Some(l) => {
            let info = check_logo(&l.data)?;
            Some(Logo {
                mime: info.mime.to_owned(),
                width: info.width,
                height: info.height,
                data: l.data,
            })
        }
        None => None,
    };
    Ok(Branding {
        name,
        color,
        appearance,
        logo,
    })
}

/// base64 の文字で読み書きする（Vec<u8>）
mod b64 {
    use base64::Engine as _;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(v))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let t = String::deserialize(d)?;
        base64::engine::general_purpose::STANDARD
            .decode(t.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}

/// base64 の文字から画像のバイト（読めなければ `E_STORE_LOGO`）
pub fn decode_b64(s: &str) -> Result<Vec<u8>, StoreError> {
    base64::engine::general_purpose::STANDARD
        .decode(s.trim().as_bytes())
        .map_err(|_| StoreError::LOGO)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        v
    }

    fn jpeg(w: u16, h: u16) -> Vec<u8> {
        let mut v = vec![0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0];
        v.extend_from_slice(&[0xff, 0xc0, 0, 11, 8]);
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&[1, 1, 0x11, 0, 0xff, 0xd9]);
        v
    }

    #[test]
    fn reads_png_and_jpeg_headers() {
        assert_eq!(
            check_logo(&png(320, 80)).unwrap(),
            LogoInfo {
                mime: "image/png",
                width: 320,
                height: 80
            }
        );
        assert_eq!(
            check_logo(&jpeg(400, 120)).unwrap(),
            LogoInfo {
                mime: "image/jpeg",
                width: 400,
                height: 120
            }
        );
    }

    #[test]
    fn refuses_svg_gif_and_odd_sizes() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
        assert_eq!(check_logo(svg).unwrap_err(), StoreError::LOGO);
        assert_eq!(
            check_logo(b"GIF89a\x10\x00\x10\x00").unwrap_err(),
            StoreError::LOGO
        );
        assert_eq!(check_logo(&png(4, 4)).unwrap_err(), StoreError::LOGO);
        assert_eq!(
            check_logo(&png(4000, 100)).unwrap_err(),
            StoreError::LOGO_TOO_LARGE
        );
        let mut big = png(100, 100);
        big.resize(LOGO_MAX_BYTES + 1, 0);
        assert_eq!(check_logo(&big).unwrap_err(), StoreError::LOGO_TOO_LARGE);
    }

    #[test]
    fn normalizes_fields() {
        let b = normalize(Branding {
            name: Some("  みどりFP事務所 ".into()),
            color: Some("#2F6B4F".into()),
            appearance: Some("dark".into()),
            logo: Some(Logo {
                mime: "image/gif".into(),
                width: 1,
                height: 1,
                data: png(64, 32),
            }),
        })
        .unwrap();
        assert_eq!(b.name.as_deref(), Some("みどりFP事務所"));
        assert_eq!(b.color.as_deref(), Some("#2f6b4f"));
        let l = b.logo.unwrap();
        assert_eq!((l.mime.as_str(), l.width, l.height), ("image/png", 64, 32));
        assert!(normalize(Branding {
            color: Some("red".into()),
            ..Default::default()
        })
        .is_err());
        assert!(normalize(Branding {
            appearance: Some("sepia".into()),
            ..Default::default()
        })
        .is_err());
        assert!(normalize(Branding {
            name: Some("あ".repeat(NAME_MAX_CHARS + 1)),
            ..Default::default()
        })
        .is_err());
        assert_eq!(
            normalize(Branding {
                name: Some("   ".into()),
                ..Default::default()
            })
            .unwrap(),
            Branding::default()
        );
    }

    #[test]
    fn logo_bytes_are_base64_in_json() {
        let b = Branding {
            logo: Some(Logo {
                mime: "image/png".into(),
                width: 64,
                height: 32,
                data: vec![1, 2, 3],
            }),
            ..Default::default()
        };
        let j = serde_json::to_value(&b).unwrap();
        assert_eq!(j["logo"]["data"], "AQID");
        let back: Branding = serde_json::from_value(j).unwrap();
        assert_eq!(back, b);
        assert_eq!(decode_b64("AQID").unwrap(), vec![1, 2, 3]);
    }
}
