//! アプリ本体の側の受け口（0015 の4）。作業フォルダに口（ソケット・パイプ）を開け、`app.json` を書き、接続口からの依頼を台帳に渡す。
//!
//! - 相手が別の OS ユーザーなら、何も読まずに切る
//! - 2秒以内に `hello` が来ない・合言葉が違う・名乗る前の依頼は切る（合言葉は時間が一定の比較）
//! - 1行が 1 MiB を超えたら、その接続だけを切る（アプリ本体は落ちない）
//! - 接続口と版が違えば `VERSION_MISMATCH`
//!
//! tokio のランタイムの中で `start` を呼ぶ（Tauri のアプリでは tauri::async_runtime の中）。

use crate::record::Caller;
use crate::registry::ShareRegistry;
use ai_ipc::discovery::{prepare_private_dir, Discovery};
use ai_ipc::framing::{write_json, LineReader};
use ai_ipc::messages::{
    Envelope, ErrorCode, Request, Response, IPC_VERSION, VERSION_MISMATCH_MESSAGE,
};
use ai_ipc::transport::{LocalListener, LocalStream, PeerInfo};
use ai_ipc::{constant_time_eq, random_hex, HELLO_TIMEOUT};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;

/// 名乗った後、次の依頼が来るまでの期限（口を開けたまま放っておかれないように）
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// 開いている受け口。`shutdown` で閉じる（落としたときも app.json を消す）
pub struct AppEndpoint {
    dir: PathBuf,
    discovery: Discovery,
    registry: Arc<ShareRegistry>,
    task: Option<JoinHandle<()>>,
}

impl AppEndpoint {
    /// 受け口を開ける。`dir` は作業フォルダ（通常は `ai_ipc::runtime_dir()`）、`app_version` はアプリ本体の版（接続口と同じでなければ断る）
    pub fn start(
        registry: Arc<ShareRegistry>,
        app_version: &str,
        dir: &Path,
    ) -> io::Result<AppEndpoint> {
        prepare_private_dir(dir)?;
        let (listener, endpoint) = LocalListener::bind(dir)?;
        let discovery = Discovery {
            ipc_version: IPC_VERSION,
            endpoint,
            token: random_hex(32),
            pid: std::process::id(),
            app_version: app_version.to_owned(),
        };
        discovery.write(dir)?;
        let token = discovery.token.clone();
        let version = app_version.to_owned();
        let reg = registry.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, peer)) = listener.accept().await else {
                    continue;
                };
                let reg = reg.clone();
                let token = token.clone();
                let version = version.clone();
                tokio::spawn(async move {
                    let _ = serve(stream, peer, reg, token, version).await;
                });
            }
        });
        Ok(AppEndpoint {
            dir: dir.to_owned(),
            discovery,
            registry,
            task: Some(task),
        })
    }

    /// `app.json` の中身（テストと画面の確かめ用）
    pub fn discovery(&self) -> &Discovery {
        &self.discovery
    }

    /// 閉じる: 口を閉じ、app.json を消し、すべての共有を「アプリの終了」で閉じる
    pub fn shutdown(mut self) {
        self.close();
    }

    fn close(&mut self) {
        if let Some(t) = self.task.take() {
            t.abort();
            self.discovery.remove_if_mine(&self.dir);
            self.registry.close_all();
        }
    }
}

impl Drop for AppEndpoint {
    fn drop(&mut self) {
        self.close();
    }
}

async fn serve(
    stream: LocalStream,
    peer: PeerInfo,
    registry: Arc<ShareRegistry>,
    token: String,
    app_version: String,
) -> io::Result<()> {
    if !peer.same_user {
        return Ok(()); // 別の OS ユーザー: 何も読まずに切る
    }
    let (r, mut w) = tokio::io::split(stream);
    let mut reader = LineReader::new(r);
    let first: Envelope = match tokio::time::timeout(HELLO_TIMEOUT, reader.read_json()).await {
        Ok(Ok(Some(e))) => e,
        _ => return Ok(()), // 名乗らない・壊れている・遅い
    };
    let mcp_client = match first.request {
        Request::Hello {
            token: t,
            client_version,
            ipc_version,
            mcp_client,
        } => {
            if !constant_time_eq(t.as_bytes(), token.as_bytes()) {
                let resp = Response::err(first.id, ErrorCode::Unauthorized, "合言葉が違います。");
                return write_json(&mut w, &resp).await;
            }
            if ipc_version != IPC_VERSION || client_version != app_version {
                let resp = Response::err(
                    first.id,
                    ErrorCode::VersionMismatch,
                    VERSION_MISMATCH_MESSAGE,
                );
                return write_json(&mut w, &resp).await;
            }
            mcp_client
        }
        _ => {
            let resp = Response::err(
                first.id,
                ErrorCode::Unauthorized,
                "最初に名乗ってください。",
            );
            return write_json(&mut w, &resp).await;
        }
    };
    write_json(
        &mut w,
        &Response::ok(
            first.id,
            serde_json::json!({ "appVersion": app_version }).to_string(),
        ),
    )
    .await?;
    let caller = Caller {
        connector_pid: peer.pid,
        connector_exe: peer.exe.map(|p| p.to_string_lossy().into_owned()),
        parent_exe: peer.parent_exe.map(|p| p.to_string_lossy().into_owned()),
        mcp_client_declared: mcp_client.map(|c| format!("{} {}", c.name, c.version)),
    };
    loop {
        let env: Envelope = match tokio::time::timeout(IDLE_TIMEOUT, reader.read_json()).await {
            Ok(Ok(Some(e))) => e,
            _ => return Ok(()), // 閉じた・1行が長すぎる・壊れている・放置
        };
        let result = match &env.request {
            Request::Hello { .. } => Err((ErrorCode::Invalid, "すでに名乗っています。".to_owned())),
            Request::ListShares => registry.handle_list(),
            Request::GetShare {
                share_id,
                tool,
                for_calc,
            } => {
                if *for_calc {
                    registry.handle_get_for_calc(share_id, tool, &caller)
                } else {
                    registry.handle_get(share_id, tool, &caller)
                }
            }
            Request::Propose { share_id, proposal } => {
                registry.handle_propose(share_id, proposal, &caller)
            }
            Request::ProposeDocuments { share_id, answer } => {
                registry.handle_propose_documents(share_id, answer, &caller)
            }
            Request::ProposeFeatureCode { code } => {
                registry.handle_propose_feature_code(code, &caller)
            }
            Request::ProposeHousehold { proposal } => {
                // 計算の入力の確かめは計算エンジンを動かすので、受け口の糸を止めない所で
                let reg = registry.clone();
                let (proposal, caller) = (proposal.clone(), caller.clone());
                tokio::task::spawn_blocking(move || {
                    reg.handle_propose_household(&proposal, &caller)
                })
                .await
                .unwrap_or_else(|_| {
                    Err((
                        ErrorCode::Invalid,
                        "候補を確かめられませんでした。".to_owned(),
                    ))
                })
            }
        };
        let resp = match result {
            Ok(json) => Response::ok(env.id, json),
            Err((code, message)) => Response::err(env.id, code, message),
        };
        write_json(&mut w, &resp).await?;
    }
}
