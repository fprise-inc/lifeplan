//! アプリ本体と AI接続口（`lifeplan mcp`）の間の、同じPCの中だけの取り決め（0015 の4）。
//!
//! - Mac・Linux: そのOSユーザー専用のフォルダ（0700）の Unix ドメインソケット（0600）。接続時に OS から相手の uid を受け取り、自分と違えば切る
//! - Windows: 名前付きパイプ（そのOSユーザーの SID だけを許す DACL・リモート接続の拒否・最初のインスタンスの強制）
//! - アプリ本体は起動時に作業フォルダへ `app.json`（0600）を書き、終了時に消す
//! - メッセージは1行に1つの JSON（上限 1 MiB）。接続口は接続して2秒以内に `hello`（起動ごとの合言葉つき）を送る
//!
//! この取り決めは、アプリ本体と接続口が同じビルドで配られるので公開の約束にしない（`ipcVersion` で区別し、変えてよい）。

pub mod client;
pub mod discovery;
pub mod framing;
pub mod messages;
pub mod peer;
pub mod transport;

use std::time::Duration;

pub use discovery::{runtime_dir, Discovery, DISCOVERY_FILE};
pub use messages::{ErrorCode, IpcError, McpClientInfo, Request, Response, IPC_VERSION};
pub use transport::{connect, LocalListener, LocalStream, PeerInfo};

/// アプリの識別子（config/distribution.toml の identifier。ビルドの時に読む。0017 の2）
pub const IDENTIFIER: &str = env!("FINANCIA_IDENTIFIER");

/// 1行（1メッセージ）の上限。超えたらその接続だけを切る
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

/// 接続してから `hello` を送るまでの期限
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(2);

/// OS の乱数
pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).expect("OS の乱数が使えません");
    buf
}

/// 乱数を16進の文字列にする（合言葉・共有ID）
pub fn random_hex(bytes: usize) -> String {
    random_bytes(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 時間が一定の比較（合言葉の照合で、どこまで一致したかを時間から推測されないように）
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn random_hex_is_long_and_different() {
        let a = random_hex(32);
        let b = random_hex(32);
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn identifier_comes_from_distribution_toml() {
        assert!(IDENTIFIER.contains('.'));
    }
}
