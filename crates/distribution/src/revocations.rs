//! 取り下げの一覧とアプリの最低版（0017 の7）。
//!
//! 取り下げ用の鍵で署名した封筒（[`crate::envelope`]。形の名前は `fprise-lifeplan-revocations-envelope`）に、0017 の7 の形の一覧を入れる。
//!
//! - `serial`（通し番号）は増える一方。最後に受け付けた番号より小さい一覧は受け付けない。
//! - `expiresAt` を過ぎた一覧は、最新とはみなさない（[`Freshness::Stale`]。黄色い帯）。ただし、載っている取り下げは当て続ける
//!   （取り下げは安全な側に倒すものなので、期限切れでも外さない）。
//! - `minAppVersion` より古いアプリは、閲覧はできるが、計算と PDF の出力は更新してから（[`AppGate`]）。
//! - `revoked.keys` に載った鍵は、鍵の束から外す（[`crate::keys::KeyRing::without`]。取り下げ用の鍵は外せない）。

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
/// 一覧の項目の数の上限
const MAX_ITEMS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegulationValueRef {
    pub id: String,
    pub pack_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentRevisionRef {
    pub id: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
}

/// 取り下げの一覧（0017 の7 の形）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    let raw: serde_json::Value =
        serde_json::from_str(&opened.payload).map_err(|_| Reject::FORMAT)?;
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
        + r.keys.len();
    if count > MAX_ITEMS {
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
    if last_serial.is_some_and(|s| list.serial < s) {
        return Err(Reject::OLDER);
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
