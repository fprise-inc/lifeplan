//! macOS: Vision の文字認識（`VNRecognizeTextRequest`。正確さを優先する読み方・日本語と英語）。
//! 画像はメモリの中のバイト列のまま渡す（ファイルに書かない）。Vision は PC の中で動き、ネットにつながない。

use objc2::rc::{autoreleasepool, Retained};
use objc2::AnyThread;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

use crate::{OcrBox, OcrError};

/// 読む言語（先のものを優先する）
const LANGUAGES: [&str; 2] = ["ja-JP", "en-US"];

fn request() -> Retained<VNRecognizeTextRequest> {
    // SAFETY: 引数の無い初期化。設定する値はどれも Vision の決まった値か、作った文字列の配列
    unsafe {
        let req = VNRecognizeTextRequest::init(VNRecognizeTextRequest::alloc());
        req.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        req.setUsesLanguageCorrection(true);
        let langs: Vec<Retained<NSString>> =
            LANGUAGES.iter().map(|l| NSString::from_str(l)).collect();
        req.setRecognitionLanguages(&NSArray::from_retained_slice(&langs));
        req
    }
}

pub(crate) fn languages() -> Vec<String> {
    autoreleasepool(|_| {
        let req = request();
        // SAFETY: 作った要求に、読める言語を聞くだけ
        match unsafe { req.supportedRecognitionLanguagesAndReturnError() } {
            Ok(list) => list.iter().map(|s| s.to_string()).collect(),
            Err(_) => Vec::new(),
        }
    })
}

pub(crate) fn recognize(bytes: &[u8]) -> Result<Vec<OcrBox>, OcrError> {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(bytes);
        let options = NSDictionary::new();
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &data,
            &options,
        );
        let req = request();
        let as_request: Retained<VNRequest> =
            Retained::into_super(Retained::into_super(req.clone()));
        let requests = NSArray::from_retained_slice(&[as_request]);
        // 画像として読めないときも、ここで失敗が返る
        handler
            .performRequests_error(&requests)
            .map_err(|_| OcrError::Image)?;
        let Some(results) = req.results() else {
            return Ok(Vec::new());
        };
        let mut out = Vec::with_capacity(results.len());
        for obs in results.iter() {
            let candidates = obs.topCandidates(1);
            let Some(top) = candidates.firstObject() else {
                continue;
            };
            let text = top.string().to_string();
            if text.trim().is_empty() {
                continue;
            }
            // SAFETY: 結果の観測の値を読むだけ
            let (conf, bb) = unsafe { (top.confidence(), obs.boundingBox()) };
            let c = |v: f64| (v as f32).clamp(0.0, 1.0);
            // Vision の箱は左下が原点・上向きが正。左上が原点・下向きが正にそろえる
            out.push(OcrBox {
                text,
                x: c(bb.origin.x),
                y: c(1.0 - (bb.origin.y + bb.size.height)),
                w: c(bb.size.width),
                h: c(bb.size.height),
                conf: Some(conf.clamp(0.0, 1.0)),
            });
        }
        Ok(out)
    })
}
