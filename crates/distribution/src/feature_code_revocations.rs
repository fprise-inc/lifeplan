//! 機能を有効にするコードを止めるだけの小さな一覧（0110・0117 の追記 2026-11-04 の2）。
//!
//! 返金などでコードを止めるたびに、オフラインの取り下げ用の鍵を出さずに済むよう、コードを止めるだけの手軽な鍵
//! （鍵の束の役割 `feature_code_revocation`。CI の秘密の値などオンラインに置ける）で署名する、取り下げの一覧とは別の一覧。
//!
//! - 封筒は [`crate::envelope`] の形（形の名前は `fprise-lifeplan-feature-code-revocations-envelope`）。確かめるのは
//!   `feature_code_revocation` の鍵だけ。取り下げ用の鍵・ほかの役割の鍵で署名したものは受け付けない（逆に、この鍵では
//!   取り下げの一覧・パック・お知らせ・アプリの目録に署名できない。それぞれの部品が役割で断る）。
//! - 中身に書けるのは、止めるコードの番号（`featureCodes`）だけ。鍵・アプリの版・データパックの取り下げや、鍵の取り外しは書けない
//!   （知らない欄は無視するので、書いても効かない）。**この鍵が漏れても、できるのはコードを止める・この一覧で止めたのを戻すことだけ。**
//! - 一覧は「今止めている番号の全部」で、番号を外せば戻る（返金の取り消し・番号の書き間違いを、この鍵だけで直せる）。
//!   取り下げの一覧（取り下げ用の鍵）の `revoked.featureCodes` に載せた番号は、この一覧から外しても戻らない（[`stopped_ids`] は和を取る）。
//! - この役割の鍵は、取り下げの一覧の `revoked.keys` で外せる（漏れたとき）。外した鍵で署名したこの一覧は確かめられなくなり、
//!   載っていた番号は止まらなくなるので、外すときは同じ取り下げの一覧の `revoked.featureCodes` に番号を写す（手順は `docs/feature-codes-operations.md`）。
//! - 通し番号・有効期限・期限切れでも当て続けること・知らない欄を無視することは、取り下げの一覧（[`crate::revocations`]）と同じ。
//!   通し番号は取り下げの一覧とは別に数える。

use serde::{Deserialize, Serialize};

use crate::envelope;
use crate::keys::{KeyRing, Role};
use crate::revocations::{self, valid_feature_code_id, Fetch};
use crate::{format_major, parse_utc, Reject};

/// 封筒の形の名前
pub const ENVELOPE_FORMAT: &str = "fprise-lifeplan-feature-code-revocations-envelope";
/// 中身の形の名前
pub const FORMAT: &str = "fprise-lifeplan-feature-code-revocations";
/// 番号の数の上限
const MAX_ITEMS: usize = 10_000;

/// 止めるコードの一覧（中身）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureCodeRevocationList {
    pub format: String,
    pub format_version: String,
    pub serial: u64,
    pub issued_at: String,
    pub expires_at: String,
    /// 止める、機能を有効にするコードの番号（コードの `id`。名前の順・重なりなし）
    #[serde(default)]
    pub feature_codes: Vec<String>,
}

/// 確かめた一覧
#[derive(Debug, Clone)]
pub struct Verified {
    pub list: FeatureCodeRevocationList,
    /// 確かめられた鍵の名前
    pub kid: Option<String>,
    expires: i64,
}

impl Verified {
    /// 有効期限を過ぎたか（過ぎても載っている番号は止め続ける）
    pub fn expired(&self, now: i64) -> bool {
        now >= self.expires
    }
}

/// 一覧を確かめる（`ring` は取り下げの一覧で取り下げた鍵を外した後の束を渡す）。期限切れの一覧も受け付ける
pub fn verify(bytes: &[u8], ring: &KeyRing, last_serial: Option<u64>) -> Result<Verified, Reject> {
    let opened = envelope::open(bytes, ENVELOPE_FORMAT, &[Role::FeatureCodeRevocation], ring)?;
    let mut v = parse_payload(&opened.payload)?;
    if last_serial.is_some_and(|s| v.list.serial < s) {
        return Err(Reject::OLDER);
    }
    v.kid = Some(opened.kid);
    Ok(v)
}

/// 中身（署名の前の JSON）の形を確かめる（発行の道具が、署名する前の下書きを確かめるのにも使う）
pub fn parse_payload(payload: &str) -> Result<Verified, Reject> {
    let raw: serde_json::Value = serde_json::from_str(payload).map_err(|_| Reject::FORMAT)?;
    if raw.get("format").and_then(|v| v.as_str()) != Some(FORMAT) {
        return Err(Reject::FORMAT);
    }
    let fv = raw
        .get("formatVersion")
        .and_then(|v| v.as_str())
        .ok_or(Reject::FORMAT)?;
    if format_major(fv) != Some(1) {
        return Err(Reject::UNSUPPORTED);
    }
    let list: FeatureCodeRevocationList =
        serde_json::from_value(raw).map_err(|_| Reject::FORMAT)?;
    let ids = &list.feature_codes;
    if ids.len() > MAX_ITEMS
        || ids.iter().any(|id| !valid_feature_code_id(id))
        || ids.iter().enumerate().any(|(i, id)| ids[..i].contains(id))
    {
        return Err(Reject::FORMAT);
    }
    let issued = parse_utc(&list.issued_at).ok_or(Reject::FORMAT)?;
    let expires = parse_utc(&list.expires_at).ok_or(Reject::FORMAT)?;
    if expires <= issued {
        return Err(Reject::FORMAT);
    }
    Ok(Verified {
        list,
        kid: None,
        expires,
    })
}

/// 取りに行った結果を当てる（[`revocations::apply_fetch`] と同じ決まり。取れない・受け付けない・古い一覧は無視して、
/// 最後に受け付けた一覧のまま。保存しておいた一覧も確かめ直す）
pub fn apply_fetch(
    saved: Option<&[u8]>,
    fetched: Option<&[u8]>,
    ring: &KeyRing,
) -> (Option<Vec<u8>>, Fetch) {
    revocations::apply_fetch_with(saved, fetched, |b, last| {
        verify(b, ring, last).map(|v| v.list.serial)
    })
}

/// 保存しておいた一覧を確かめ直して返す（確かめられなければ None。何も止めない）
pub fn saved_list(saved: Option<&[u8]>, ring: &KeyRing) -> Option<Verified> {
    saved.and_then(|s| verify(s, ring, None).ok())
}

/// 止めるコードの番号: 取り下げの一覧（取り下げ用の鍵）の `revoked.featureCodes` と、この一覧の `featureCodes` の和（名前の順・重なりなし）
pub fn stopped_ids(main: Option<&revocations::Verified>, small: Option<&Verified>) -> Vec<String> {
    let mut ids: Vec<String> = main
        .map(|v| v.list.revoked.feature_codes.clone())
        .unwrap_or_default();
    if let Some(s) = small {
        ids.extend(s.list.feature_codes.iter().cloned());
    }
    ids.sort();
    ids.dedup();
    ids
}

/// 空の下書き（発行の道具の `feature-code revocations new`。通し番号 0。署名するときに 1 になる）
pub fn empty_draft(now: i64) -> FeatureCodeRevocationList {
    FeatureCodeRevocationList {
        format: FORMAT.to_owned(),
        format_version: "1.0".to_owned(),
        serial: 0,
        issued_at: crate::format_utc(now),
        expires_at: crate::format_utc(now + revocations::DEFAULT_VALID_DAYS * 86_400),
        feature_codes: vec![],
    }
}

/// 署名する一覧（発行の道具だけが使う）: 通し番号を1つ上げ、作った時刻を今・有効期限を `days` 日後にし、番号を名前の順に並べて形を確かめる
pub fn next_issue(
    draft: &FeatureCodeRevocationList,
    now: i64,
    days: i64,
) -> Result<FeatureCodeRevocationList, Reject> {
    if !(1..=366).contains(&days) {
        return Err(Reject::FORMAT);
    }
    let mut list = draft.clone();
    list.serial = draft.serial.checked_add(1).ok_or(Reject::FORMAT)?;
    list.issued_at = crate::format_utc(now);
    list.expires_at = crate::format_utc(now + days * 86_400);
    list.feature_codes.sort();
    let payload = serde_json::to_string(&list).map_err(|_| Reject::FORMAT)?;
    parse_payload(&payload)?;
    Ok(list)
}
