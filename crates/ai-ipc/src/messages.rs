//! 接続口 → アプリ本体の依頼と、アプリ本体 → 接続口の返事（0015 の4）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 取り決めの版（接続口とアプリ本体の組み合わせを確かめる）
pub const IPC_VERSION: u32 = 1;

/// MCP のあいさつでAIのアプリが名乗った名前と版（自己申告。認証ではない。0015 の8）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Request {
    /// 接続して最初に必ず送る（2秒以内）。合言葉が合わなければ、アプリ本体は `UNAUTHORIZED` を返して切る
    Hello {
        token: String,
        client_version: String,
        ipc_version: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mcp_client: Option<McpClientInfo>,
    },
    /// いまAIに渡されている世帯の一覧（中身は含まない）
    ListShares,
    /// 渡された世帯（縮約版が既定）。`tool` は読んだ道具の名前（AIに渡した記録の `reads` に残す。0014 の3）。
    /// `for_calc` は計算に使う読み取り（calculate・explain_value）: 返事に、画面が計算の前に足す事務所の推定の値
    /// （事務所データの `defaults.estimates`）を `officeEstimates` として添える。接続口は計算にだけ使い、AIには見せない（0184）
    GetShare {
        share_id: String,
        tool: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        for_calc: bool,
    },
    /// AIのプランの候補を「AIからの候補」に承認待ちで入れる（世帯は変えない。0015 の7）
    Propose { share_id: String, proposal: Value },
    /// 書類から読んだ値の候補（答えの形 `document-candidates@1`）を承認待ちに入れる（世帯は変えない。0151）
    ProposeDocuments { share_id: String, answer: Value },
    /// 機能を有効にするコードを、アプリの画面に承認待ちの候補として出す（コードは入れない。FPが画面で押したときだけ入る。0015 の追記の2段目）
    ProposeFeatureCode { code: String },
    /// AIが組み立てた新しい世帯（計算の入力・架空かお客さまか・題・推定したこと）を、アプリの画面に承認待ちの候補として出す
    /// （世帯は作らない。FPが画面で中身を確かめて「世帯として作る」を押したときだけ作る。世帯を渡していなくてよい）
    ProposeHousehold { proposal: Value },
}

/// 失敗のコード（0015 の4）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Unauthorized,
    NotShared,
    Expired,
    Revoked,
    Invalid,
    VersionMismatch,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Unauthorized => "UNAUTHORIZED",
            ErrorCode::NotShared => "NOT_SHARED",
            ErrorCode::Expired => "EXPIRED",
            ErrorCode::Revoked => "REVOKED",
            ErrorCode::Invalid => "INVALID",
            ErrorCode::VersionMismatch => "VERSION_MISMATCH",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcError {
    pub code: ErrorCode,
    /// FPに見せてよい日本語の説明（顧客データを含めない）
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub id: u64,
    #[serde(flatten)]
    pub request: Request,
}

/// 返事。`result` は JSON の文字列のまま運ぶ（アプリ本体が作ったものを接続口が中身を変えずに渡すため。0015 の6）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Box<serde_json::value::RawValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcError>,
}

impl Response {
    /// 成功（`result_json` は JSON の文字列）
    pub fn ok(id: u64, result_json: String) -> Response {
        let raw = serde_json::value::RawValue::from_string(result_json)
            .unwrap_or_else(|_| serde_json::value::RawValue::from_string("null".into()).unwrap());
        Response {
            id,
            ok: true,
            result: Some(raw),
            error: None,
        }
    }

    pub fn err(id: u64, code: ErrorCode, message: impl Into<String>) -> Response {
        Response {
            id,
            ok: false,
            result: None,
            error: Some(IpcError {
                code,
                message: message.into(),
            }),
        }
    }
}

/// FPに見せてよい、版が合わないときの説明（0015 の1）
pub const VERSION_MISMATCH_MESSAGE: &str =
    "アプリと接続口の版が違います。AIとつなぐ画面から入れ直してください。";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_use_camel_case_fields() {
        let e = Envelope {
            id: 3,
            request: Request::GetShare {
                share_id: "s-1".into(),
                tool: "get_shared_household".into(),
                for_calc: false,
            },
        };
        let s = serde_json::to_string(&e).unwrap();
        assert_eq!(
            s,
            r#"{"id":3,"op":"getShare","shareId":"s-1","tool":"get_shared_household"}"#
        );
        let back: Envelope = serde_json::from_str(&s).unwrap();
        assert!(matches!(
            back.request,
            Request::GetShare {
                for_calc: false,
                ..
            }
        ));
        // 計算に使う読み取り（0184）
        let c = serde_json::to_string(&Request::GetShare {
            share_id: "s-1".into(),
            tool: "calculate".into(),
            for_calc: true,
        })
        .unwrap();
        assert_eq!(
            c,
            r#"{"op":"getShare","shareId":"s-1","tool":"calculate","forCalc":true}"#
        );
    }

    #[test]
    fn error_codes_are_screaming_snake_case() {
        let r = Response::err(1, ErrorCode::NotShared, "x");
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"NOT_SHARED\""), "{s}");
    }

    #[test]
    fn ok_keeps_result_bytes() {
        let r = Response::ok(1, r#"{"b":1,"a":2}"#.into());
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains(r#"{"b":1,"a":2}"#), "{s}");
    }
}
