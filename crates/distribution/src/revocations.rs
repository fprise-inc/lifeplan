//! 取り下げの一覧とアプリの最低版（0017 の7）。
//!
//! 取り下げ用の鍵で署名した封筒（[`crate::envelope`]。形の名前は `fprise-lifeplan-revocations-envelope`）に、0017 の7 の形の一覧を入れる。
//!
//! - `serial`（通し番号）は増える一方。最後に受け付けた番号より小さい一覧は受け付けない。
//! - `expiresAt` を過ぎた一覧は、最新とはみなさない（[`Freshness::Stale`]。黄色い帯）。ただし、載っている取り下げは当て続ける
//!   （取り下げは安全な側に倒すものなので、期限切れでも外さない）。
//! - `minAppVersion` より古いアプリは、閲覧はできるが、計算と PDF の出力は更新してから（[`AppGate`]）。
//! - `revoked.keys` に載った鍵は、鍵の束から外す（[`crate::keys::KeyRing::without`]。取り下げ用の鍵は外せない）。
//! - `revoked.featureCodes` に載った番号の、機能を有効にするコード（0110）は止める（漏れたコード・返金した人のコード。0110 の追記 2026-11-04）。
//!   番号はコードの `id`（英数字で始め、英数字と「-」「_」「.」の32文字まで。`feature_code::valid_id` と同じ決まり）。
//!   機能を有効にするコードは、コードを止めるだけの鍵で署名した別の小さな一覧（[`crate::feature_code_revocations`]）でも止める。
//!   こちらの一覧（取り下げ用の鍵）に載せた番号は、小さな一覧の鍵では戻せない（0117 の追記 2026-11-04 の2）。
//! - 取りに行った結果は [`apply_fetch`] で当てる（つながらない・受け付けない一覧は無視して、最後に受け付けた一覧のまま）。
//! - **知らない欄は無視する**（0117 の追記 2026-11-04 の2）。β の後に取り下げの種類を足しても、前の版のアプリは知っている取り下げを
//!   当て続ける（一覧ごと受け付けないと、新しい一覧の取り下げが1つも効かなくなる）。前の版のアプリが知らないと危ない取り下げを足すときは、
//!   同じ一覧の `minAppVersion` で前の版の計算と出力を止める。読み方を変える（前の版が誤って読む）ときは形式の版の MAJOR を上げ、
//!   置き場所を `/v2/` に分ける（`/v1/` には最後の 1.x の一覧を出し続ける）。

use serde::{Deserialize, Serialize};

use crate::envelope;
use crate::keys::{KeyRing, Role};
use crate::{format_major, parse_utc, Reject, Version};

/// 封筒の形の名前
pub const ENVELOPE_FORMAT: &str = "fprise-lifeplan-revocations-envelope";
/// 中身の形の名前（0017 の7）
pub const FORMAT: &str = "fprise-lifeplan-revocations";
/// 有効な一覧を取れていない日数が、これを超えたら黄色い帯（0017 の7。初期値。0117 の未確定）
pub const STALE_AFTER_DAYS: i64 = 30;
/// 発行の道具が付ける有効期限の日数の初期値（0117 の影響「取り下げの一覧は、期限〔初期値90日〕の前に出し直す」）
pub const DEFAULT_VALID_DAYS: i64 = 90;
/// 一覧の項目の数の上限
const MAX_ITEMS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegulationValueRef {
    pub id: String,
    pub pack_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRevisionRef {
    pub id: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revoked {
    #[serde(default)]
    pub regulation_values: Vec<RegulationValueRef>,
    #[serde(default)]
    pub component_revisions: Vec<ComponentRevisionRef>,
    #[serde(default)]
    pub packs: Vec<PackRef>,
    #[serde(default)]
    pub app_versions: Vec<String>,
    #[serde(default)]
    pub keys: Vec<String>,
    /// 止める、機能を有効にするコードの番号（コードの `id`。0110）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub feature_codes: Vec<String>,
}

/// 機能を有効にするコードの番号の形（`feature_code::valid_id` と同じ決まり。部品どうしの依存を作らないため、ここにも書く）
pub fn valid_feature_code_id(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=32).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

/// 取り下げの一覧（0017 の7 の形）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevocationList {
    pub format: String,
    pub format_version: String,
    pub serial: u64,
    pub issued_at: String,
    pub expires_at: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    pub revoked: Revoked,
    #[serde(default)]
    pub notice: Option<String>,
}

/// 確かめた一覧
#[derive(Debug, Clone)]
pub struct Verified {
    pub list: RevocationList,
    pub min_app_version: Option<Version>,
    expires: i64,
}

impl Verified {
    /// 有効期限を過ぎたか
    pub fn expired(&self, now: i64) -> bool {
        now >= self.expires
    }
}

/// 一覧を確かめる。期限切れの一覧も受け付ける（取り下げは当て続ける。新しさは [`freshness`] で見る）
pub fn verify(bytes: &[u8], ring: &KeyRing, last_serial: Option<u64>) -> Result<Verified, Reject> {
    let opened = envelope::open(bytes, ENVELOPE_FORMAT, &[Role::Revocation], ring)?;
    let v = parse_payload(&opened.payload)?;
    if last_serial.is_some_and(|s| v.list.serial < s) {
        return Err(Reject::OLDER);
    }
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
    let list: RevocationList = serde_json::from_value(raw).map_err(|_| Reject::FORMAT)?;
    let r = &list.revoked;
    let count = r.regulation_values.len()
        + r.component_revisions.len()
        + r.packs.len()
        + r.app_versions.len()
        + r.keys.len()
        + r.feature_codes.len();
    if count > MAX_ITEMS {
        return Err(Reject::FORMAT);
    }
    if r.feature_codes.iter().any(|id| !valid_feature_code_id(id))
        || r.feature_codes
            .iter()
            .enumerate()
            .any(|(i, id)| r.feature_codes[..i].contains(id))
    {
        return Err(Reject::FORMAT);
    }
    if r.app_versions.iter().any(|v| Version::app(v).is_none())
        || r.packs
            .iter()
            .any(|p| Version::parse(&p.version, 3).is_none())
        || r.regulation_values
            .iter()
            .any(|v| Version::parse(&v.pack_version, 3).is_none())
    {
        return Err(Reject::FORMAT);
    }
    let min_app_version = match &list.min_app_version {
        Some(s) => Some(Version::app(s).ok_or(Reject::FORMAT)?),
        None => None,
    };
    let issued = parse_utc(&list.issued_at).ok_or(Reject::FORMAT)?;
    let expires = parse_utc(&list.expires_at).ok_or(Reject::FORMAT)?;
    if expires <= issued {
        return Err(Reject::FORMAT);
    }
    Ok(Verified {
        list,
        min_app_version,
        expires,
    })
}

/// アプリの版について
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppGate {
    /// 使える
    Ok,
    /// 最低版より古い（閲覧はできる。計算と PDF の出力は更新してから）
    BelowMinimum,
    /// この版が取り下げられた（最低版と同じ扱い）
    Revoked,
}

pub fn app_gate(current: &Version, v: &Verified) -> AppGate {
    if v.list
        .revoked
        .app_versions
        .iter()
        .any(|s| Version::app(s).as_ref() == Some(current))
    {
        return AppGate::Revoked;
    }
    if v.min_app_version.as_ref().is_some_and(|m| current < m) {
        return AppGate::BelowMinimum;
    }
    AppGate::Ok
}

/// 取り下げの確認ができているか
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Fresh,
    /// 黄色い帯「取り下げの確認ができていません」（計算と出力は止めない）
    Stale,
}

/// `last_success` は最後に有効な一覧を取れた時刻（1970年からの秒。一度も取れていなければ None）。
/// `install_time` はインストールした時刻（同梱の一覧しか無い間の起点）
pub fn freshness(
    v: Option<&Verified>,
    last_success: Option<i64>,
    install_time: i64,
    now: i64,
) -> Freshness {
    let since = last_success.unwrap_or(install_time);
    if now - since > STALE_AFTER_DAYS * 86_400 || v.is_none_or(|v| v.expired(now)) {
        Freshness::Stale
    } else {
        Freshness::Fresh
    }
}

/// 鍵の束から、一覧で取り下げた鍵を外す
pub fn apply_to_ring(ring: &KeyRing, v: &Verified) -> KeyRing {
    ring.without(&v.list.revoked.keys)
}

/// 取りに行った結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fetch {
    /// 取れて、受け付けた（新しい一覧を使う）
    Ok,
    /// つながらない・取れない（最後に受け付けた一覧のまま）
    Offline,
    /// 取れたが、受け付けなかった（署名が合わない・形が違う・通し番号が古い。最後に受け付けた一覧のまま）
    Rejected(Reject),
}

/// 取りに行った結果を当てる。`saved` は最後に受け付けた一覧（配信元のファイルのまま保存しておいたもの）、`fetched` は今回取れた中身
/// （取れなければ None）。返すのは、これから使う一覧のファイル（保存し直す）と結果。
/// 保存しておいた一覧も確かめ直し（鍵を差し替えた後などで確かめられなければ使わない）、受け付けないときは、それをそのまま返す
pub fn apply_fetch(
    saved: Option<&[u8]>,
    fetched: Option<&[u8]>,
    ring: &KeyRing,
) -> (Option<Vec<u8>>, Fetch) {
    apply_fetch_with(saved, fetched, |b, last| {
        verify(b, ring, last).map(|v| v.list.serial)
    })
}

/// [`apply_fetch`] の中身（取り下げの一覧と、コードを止めるだけの一覧で同じ決まりを使う）。
/// `verify` は（中身・最後に受け付けた通し番号）を受けて、受け付けた一覧の通し番号を返す
pub(crate) fn apply_fetch_with(
    saved: Option<&[u8]>,
    fetched: Option<&[u8]>,
    verify: impl Fn(&[u8], Option<u64>) -> Result<u64, Reject>,
) -> (Option<Vec<u8>>, Fetch) {
    let current = saved.and_then(|s| verify(s, None).ok().map(|serial| (s.to_vec(), serial)));
    let last_serial = current.as_ref().map(|(_, serial)| *serial);
    let keep = |f: Fetch| (current.as_ref().map(|(s, _)| s.clone()), f);
    let Some(bytes) = fetched else {
        return keep(Fetch::Offline);
    };
    match verify(bytes, last_serial) {
        Ok(_) => (Some(bytes.to_vec()), Fetch::Ok),
        Err(e) => keep(Fetch::Rejected(e)),
    }
}

/// 保存しておいた一覧を確かめ直して返す（確かめられなければ None。何も取り下げない）
pub fn saved_list(saved: Option<&[u8]>, ring: &KeyRing) -> Option<Verified> {
    saved.and_then(|s| verify(s, ring, None).ok())
}

/// 空の下書き（発行の道具の `revocations new`。通し番号 0。署名するときに 1 になる）
pub fn empty_draft(now: i64) -> RevocationList {
    RevocationList {
        format: FORMAT.to_owned(),
        format_version: "1.0".to_owned(),
        serial: 0,
        issued_at: crate::format_utc(now),
        expires_at: crate::format_utc(now + DEFAULT_VALID_DAYS * 86_400),
        min_app_version: None,
        revoked: Revoked::default(),
        notice: None,
    }
}

/// 署名する一覧（発行の道具だけが使う）: 下書きの通し番号を1つ上げ、作った時刻を今、有効期限を `days` 日後にして、形を確かめる。
/// 機能を有効にするコードの番号は名前の順に並べ直す
pub fn next_issue(draft: &RevocationList, now: i64, days: i64) -> Result<RevocationList, Reject> {
    if !(1..=366).contains(&days) {
        return Err(Reject::FORMAT);
    }
    let mut list = draft.clone();
    list.serial = draft.serial.checked_add(1).ok_or(Reject::FORMAT)?;
    list.issued_at = crate::format_utc(now);
    list.expires_at = crate::format_utc(now + days * 86_400);
    list.revoked.feature_codes.sort();
    let payload = serde_json::to_string(&list).map_err(|_| Reject::FORMAT)?;
    parse_payload(&payload)?;
    Ok(list)
}
