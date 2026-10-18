//! 「1行に1つの JSON」の読み書き。上限（1 MiB）を超える行はエラーにする（その接続だけを切る）。

use serde::{de::DeserializeOwned, Serialize};
use std::io;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

pub struct LineReader<R> {
    inner: BufReader<R>,
    buf: Vec<u8>,
    max: usize,
}

impl<R: AsyncRead + Unpin> LineReader<R> {
    pub fn new(r: R) -> Self {
        Self::with_limit(r, crate::MAX_LINE_BYTES)
    }

    pub fn with_limit(r: R, max: usize) -> Self {
        Self {
            inner: BufReader::new(r),
            buf: Vec::with_capacity(4096),
            max,
        }
    }

    /// 1行読む。接続が閉じられたら Ok(None)
    pub async fn read_json<T: DeserializeOwned>(&mut self) -> io::Result<Option<T>> {
        self.buf.clear();
        loop {
            let available = self.inner.fill_buf().await?;
            if available.is_empty() {
                return if self.buf.is_empty() {
                    Ok(None)
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "行の途中で切れました",
                    ))
                };
            }
            let (consume, done) = match available.iter().position(|b| *b == b'\n') {
                Some(i) => {
                    self.buf.extend_from_slice(&available[..i]);
                    (i + 1, true)
                }
                None => {
                    self.buf.extend_from_slice(available);
                    (available.len(), false)
                }
            };
            self.inner.consume(consume);
            if self.buf.len() > self.max {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "1行が長すぎます",
                ));
            }
            if done {
                let v = serde_json::from_slice(&self.buf)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                return Ok(Some(v));
            }
        }
    }
}

pub async fn write_json<W: AsyncWrite + Unpin, T: Serialize>(w: &mut W, v: &T) -> io::Result<()> {
    let mut line = serde_json::to_vec(v).map_err(io::Error::other)?;
    line.push(b'\n');
    w.write_all(&line).await?;
    w.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_lines_and_rejects_long_ones() {
        let data = b"{\"a\":1}\n{\"a\":2}\n".to_vec();
        let mut r = LineReader::new(&data[..]);
        let a: serde_json::Value = r.read_json().await.unwrap().unwrap();
        assert_eq!(a["a"], 1);
        let b: serde_json::Value = r.read_json().await.unwrap().unwrap();
        assert_eq!(b["a"], 2);
        assert!(r.read_json::<serde_json::Value>().await.unwrap().is_none());

        let long = format!("\"{}\"\n", "x".repeat(100));
        let mut r = LineReader::with_limit(long.as_bytes(), 50);
        assert!(r.read_json::<serde_json::Value>().await.is_err());
    }
}
