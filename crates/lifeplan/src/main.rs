//! `lifeplan` … ファイナンシアに同梱する小さな実行ファイル（0015 の1）。
//!
//! - `lifeplan mcp` … AI接続口（MCP サーバー）として標準入出力で動く。ネットワークの口は開けない
//! - `lifeplan --version` … 版を出す
//! - `lifeplan module test` などのコマンド（0019）は後の回で足す
//!
//! 標準出力は MCP 専用。ログは標準エラー出力だけに出す。

mod answer;
mod calc;
mod chart;
mod compare;
mod coverage;
mod engine;
mod guide;
mod plan;
mod recipes;
mod regulation;
mod samples;
mod server;

use rmcp::ServiceExt;
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!("使い方: lifeplan mcp        AI接続口（MCP サーバー。標準入出力）として動く");
    eprintln!("        lifeplan --version  版を出す");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["mcp"] => run_mcp(),
        ["--version"] | ["-V"] => {
            println!("lifeplan {}", server::VERSION);
            ExitCode::SUCCESS
        }
        _ => usage(),
    }
}

fn run_mcp() -> ExitCode {
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("起動できませんでした: {e}");
            return ExitCode::from(1);
        }
    };
    let result: Result<(), Box<dyn std::error::Error>> = rt.block_on(async {
        let service = server::LifeplanMcp::new()
            .serve(rmcp::transport::stdio())
            .await?;
        service.waiting().await?;
        Ok(())
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("AI接続口が止まりました: {e}");
            ExitCode::from(1)
        }
    }
}
