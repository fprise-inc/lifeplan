//! 止めた一覧（0110 の追記）: 提供元が止めたコードの番号の一覧。コードの鍵とは別の鍵（止めた一覧の鍵）で Ed25519 の署名を付ける。
//!
//! - 提供元が配信元に置き、アプリが取りに行く（送るのは一覧の取得の依頼だけ。取りに行く仕組みはアプリ本体）。
//! - 一覧に載っているコードの機能は止める（データは消さない）。一覧から外れたら、次に確かめたときに戻る（コードの入れ直しは要らない）。
//! - つながらない・一覧を取れないときは、最後に取れた一覧で判断する（[`apply_fetch`]）。署名が合わない一覧・形の違う一覧は無視する。
//! - 通し番号（`serial`）は増える一方。最後に取れた一覧より小さい番号の一覧は受け付けない（古い一覧を見せ続けて、止めたのを隠すのを防ぐ）。
//!
//! 形（配信元に置くファイル）:
//!
//! ```json
//! {
//!   "format": "lifeplan-feature-code-revocations",
//!   "kid": "dev-rv1",
//!   "payload": "{\"v\":1,\"serial\":3,\"issued\":\"2026-11-01\",\"revoked\":[\"0002\",\"0007\"]}",
//!   "sig": "<base64url>"
//! }
//! ```
//!
//! 署名するのは「決まった前置き `lifeplan-feature-code-revocations/1` と NUL ＋ `payload` の UTF-8 のバイト列」（コードの署名と取り違えない）。

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, Verifier};
use serde::{Deserialize, Serialize};

use crate::{parse_date, signed_bytes, valid_id, PublicKey, SecretKey};

/// 封の形の名前
pub const FORMAT: &str = "lifeplan-feature-code-revocations";
/// 署名する前置き
const CONTEXT: &[u8] = b"lifeplan-feature-code-revocations/1\0";
/// 中身の形の版
pub const LIST_VERSION: u32 = 1;
/// 一覧のファイルの大きさの上限（バイト）
pub const MAX_LIST_BYTES: usize = 256 * 1024;
/// 一覧に載せられる番号の数の上限
pub const MAX_REVOKED: usize = 5000;

/// 一覧を受け付けなかった理由の符号（画面・記録に出す。中身は入れない）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RevError(&'static str);

impl RevError {
    /// 形が違う（JSON でない・欄が足りない・大きすぎる・番号の形が違う）
    pub const FORMAT: RevError = RevError("E_REVOCATIONS_FORMAT");
    /// この版のアプリが持っていない鍵で署名されている
    pub const KEY: RevError = RevError("E_REVOCATIONS_KEY");
    /// 署名が合わない
    pub const SIGNATURE: RevError = RevError("E_REVOCATIONS_SIGNATURE");
    /// 最後に取れた一覧より古い（通し番号が小さい）
    pub const OLDER: RevError = RevError("E_REVOCATIONS_OLDER");

    pub fn code(&self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for RevError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for RevError {}

/// 一覧の中身（署名の対象）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct List {
    /// 中身の形の版（1）
    pub v: u32,
    /// 通し番号（署名するたびに1つ増やす）
    pub serial: u64,
    /// 作った日（YYYY-MM-DD）
    pub issued: String,
    /// 止めたコードの番号（コードの `id`。名前の順・重なりなし）
    pub revoked: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    format: String,
    kid: String,
    payload: String,
    sig: String,
}

fn list_problem(l: &List) -> Option<String> {
    if l.v != LIST_VERSION {
        return Some("一覧の形の版が違います".into());
    }
    if parse_date(&l.issued).is_none() {
        return Some("作った日は YYYY-MM-DD の形の、ある日付にしてください".into());
    }
    if l.revoked.len() > MAX_REVOKED {
        return Some(format!("一覧に載せられるのは {MAX_REVOKED} 件までです"));
    }
    for (i, id) in l.revoked.iter().enumerate() {
        if !valid_id(id) {
            return Some(format!("番号「{id}」の形が違います"));
        }
        if l.revoked[..i].contains(id) {
            return Some(format!("番号「{id}」が重なっています"));
        }
    }
    None
}

/// 一覧に署名して、配信元に置く形（JSON の文字列）を作る（発行の道具だけが使う）。番号は名前の順に並べ直す
pub fn sign(key: &SecretKey, list: &List) -> Result<String, String> {
    let mut list = list.clone();
    list.revoked.sort();
    if let Some(p) = list_problem(&list) {
        return Err(p);
    }
    let payload = serde_json::to_string(&list).map_err(|_| "一覧を作れませんでした".to_owned())?;
    let sig: Signature = key.signing.sign(&signed_bytes(CONTEXT, payload.as_bytes()));
    let env = Envelope {
        format: FORMAT.to_owned(),
        kid: key.kid.clone(),
        payload,
        sig: B64.encode(sig.to_bytes()),
    };
    let mut text =
        serde_json::to_string_pretty(&env).map_err(|_| "一覧を作れませんでした".to_owned())?;
    text.push('\n');
    if text.len() > MAX_LIST_BYTES {
        return Err("一覧が大きすぎます".into());
    }
    Ok(text)
}

/// 署名と形を確かめて中身を返す。`keys` は止めた一覧の鍵だけを渡す（コードの鍵は渡さない）
pub fn verify(text: &[u8], keys: &[PublicKey]) -> Result<List, RevError> {
    if text.len() > MAX_LIST_BYTES {
        return Err(RevError::FORMAT);
    }
    let env: Envelope = serde_json::from_slice(text).map_err(|_| RevError::FORMAT)?;
    if env.format != FORMAT {
        return Err(RevError::FORMAT);
    }
    let key = keys
        .iter()
        .find(|k| k.kid == env.kid)
        .ok_or(RevError::KEY)?;
    let sig: [u8; 64] = B64
        .decode(env.sig.as_bytes())
        .map_err(|_| RevError::FORMAT)?
        .try_into()
        .map_err(|_| RevError::FORMAT)?;
    key.key
        .verify(
            &signed_bytes(CONTEXT, env.payload.as_bytes()),
            &Signature::from_bytes(&sig),
        )
        .map_err(|_| RevError::SIGNATURE)?;
    let list: List = serde_json::from_str(&env.payload).map_err(|_| RevError::FORMAT)?;
    if list_problem(&list).is_some() {
        return Err(RevError::FORMAT);
    }
    Ok(list)
}

/// 取りに行った結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// 取れて、確かめられた（新しい一覧を使う）
    Ok,
    /// つながらない・取れない（最後に取れた一覧のまま）
    Offline,
    /// 取れたが、受け付けなかった（署名が合わない・形が違う・古い。最後に取れた一覧のまま）
    Rejected(RevError),
}

/// 取りに行った結果を当てる。`saved` は最後に取れた一覧（そのまま保存しておいた文）、`fetched` は今回取れた中身（取れなければ None）。
/// 返すのは、これから使う一覧の文（保存し直す）と結果。受け付けないときは、最後に取れた一覧をそのまま返す
pub fn apply_fetch(
    saved: Option<&[u8]>,
    fetched: Option<&[u8]>,
    keys: &[PublicKey],
) -> (Option<Vec<u8>>, Outcome) {
    // 保存しておいた一覧も確かめ直す（鍵を差し替えた後の古い一覧などは使わない）
    let current = saved.and_then(|s| verify(s, keys).ok().map(|l| (s.to_vec(), l)));
    let keep = |o: Outcome| (current.as_ref().map(|(s, _)| s.clone()), o);
    let Some(bytes) = fetched else {
        return keep(Outcome::Offline);
    };
    match verify(bytes, keys) {
        Ok(new) => match &current {
            Some((_, cur)) if new.serial < cur.serial => keep(Outcome::Rejected(RevError::OLDER)),
            _ => (Some(bytes.to_vec()), Outcome::Ok),
        },
        Err(e) => keep(Outcome::Rejected(e)),
    }
}

/// 保存しておいた一覧の、止めたコードの番号（確かめられなければ空。止めない）
pub fn revoked_ids(saved: Option<&[u8]>, keys: &[PublicKey]) -> Vec<String> {
    saved
        .and_then(|s| verify(s, keys).ok())
        .map(|l| l.revoked)
        .unwrap_or_default()
}

/// 保存しておいた一覧の中身（確かめられなければ None）
pub fn saved_list(saved: Option<&[u8]>, keys: &[PublicKey]) -> Option<List> {
    saved.and_then(|s| verify(s, keys).ok())
}
