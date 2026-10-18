//! アプリ本体の受け口（0015 の4 と「テストで確かめること」）: 作業フォルダ・app.json の権限、合言葉、名乗る前の依頼、
//! 2秒以内に名乗らない接続、1 MiB を超える行、版の食い違い、終了で app.json が消えること。

use ai_ipc::client::{call_app, AppError, ClientHello};
use ai_ipc::framing::{write_json, LineReader};
use ai_ipc::messages::{Envelope, ErrorCode, Request, Response, IPC_VERSION};
use ai_ipc::{connect, Discovery};
use ai_share::{AppEndpoint, GrantOptions, ShareRegistry, SharedHouseholdSource};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const VERSION: &str = "0.1.0";

fn temp_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ai-share-{name}-{}", ai_ipc::random_hex(4)))
}

fn hello() -> ClientHello {
    ClientHello {
        client_version: VERSION.into(),
        mcp_client: Some(ai_ipc::McpClientInfo {
            name: "test-client".into(),
            version: "1".into(),
        }),
    }
}

fn source() -> SharedHouseholdSource {
    let p =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/modelHouseholds/single25.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    SharedHouseholdSource {
        household_id: "11111111-1111-4111-8111-111111111111".into(),
        customer_number: Some("A0001".into()),
        revision: "r1".into(),
        input: v["input"].clone(),
        texts: vec![],
        labels_by_member: None,
        external_ai_consent: Some(ai_share::ConsentRef {
            decision: ai_share::ConsentDecision::Given,
            record_id: "c".into(),
        }),
    }
}

async fn raw_conn(dir: &std::path::Path) -> ai_ipc::LocalStream {
    let disc = Discovery::read(dir).unwrap();
    connect(&disc.endpoint).await.unwrap()
}

/// 相手が切ったか（読みが EOF かエラーになる）
async fn closed_by_peer(reader: &mut LineReader<tokio::io::ReadHalf<ai_ipc::LocalStream>>) -> bool {
    match tokio::time::timeout(Duration::from_secs(5), reader.read_json::<Response>()).await {
        Ok(Ok(None)) | Ok(Err(_)) => true,
        Ok(Ok(Some(_))) => false,
        Err(_) => false,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn endpoint_follows_the_rules() {
    let dir = temp_dir("ep");
    let reg = Arc::new(ShareRegistry::new());
    let ep = AppEndpoint::start(reg.clone(), VERSION, &dir).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700, "作業フォルダは 0700");
        assert_eq!(mode(&Discovery::path(&dir)), 0o600, "app.json は 0600");
        assert_eq!(
            mode(std::path::Path::new(&ep.discovery().endpoint)),
            0o600,
            "ソケットは 0600"
        );
    }
    let disc = Discovery::read(&dir).unwrap();
    assert_eq!(disc.ipc_version, IPC_VERSION);
    assert_eq!(disc.token.len(), 64);
    assert_eq!(disc.pid, std::process::id());

    // 正しく名乗れば使える（まだ何も渡していない）
    let list = call_app(&dir, &hello(), Request::ListShares).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&list).unwrap()["shares"],
        serde_json::json!([])
    );
    let e = call_app(
        &dir,
        &hello(),
        Request::GetShare {
            share_id: "s-x".into(),
            tool: "get_shared_household".into(),
        },
    )
    .await
    .unwrap_err();
    assert!(
        matches!(
            e,
            AppError::Refused {
                code: ErrorCode::NotShared,
                ..
            }
        ),
        "{e:?}"
    );

    // 渡せば読め、読んだ記録に接続口の名乗りと相手のプロセスが残る
    let g = reg
        .grant(
            source(),
            GrantOptions {
                destination_declared: "Claude Code".into(),
                ..GrantOptions::default()
            },
        )
        .unwrap();
    let got = call_app(
        &dir,
        &hello(),
        Request::GetShare {
            share_id: g.share_id.clone(),
            tool: "get_shared_household".into(),
        },
    )
    .await
    .unwrap();
    let got: Value = serde_json::from_str(&got).unwrap();
    assert_eq!(got["alias"], g.alias.as_str());
    let rec = reg.records("11111111-1111-4111-8111-111111111111");
    let caller = &rec[0].reads[0].caller;
    assert_eq!(caller.mcp_client_declared.as_deref(), Some("test-client 1"));
    assert_eq!(
        caller.connector_pid,
        Some(std::process::id()),
        "相手のプロセス（このテスト自身）"
    );
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    assert!(caller.connector_exe.is_some());

    // 合言葉が違う
    {
        let (r, mut w) = tokio::io::split(raw_conn(&dir).await);
        let mut reader = LineReader::new(r);
        let bad = Envelope {
            id: 0,
            request: Request::Hello {
                token: "0".repeat(64),
                client_version: VERSION.into(),
                ipc_version: IPC_VERSION,
                mcp_client: None,
            },
        };
        write_json(&mut w, &bad).await.unwrap();
        let resp: Response = reader.read_json().await.unwrap().unwrap();
        assert_eq!(resp.error.unwrap().code, ErrorCode::Unauthorized);
        assert!(closed_by_peer(&mut reader).await, "違う合言葉の後は切る");
    }
    // 名乗る前の依頼
    {
        let (r, mut w) = tokio::io::split(raw_conn(&dir).await);
        let mut reader = LineReader::new(r);
        write_json(
            &mut w,
            &Envelope {
                id: 0,
                request: Request::ListShares,
            },
        )
        .await
        .unwrap();
        let resp: Response = reader.read_json().await.unwrap().unwrap();
        assert_eq!(resp.error.unwrap().code, ErrorCode::Unauthorized);
        assert!(closed_by_peer(&mut reader).await);
    }
    // 2秒以内に名乗らない
    {
        let (r, _w) = tokio::io::split(raw_conn(&dir).await);
        let mut reader = LineReader::new(r);
        let started = std::time::Instant::now();
        assert!(closed_by_peer(&mut reader).await, "名乗らない接続は切る");
        assert!(started.elapsed() >= Duration::from_millis(1500));
    }
    // 1 MiB を超える行: その接続だけを切り、アプリは落ちない
    {
        let (r, mut w) = tokio::io::split(raw_conn(&dir).await);
        let mut reader = LineReader::new(r);
        let big = vec![b'x'; ai_ipc::MAX_LINE_BYTES + 10];
        let _ = w.write_all(&big).await;
        let _ = w.write_all(b"\n").await;
        assert!(closed_by_peer(&mut reader).await);
        assert!(
            call_app(&dir, &hello(), Request::ListShares).await.is_ok(),
            "ほかの接続は使える"
        );
    }
    // 版が違う（接続口の側で app.json を見て断る／アプリの側でも断る）
    {
        let old = ClientHello {
            client_version: "0.0.9".into(),
            mcp_client: None,
        };
        let e = call_app(&dir, &old, Request::ListShares).await.unwrap_err();
        assert!(
            matches!(
                e,
                AppError::Refused {
                    code: ErrorCode::VersionMismatch,
                    ..
                }
            ),
            "{e:?}"
        );
        let (r, mut w) = tokio::io::split(raw_conn(&dir).await);
        let mut reader = LineReader::new(r);
        let req = Envelope {
            id: 0,
            request: Request::Hello {
                token: disc.token.clone(),
                client_version: "0.0.9".into(),
                ipc_version: IPC_VERSION,
                mcp_client: None,
            },
        };
        write_json(&mut w, &req).await.unwrap();
        let resp: Response = reader.read_json().await.unwrap().unwrap();
        assert_eq!(resp.error.unwrap().code, ErrorCode::VersionMismatch);
    }

    // 終了: app.json が消え、共有は「アプリの終了」で閉じ、接続口からは「起動していない」
    ep.shutdown();
    assert!(!Discovery::path(&dir).exists());
    assert_eq!(rec_end(&reg), Some(ai_share::EndReason::AppClosed));
    let e = call_app(&dir, &hello(), Request::ListShares)
        .await
        .unwrap_err();
    assert_eq!(e, AppError::NotRunning);
    let _ = std::fs::remove_dir_all(&dir);
}

fn rec_end(reg: &ShareRegistry) -> Option<ai_share::EndReason> {
    reg.records("11111111-1111-4111-8111-111111111111")[0].end_reason
}

#[tokio::test(flavor = "multi_thread")]
async fn second_app_cannot_take_over_a_running_one() {
    let dir = temp_dir("dup");
    let reg = Arc::new(ShareRegistry::new());
    let ep = AppEndpoint::start(reg.clone(), VERSION, &dir).unwrap();
    #[cfg(unix)]
    assert!(
        AppEndpoint::start(reg.clone(), VERSION, &dir).is_err(),
        "二重起動は止める"
    );
    drop(ep);
    assert!(
        !Discovery::path(&dir).exists(),
        "落としたときも app.json を消す"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
