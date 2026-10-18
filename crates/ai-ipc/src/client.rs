//! 接続口の側: アプリ本体に1回の依頼をして返事を受け取る（呼び出しごとにつなぐ簡単な形）。

use crate::discovery::Discovery;
use crate::framing::{write_json, LineReader};
use crate::messages::{
    Envelope, ErrorCode, McpClientInfo, Request, Response, IPC_VERSION, VERSION_MISMATCH_MESSAGE,
};
use std::path::Path;
use std::time::Duration;

/// アプリ本体への1回の依頼の期限
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppError {
    /// app.json が無い・読めない・書かれた口につながらない（＝アプリが起動していない。アプリが落ちて app.json が残った場合も同じ）
    NotRunning,
    /// アプリ本体が断った（コードと、FPに見せてよい説明）
    Refused { code: ErrorCode, message: String },
    /// そのほか（壊れた返事・時間切れなど）
    Other(String),
}

/// FPに見せてよい「起動していない」の説明（0015 の2）
pub const NOT_RUNNING_MESSAGE: &str = "アプリが起動していません。アプリを起動して、FPが世帯を渡してください。（計算・制度の値・見本の世帯は、アプリが起動していなくても使えます）";

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotRunning => "NOT_RUNNING",
            AppError::Refused { code, .. } => code.as_str(),
            AppError::Other(_) => "IPC_ERROR",
        }
    }

    /// AIに返す（FPに見せてよい）説明
    pub fn user_message(&self) -> String {
        match self {
            AppError::NotRunning => NOT_RUNNING_MESSAGE.to_owned(),
            AppError::Refused { code, message } => format!("{message}（{}）", code.as_str()),
            AppError::Other(m) => format!("アプリとのやりとりに失敗しました: {m}"),
        }
    }
}

/// 接続口の情報（hello で名乗る）
#[derive(Debug, Clone)]
pub struct ClientHello {
    /// 接続口の版（アプリ本体と同じでなければ VERSION_MISMATCH）
    pub client_version: String,
    /// MCP のあいさつでAIのアプリが名乗った名前（自己申告）
    pub mcp_client: Option<McpClientInfo>,
}

/// アプリ本体に1回依頼する。成功なら結果の JSON の文字列（中身は変えずに返す）
pub async fn call_app(
    dir: &Path,
    hello: &ClientHello,
    request: Request,
) -> Result<String, AppError> {
    let disc = Discovery::read(dir).map_err(|_| AppError::NotRunning)?;
    if disc.ipc_version != IPC_VERSION || disc.app_version != hello.client_version {
        return Err(AppError::Refused {
            code: ErrorCode::VersionMismatch,
            message: VERSION_MISMATCH_MESSAGE.to_owned(),
        });
    }
    let fut = async {
        let stream = crate::transport::connect(&disc.endpoint)
            .await
            .map_err(|_| AppError::NotRunning)?;
        let (r, mut w) = tokio::io::split(stream);
        let mut reader = LineReader::new(r);
        let io = |e: std::io::Error| AppError::Other(e.to_string());
        let first = Envelope {
            id: 0,
            request: Request::Hello {
                token: disc.token.clone(),
                client_version: hello.client_version.clone(),
                ipc_version: IPC_VERSION,
                mcp_client: hello.mcp_client.clone(),
            },
        };
        write_json(&mut w, &first).await.map_err(io)?;
        let resp: Response = reader
            .read_json()
            .await
            .map_err(io)?
            .ok_or(AppError::NotRunning)?;
        if !resp.ok {
            return Err(refused(resp));
        }
        write_json(&mut w, &Envelope { id: 1, request })
            .await
            .map_err(io)?;
        let resp: Response = reader
            .read_json()
            .await
            .map_err(io)?
            .ok_or(AppError::NotRunning)?;
        if resp.ok {
            Ok(resp
                .result
                .map(|r| r.get().to_owned())
                .unwrap_or_else(|| "null".to_owned()))
        } else {
            Err(refused(resp))
        }
    };
    tokio::time::timeout(CALL_TIMEOUT, fut)
        .await
        .unwrap_or_else(|_| {
            Err(AppError::Other(
                "アプリの返事が時間内に来ませんでした".into(),
            ))
        })
}

fn refused(resp: Response) -> AppError {
    match resp.error {
        Some(e) => AppError::Refused {
            code: e.code,
            message: e.message,
        },
        None => AppError::Other("返事の形が違います".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_app_json_means_not_running() {
        let dir = std::env::temp_dir().join(format!("ai-ipc-none-{}", crate::random_hex(4)));
        let hello = ClientHello {
            client_version: "0.1.0".into(),
            mcp_client: None,
        };
        let e = call_app(&dir, &hello, Request::ListShares)
            .await
            .unwrap_err();
        assert_eq!(e, AppError::NotRunning);
    }

    #[tokio::test]
    async fn leftover_app_json_means_not_running() {
        // アプリが落ちて app.json だけ残った（書かれた口につながらない）
        let dir = std::env::temp_dir().join(format!("ai-ipc-stale-{}", crate::random_hex(4)));
        crate::discovery::prepare_private_dir(&dir).unwrap();
        Discovery {
            ipc_version: IPC_VERSION,
            endpoint: if cfg!(windows) {
                format!(
                    r"\\.\pipe\{}-gone-{}",
                    crate::IDENTIFIER,
                    crate::random_hex(4)
                )
            } else {
                dir.join("gone.sock").to_string_lossy().into_owned()
            },
            token: crate::random_hex(32),
            pid: 999_999,
            app_version: "0.1.0".into(),
        }
        .write(&dir)
        .unwrap();
        let hello = ClientHello {
            client_version: "0.1.0".into(),
            mcp_client: None,
        };
        let e = call_app(&dir, &hello, Request::ListShares)
            .await
            .unwrap_err();
        assert_eq!(e, AppError::NotRunning);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
