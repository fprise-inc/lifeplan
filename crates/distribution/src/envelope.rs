//! 署名した封筒（データ用・自動配信用・取り下げ用の鍵。0017 の5）。
//!
//! 形はお知らせの一覧（0087。`app/schemas/notices.json`）と同じ:
//!
//! ```json
//! {
//!   "format": "<中身の形の名前>-envelope",
//!   "formatVersion": "1.0",
//!   "payload": "<中身の JSON の文字列>",
//!   "signatures": [{ "keyId": "data-2027a", "alg": "ed25519", "sig": "<base64>" }]
//! }
//! ```
//!
//! - 署名するのは `payload` の UTF-8 のバイト列（お知らせの一覧と同じ）。同じ鍵で署名する別の種類の中身と取り違えないよう、
//!   開いた後に、呼ぶ側が中身の `format` を必ず確かめる（[`open`] は封筒の `format` を、各部品は中身の `format` を確かめる）。
//! - `signatures` のどれか1つが、求める役割の鍵（現用・次期）で確かめられれば受け付ける。ほかの役割の鍵は使わない。
//! - 署名なしは受け付けない（開発用のビルドの見本の扱いはアプリ本体が決める）。

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use serde::{Deserialize, Serialize};

use crate::keys::{KeyMaterial, KeyRing, Role};
use crate::{format_major, Reject, MAX_DOCUMENT_BYTES};

/// 1つの封筒に付けられる署名の数の上限
const MAX_SIGNATURES: usize = 4;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    format: String,
    format_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    payload: String,
    signatures: Vec<Sig>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sig {
    key_id: String,
    alg: String,
    sig: String,
}

/// 開いた封筒
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    /// 中身の JSON の文字列（署名を確かめたもの）
    pub payload: String,
    /// 確かめられた鍵の名前
    pub kid: String,
}

/// 封筒を確かめて開く。`format` は封筒の形の名前、`roles` は受け付ける鍵の役割
pub fn open(bytes: &[u8], format: &str, roles: &[Role], ring: &KeyRing) -> Result<Opened, Reject> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(Reject::FORMAT);
    }
    let env: Envelope = serde_json::from_slice(bytes).map_err(|_| Reject::FORMAT)?;
    if env.format != format {
        return Err(Reject::FORMAT);
    }
    if format_major(&env.format_version) != Some(1) {
        return Err(Reject::UNSUPPORTED);
    }
    if env.signatures.is_empty() || env.signatures.len() > MAX_SIGNATURES {
        return Err(Reject::KEY);
    }
    let mut known = false;
    for s in &env.signatures {
        if s.alg != "ed25519" {
            continue;
        }
        let Some(key) = roles.iter().find_map(|r| ring.get(*r, &s.key_id)) else {
            continue;
        };
        let KeyMaterial::Ed25519(vk) = &key.material else {
            continue;
        };
        known = true;
        let Ok(sig) = B64.decode(s.sig.as_bytes()) else {
            continue;
        };
        let Ok(sig) = <[u8; 64]>::try_from(sig) else {
            continue;
        };
        if vk
            .verify(env.payload.as_bytes(), &Signature::from_bytes(&sig))
            .is_ok()
        {
            return Ok(Opened {
                payload: env.payload,
                kid: key.kid.clone(),
            });
        }
    }
    Err(if known {
        Reject::SIGNATURE
    } else {
        Reject::KEY
    })
}

/// 封筒を作る（発行の道具とテストだけが使う。アプリ本体は使わない）。`signers` は（鍵の名前, 秘密鍵）
pub fn seal(payload: &str, format: &str, signers: &[(&str, &SigningKey)]) -> String {
    let env = Envelope {
        format: format.to_owned(),
        format_version: "1.0".to_owned(),
        comment: None,
        payload: payload.to_owned(),
        signatures: signers
            .iter()
            .map(|(kid, sk)| Sig {
                key_id: (*kid).to_owned(),
                alg: "ed25519".to_owned(),
                sig: B64.encode(sk.sign(payload.as_bytes()).to_bytes()),
            })
            .collect(),
    };
    let mut s = serde_json::to_string_pretty(&env).unwrap_or_default();
    s.push('\n');
    s
}
