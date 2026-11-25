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
    /// （事務所データの `defaults.estimates`）を `officeEstimates` として添える。接続口は計算にだけ使い、AIには見せない（0184）。
    /// ヒアリングの道具（get_hearing_options など）もこの読み取りで、画面の入力の進み具合 `enteredState`（保存した・足した入力項目の数、
    /// 仮の値を入れた欄のキー）を受け取り、今の値があるかを画面と同じ関数で決める（AIには見せない。0222 の追記 2026-11-19）
    GetShare {
        share_id: String,
        tool: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        for_calc: bool,
    },
    /// 顧客のフォローの要約のための読み取り（summarize_shared_households。0248）。返事は `GetShare` の計算に使う読み取り（`for_calc`）と同じ形に、
    /// フォローの要約の材料 `followup`（区分の記号と名前・前回の面談の日・面談の数・最後の控えの年月・「次回確かめる」の印の数。文は入れない）を添えたもの。
    /// `tool` は読んだ道具の名前（AIに渡した記録の `reads` に残す）。接続口とアプリは同じ版でしかつながらないので、足しても `IPC_VERSION` は変えない
    GetShareFollowup { share_id: String, tool: String },
    /// AIのプランの候補を「AIからの候補」に承認待ちで入れる（世帯は変えない。0015 の7）
    Propose { share_id: String, proposal: Value },
    /// 書類から読んだ値の候補（答えの形 `document-candidates@1`）を承認待ちに入れる（世帯は変えない。0151）
    ProposeDocuments { share_id: String, answer: Value },
    /// 機能を有効にするコードを、アプリの画面に承認待ちの候補として出す（コードは入れない。FPが画面で押したときだけ入る。0015 の追記の2段目）
    ProposeFeatureCode { code: String },
    /// AIが組み立てた新しい世帯（計算の入力・架空かお客さまか・題・推定したこと）を、アプリの画面に承認待ちの候補として出す
    /// （世帯は作らない。FPが画面で中身を確かめて「世帯として作る」を押したときだけ作る。世帯を渡していなくてよい）
    ProposeHousehold { proposal: Value },
    /// 事務所の既定値のうち、見せ方だけの設定（事務所データの `defaults` の入力項目の並び・新しい世帯で出す入力項目・基本生活費の内訳の並べ方・
    /// 対策に最初から出す項目・万一のタブの場面と想定の前提と、合算BS を使うか）を返す（読むだけ。0213）。計算の設定・推定の値・
    /// 名前やロゴ・ヒアリングのひな形は返さない。世帯を渡していなくてよい
    GetOfficeDisplay,
    /// 渡された世帯の見せ方の設定（世帯ファイルの本文の `display`・`household.itemChoice`・`workspace.shownItems`）を返す（読むだけ。0213）。
    /// `tool` は読んだ道具の名前（AIに渡した記録の `reads` に残す）
    GetShareDisplay { share_id: String, tool: String },
    /// 事務所の既定値の見せ方だけの設定（入力項目の並び・新しい世帯で出す入力項目・基本生活費の内訳の並べ方・対策に最初から出す項目・
    /// 万一のタブの想定の前提と場面の帯と開いたときの場面）の案を、アプリの画面に承認待ちの候補として出す（設定は変えない。FPが画面で
    /// 設定ごとに「反映する」を押したときだけ変わる。0215）。`proposal` は `{ changes: [{ id, value, note? }] }`。世帯を渡していなくてよい
    ProposeDisplay { proposal: Value },
    /// 渡された世帯の世帯ごとの表示の設定（結果のタブ・資産と負債のタブの表示の設定・この世帯で並べる時点・入力項目の選び方）の案を、
    /// アプリの画面に承認待ちの候補として出す（世帯ファイルは変えない。FPがその世帯を開いて設定ごとに「反映する」を押したときだけ変わる）。
    /// 共有の決まりは世帯を扱うほかの依頼と同じ（期限内・取り消されていない・同意がある。架空の世帯は同意が無くても渡せる）で、
    /// 案を出したことを「AIに渡した記録」に残す。`proposal` は `{ changes: [{ id, value, note? }] }`
    ProposeShareDisplay { share_id: String, proposal: Value },
    /// 事務所の Web のヒアリングのひな形（事務所データの `defaults.hearingTemplates`）と、ご相談したいことの話題の事務所の既定値
    /// （`defaults.hearingTopics`。無ければ null）を返す（読むだけ。0222）。世帯を渡していなくてよい
    GetOfficeHearing,
    /// Web のヒアリングの URL を発行する（0222）。`issue` は `{ selection, purpose? }`（selection は接続口が画面と同じ関数で確かめた WebSelection）。
    /// `share_id` を書くと、渡された世帯の依頼（共有の決まりは世帯を扱うほかの依頼と同じで、発行したことを「AIに渡した記録」に残す）、
    /// 省くと世帯の決まっていない依頼（新しいお客さま向け。鍵と記録は事務所データ）。発行はアプリの画面が FP の画面と同じ関数で行い、
    /// 見直し（今の値を見せる項目）を含む依頼の URL と案内文は返さない。返事が来るまで長くかかる（`call_app` の期限は `ISSUE_HEARING_TIMEOUT`）
    IssueHearing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        share_id: Option<String>,
        issue: Value,
    },
    /// Web のヒアリングの事務所のひな形（カスタム）の案を、アプリの画面に承認待ちの候補として出す（事務所の既定値は変えない。FPが画面で
    /// 「ひな形として保存する」を押したときだけ入る。0222）。`proposal` は `{ name, selection, note? }`。世帯を渡していなくてよい
    ProposeHearingTemplate { proposal: Value },
    /// この PC のアプリのエラーの記録（日時・版・OS・画面・操作・種類・削った文。世帯の中身・ファイルの場所は入っていない）を返す
    /// （読むだけ。0234）。世帯を渡していなくてよい。世帯の中身ではないので「AIに渡した記録」には残さず、アプリが読まれた回数を記録の中に残す
    GetErrorLog,
    /// AI がまとめた要望・不具合の報告（`report` は `{ items: [{ kind, screen?, text }] }`。FP が話した内容を1件ずつに分けた物）を、アプリの「送る報告の確認画面」に承認待ちで出す（送らない・
    /// フォームを開かない。FP が画面で中身を確かめて「送る」を押したときだけ、アプリが文を写してフォームを開く。0259）。世帯を渡していなくてよい。
    /// 世帯の中身ではないので「AIに渡した記録」には残さない
    ProposeIssueReport { report: Value },
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
    fn display_requests_use_camel_case() {
        // 表示の設定を読む依頼（0213）
        assert_eq!(
            serde_json::to_string(&Request::GetOfficeDisplay).unwrap(),
            r#"{"op":"getOfficeDisplay"}"#
        );
        assert_eq!(
            serde_json::to_string(&Request::GetShareDisplay {
                share_id: "s-1".into(),
                tool: "get_display_settings".into(),
            })
            .unwrap(),
            r#"{"op":"getShareDisplay","shareId":"s-1","tool":"get_display_settings"}"#
        );
        // 表示の設定の案（0215）
        assert_eq!(
            serde_json::to_string(&Request::ProposeDisplay {
                proposal: serde_json::json!({ "changes": [] }),
            })
            .unwrap(),
            r#"{"op":"proposeDisplay","proposal":{"changes":[]}}"#
        );
        // 渡された世帯の表示の設定の案
        assert_eq!(
            serde_json::to_string(&Request::ProposeShareDisplay {
                share_id: "s-1".into(),
                proposal: serde_json::json!({ "changes": [] }),
            })
            .unwrap(),
            r#"{"op":"proposeShareDisplay","shareId":"s-1","proposal":{"changes":[]}}"#
        );
    }

    #[test]
    fn hearing_requests_use_camel_case() {
        // Web のヒアリング（0222）
        assert_eq!(
            serde_json::to_string(&Request::GetOfficeHearing).unwrap(),
            r#"{"op":"getOfficeHearing"}"#
        );
        assert_eq!(
            serde_json::to_string(&Request::IssueHearing {
                share_id: None,
                issue: serde_json::json!({ "selection": {} }),
            })
            .unwrap(),
            r#"{"op":"issueHearing","issue":{"selection":{}}}"#
        );
        assert_eq!(
            serde_json::to_string(&Request::IssueHearing {
                share_id: Some("s-1".into()),
                issue: serde_json::json!({}),
            })
            .unwrap(),
            r#"{"op":"issueHearing","shareId":"s-1","issue":{}}"#
        );
        assert_eq!(
            serde_json::to_string(&Request::ProposeHearingTemplate {
                proposal: serde_json::json!({ "name": "初回" }),
            })
            .unwrap(),
            r#"{"op":"proposeHearingTemplate","proposal":{"name":"初回"}}"#
        );
    }

    #[test]
    fn followup_request_uses_camel_case() {
        // 顧客のフォローの要約のための読み取り（0248）
        assert_eq!(
            serde_json::to_string(&Request::GetShareFollowup {
                share_id: "s-1".into(),
                tool: "summarize_shared_households".into(),
            })
            .unwrap(),
            r#"{"op":"getShareFollowup","shareId":"s-1","tool":"summarize_shared_households"}"#
        );
    }

    #[test]
    fn error_log_request_uses_camel_case() {
        // エラーの記録（0234）
        assert_eq!(
            serde_json::to_string(&Request::GetErrorLog).unwrap(),
            r#"{"op":"getErrorLog"}"#
        );
        // 送る報告の確認画面に出す（0259）
        assert_eq!(
            serde_json::to_string(&Request::ProposeIssueReport {
                report: serde_json::json!({ "items": [] }),
            })
            .unwrap(),
            r#"{"op":"proposeIssueReport","report":{"items":[]}}"#
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
