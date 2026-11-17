//! Windows: Windows.Media.Ocr（OS に入っている文字認識）。日本語は、OS の言語の機能（文字認識）が入っているときだけ読める。
//! 画像はメモリの中のストリームに書いて読む（ファイルに書かない）。PC の中で動き、ネットにつながない。

use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{
    BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform,
    ColorManagementMode, ExifOrientationMode,
};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

use crate::{merge_line, normalize, OcrBox, OcrError, Word};

pub(crate) fn languages() -> Vec<String> {
    let Ok(list) = OcrEngine::AvailableRecognizerLanguages() else {
        return Vec::new();
    };
    list.into_iter()
        .filter_map(|l| l.LanguageTag().ok().map(|t| t.to_string()))
        .collect()
}

/// 日本語の文字認識（入っている言語のうち「ja」で始まるもの）
fn japanese_engine() -> Result<OcrEngine, OcrError> {
    let tag = languages()
        .into_iter()
        .find(|t| t.to_ascii_lowercase().starts_with("ja"))
        .ok_or(OcrError::NoLanguage)?;
    let lang = Language::CreateLanguage(&HSTRING::from(tag)).map_err(|_| OcrError::NoLanguage)?;
    OcrEngine::TryCreateFromLanguage(&lang).map_err(|_| OcrError::NoLanguage)
}

pub(crate) fn recognize(bytes: &[u8]) -> Result<Vec<OcrBox>, OcrError> {
    let engine = japanese_engine()?;
    // メモリの中のストリームに画像のバイト列を書く
    let stream = InMemoryRandomAccessStream::new().map_err(|_| OcrError::Failed)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|_| OcrError::Failed)?;
    writer.WriteBytes(bytes).map_err(|_| OcrError::Failed)?;
    writer
        .StoreAsync()
        .and_then(|op| op.join())
        .map_err(|_| OcrError::Failed)?;
    writer.DetachStream().map_err(|_| OcrError::Failed)?;
    stream.Seek(0).map_err(|_| OcrError::Failed)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|op| op.join())
        .map_err(|_| OcrError::Image)?;
    // 文字認識が受ける大きさ（MaxImageDimension）を超えるときは縮める
    let (w0, h0) = (
        decoder.OrientedPixelWidth().map_err(|_| OcrError::Image)?,
        decoder.OrientedPixelHeight().map_err(|_| OcrError::Image)?,
    );
    if w0 == 0 || h0 == 0 {
        return Err(OcrError::Image);
    }
    let max = OcrEngine::MaxImageDimension().unwrap_or(10_000).max(1);
    let transform = BitmapTransform::new().map_err(|_| OcrError::Failed)?;
    if w0.max(h0) > max {
        let scale = f64::from(max) / f64::from(w0.max(h0));
        let sw = ((f64::from(w0) * scale) as u32).max(1);
        let sh = ((f64::from(h0) * scale) as u32).max(1);
        transform.SetScaledWidth(sw).map_err(|_| OcrError::Failed)?;
        transform
            .SetScaledHeight(sh)
            .map_err(|_| OcrError::Failed)?;
        transform
            .SetInterpolationMode(BitmapInterpolationMode::Fant)
            .map_err(|_| OcrError::Failed)?;
    }
    let bitmap = decoder
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &transform,
            ExifOrientationMode::RespectExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )
        .and_then(|op| op.join())
        .map_err(|_| OcrError::Image)?;
    let width = bitmap.PixelWidth().map_err(|_| OcrError::Image)? as f32;
    let height = bitmap.PixelHeight().map_err(|_| OcrError::Image)? as f32;
    if width <= 0.0 || height <= 0.0 {
        return Err(OcrError::Image);
    }
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|op| op.join())
        .map_err(|_| OcrError::Failed)?;
    let mut out = Vec::new();
    for line in result.Lines().map_err(|_| OcrError::Failed)? {
        let mut words = Vec::new();
        for word in line.Words().map_err(|_| OcrError::Failed)? {
            let text = word.Text().map_err(|_| OcrError::Failed)?.to_string();
            let r = word.BoundingRect().map_err(|_| OcrError::Failed)?;
            words.push(Word {
                text,
                x: r.X,
                y: r.Y,
                w: r.Width,
                h: r.Height,
            });
        }
        // 単語の左から順に並べてから、近いものどうしをつなぐ
        words.sort_by(|a, b| a.x.total_cmp(&b.x));
        out.extend(
            merge_line(&words)
                .iter()
                .map(|w| normalize(w, width, height, None)),
        );
    }
    Ok(out)
}
