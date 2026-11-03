//! アプリ更新用の鍵（Tauri の updater の minisign の形。0017 の5）。
//!
//! - 公開鍵は Tauri が出す文字列（`.pub` のファイルの中身を base64 にしたもの）のまま、配布元の設定の `[keys] app_update` に並べる。
//!   中身は「アルゴリズムの印 `Ed`（2バイト）＋鍵の番号（8バイト）＋ Ed25519 の公開鍵（32バイト）」。
//!   鍵の名前（[`MinisignPublicKey::kid`]）は、鍵の番号を minisign と同じ書き方（16桁の大文字の16進）にしたもの。
//! - 署名は Tauri が出す文字列（`.sig` のファイルの中身を base64 にしたもの）。4行で、2行目が
//!   「印（`ED` は BLAKE2b-512 で要約してから署名、`Ed` はそのまま署名）＋鍵の番号＋署名（64バイト）」、
//!   4行目が「署名＋信用できる注記（3行目）」への署名（全体の署名）。
//! - アプリ本体の更新のファイル（Tauri の updater が確かめる）と、アプリ本体の更新の目録（[`crate::app_catalog`]。この部品が確かめる）は、
//!   同じ道具（`tauri signer sign`）・同じ鍵で署名する。どの鍵で署名したかは署名の中の鍵の番号で分かるので、
//!   アプリは現用と次期のどちらかを選んで Tauri の updater に渡せる（実行中に鍵を入れ替えられる）。

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use blake2::{Blake2b512, Digest};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// 公開鍵の印
const PK_ALG: &[u8; 2] = b"Ed";
/// 要約してから署名した印
const SIG_ALG_PREHASHED: &[u8; 2] = b"ED";
/// そのまま署名した印
const SIG_ALG_LEGACY: &[u8; 2] = b"Ed";
/// 署名の文字列の長さの上限
const MAX_SIG_TEXT: usize = 4096;

/// minisign の公開鍵
#[derive(Clone)]
pub struct MinisignPublicKey {
    keynum: [u8; 8],
    key: VerifyingKey,
    tauri: String,
}

impl std::fmt::Debug for MinisignPublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MinisignPublicKey")
            .field("kid", &self.kid())
            .finish()
    }
}

impl MinisignPublicKey {
    /// Tauri の公開鍵の文字列（`.pub` の中身の base64）から
    pub fn from_tauri(s: &str) -> Option<MinisignPublicKey> {
        let text = B64.decode(s.trim()).ok()?;
        let text = String::from_utf8(text).ok()?;
        let mut lines = text.lines();
        let first = lines.next()?;
        if !first.starts_with("untrusted comment:") {
            return None;
        }
        let raw = B64.decode(lines.next()?.trim()).ok()?;
        if raw.len() != 42 || &raw[0..2] != PK_ALG {
            return None;
        }
        let keynum: [u8; 8] = raw[2..10].try_into().ok()?;
        let pk: [u8; 32] = raw[10..42].try_into().ok()?;
        Some(MinisignPublicKey {
            keynum,
            key: VerifyingKey::from_bytes(&pk).ok()?,
            tauri: s.trim().to_owned(),
        })
    }

    /// 鍵の名前（鍵の番号を16桁の大文字の16進で。minisign と同じ書き方）
    pub fn kid(&self) -> String {
        keynum_kid(&self.keynum)
    }

    /// Tauri の updater に渡す文字列（`updater_builder().pubkey(..)`）
    pub fn tauri_pubkey(&self) -> &str {
        &self.tauri
    }

    /// 中の Ed25519 の公開鍵のバイト列（役割をまたいで同じ鍵を使っていないかを確かめる）
    pub(crate) fn key_bytes(&self) -> [u8; 32] {
        self.key.to_bytes()
    }
}

/// minisign の署名
#[derive(Debug, Clone)]
pub struct MinisignSignature {
    prehashed: bool,
    keynum: [u8; 8],
    sig: [u8; 64],
    trusted_comment: String,
    global_sig: [u8; 64],
}

impl MinisignSignature {
    /// Tauri の署名の文字列（`.sig` の中身の base64）から
    pub fn from_tauri(s: &str) -> Option<MinisignSignature> {
        if s.len() > MAX_SIG_TEXT {
            return None;
        }
        let text = B64.decode(s.trim()).ok()?;
        let text = String::from_utf8(text).ok()?;
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() != 4 || !lines[0].starts_with("untrusted comment:") {
            return None;
        }
        let raw = B64.decode(lines[1].trim()).ok()?;
        if raw.len() != 74 {
            return None;
        }
        let prehashed = match &raw[0..2] {
            a if a == SIG_ALG_PREHASHED => true,
            a if a == SIG_ALG_LEGACY => false,
            _ => return None,
        };
        let trusted_comment = lines[2].strip_prefix("trusted comment: ")?.to_owned();
        let global_sig: [u8; 64] = B64.decode(lines[3].trim()).ok()?.try_into().ok()?;
        Some(MinisignSignature {
            prehashed,
            keynum: raw[2..10].try_into().ok()?,
            sig: raw[10..74].try_into().ok()?,
            trusted_comment,
            global_sig,
        })
    }

    /// 署名した鍵の名前（鍵の番号）
    pub fn kid(&self) -> String {
        keynum_kid(&self.keynum)
    }

    /// 信用できる注記（Tauri は時刻とファイル名を入れる）
    pub fn trusted_comment(&self) -> &str {
        &self.trusted_comment
    }

    /// `message` への署名として正しいか（鍵の番号が合い、本体の署名と全体の署名の両方が合う）
    pub fn verify(&self, key: &MinisignPublicKey, message: &[u8]) -> bool {
        if self.keynum != key.keynum {
            return false;
        }
        let ok = if self.prehashed {
            let digest = Blake2b512::digest(message);
            key.key
                .verify(&digest, &Signature::from_bytes(&self.sig))
                .is_ok()
        } else {
            key.key
                .verify(message, &Signature::from_bytes(&self.sig))
                .is_ok()
        };
        if !ok {
            return false;
        }
        let mut global = Vec::with_capacity(64 + self.trusted_comment.len());
        global.extend_from_slice(&self.sig);
        global.extend_from_slice(self.trusted_comment.as_bytes());
        key.key
            .verify(&global, &Signature::from_bytes(&self.global_sig))
            .is_ok()
    }
}

fn keynum_kid(keynum: &[u8; 8]) -> String {
    format!("{:016X}", u64::from_le_bytes(*keynum))
}

/// テストと発行の道具のための、minisign の形の署名を作る部品（アプリ本体は使わない）。
/// 本番の署名は `tauri signer sign` で作る。ここはテストの中で作る使い捨ての鍵で、目録の確かめ方を試すためにある
pub mod testing {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// 使い捨ての鍵から、Tauri の公開鍵の文字列を作る
    pub fn tauri_pubkey(sk: &SigningKey, keynum: [u8; 8]) -> String {
        let mut raw = Vec::with_capacity(42);
        raw.extend_from_slice(PK_ALG);
        raw.extend_from_slice(&keynum);
        raw.extend_from_slice(&sk.verifying_key().to_bytes());
        let text = format!(
            "untrusted comment: minisign public key: {}\n{}\n",
            keynum_kid(&keynum),
            B64.encode(raw)
        );
        B64.encode(text)
    }

    /// 使い捨ての鍵で、Tauri と同じ形（要約してから署名）の署名の文字列を作る
    pub fn tauri_sign(
        sk: &SigningKey,
        keynum: [u8; 8],
        message: &[u8],
        trusted_comment: &str,
    ) -> String {
        let digest = Blake2b512::digest(message);
        let sig = sk.sign(&digest).to_bytes();
        let mut raw = Vec::with_capacity(74);
        raw.extend_from_slice(SIG_ALG_PREHASHED);
        raw.extend_from_slice(&keynum);
        raw.extend_from_slice(&sig);
        let mut global = sig.to_vec();
        global.extend_from_slice(trusted_comment.as_bytes());
        let global_sig = sk.sign(&global).to_bytes();
        let text = format!(
            "untrusted comment: signature from tauri secret key\n{}\ntrusted comment: {}\n{}\n",
            B64.encode(raw),
            trusted_comment,
            B64.encode(global_sig)
        );
        B64.encode(text)
    }
}
