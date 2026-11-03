//! アプリ本体の更新の目録（0017 の3・6、0117 の3）。
//!
//! Tauri の updater が読む `latest.json`（版・各 OS の URL・署名）には、段階・一時停止・有効期限・通し番号の欄が無い。
//! そこで、その前に読む小さな目録 `catalog.json` を置き、当てるかどうかと、どの鍵（現用・次期）で確かめるかをここで決める。
//!
//! ```json
//! {
//!   "format": "financia-app-catalog-envelope",
//!   "formatVersion": "1.0",
//!   "payload": "{\"format\":\"financia-app-catalog\",\"catalogVersion\":\"1.0\",\"serial\":7,…}",
//!   "signature": "<payload のバイト列への Tauri の署名（tauri signer sign の .sig の中身）>"
//! }
//! ```
//!
//! 中身（`payload`）の欄: `format`・`catalogVersion`（`MAJOR.MINOR`）・`serial`（増える一方）・`issuedAt`・`expiresAt`・
//! `version`（配る版）・`rollout`（段階）・`paused`（一時停止）・`noDefer`（遅らせられない更新。世帯ファイルの形式が変わるものなど）・
//! `critical`（アプリが理解しなければならない欄）・`notes`（任意の短い説明）。
//!
//! 目録はアプリ更新用の鍵（minisign の形）で署名する。確かめられた鍵を、そのまま Tauri の updater に渡す
//! （`updater_builder().pubkey(..)`）。配る版は `version_comparator` で目録の版だけに絞る。これで、
//! - 現用と次期のどちらで署名した更新も受け取れる（実行中に鍵を入れ替えられる）
//! - 目録と `latest.json` が食い違っても、目録の版以外は当てない
//! - 古い版への戻しはしない（巻き戻しは、前の中身を新しい版の番号で配る）

use serde::{Deserialize, Serialize};

use crate::keys::{KeyMaterial, KeyRing, Role};
use crate::minisig::{MinisignPublicKey, MinisignSignature};
use crate::rollout::{Cohort, Rollout, Wait};
use crate::{critical_known, format_major, parse_utc, Reject, Version, MAX_DOCUMENT_BYTES};

/// 封筒の形の名前
pub const ENVELOPE_FORMAT: &str = "financia-app-catalog-envelope";
/// 中身の形の名前
pub const FORMAT: &str = "financia-app-catalog";
/// この版のアプリが知っている欄（`critical` に書けるもの）
pub const KNOWN_FIELDS: &[&str] = &[
    "format",
    "catalogVersion",
    "serial",
    "issuedAt",
    "expiresAt",
    "version",
    "rollout",
    "paused",
    "noDefer",
    "critical",
    "notes",
];
/// 説明の長さの上限（文字）
const MAX_NOTES_CHARS: usize = 2000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    format: String,
    format_version: String,
    payload: String,
    signature: String,
}

/// 目録の中身。知らない欄は無視する（`critical` に載っていなければ。0022 の4）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalog {
    pub format: String,
    pub catalog_version: String,
    pub serial: u64,
    pub issued_at: String,
    pub expires_at: String,
    pub version: String,
    pub rollout: Rollout,
    pub paused: bool,
    pub no_defer: bool,
    pub critical: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// 確かめた目録と、確かめられた鍵
#[derive(Debug, Clone)]
pub struct Verified {
    pub catalog: AppCatalog,
    pub version: Version,
    signer: MinisignPublicKey,
}

impl Verified {
    /// 確かめられた鍵の名前
    pub fn signer_kid(&self) -> String {
        self.signer.kid()
    }
}

/// 目録を確かめる。`last_serial` は最後に受け付けた目録の通し番号、`now` は今の時刻（1970年からの秒）
pub fn verify(
    bytes: &[u8],
    ring: &KeyRing,
    last_serial: Option<u64>,
    now: i64,
) -> Result<Verified, Reject> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(Reject::FORMAT);
    }
    let env: Envelope = serde_json::from_slice(bytes).map_err(|_| Reject::FORMAT)?;
    if env.format != ENVELOPE_FORMAT {
        return Err(Reject::FORMAT);
    }
    if format_major(&env.format_version) != Some(1) {
        return Err(Reject::UNSUPPORTED);
    }
    let sig = MinisignSignature::from_tauri(&env.signature).ok_or(Reject::FORMAT)?;
    let key = ring
        .get(Role::AppUpdate, &sig.kid())
        .and_then(|k| match &k.material {
            KeyMaterial::Minisign(m) => Some(m.clone()),
            KeyMaterial::Ed25519(_) => None,
        })
        .ok_or(Reject::KEY)?;
    if !sig.verify(&key, env.payload.as_bytes()) {
        return Err(Reject::SIGNATURE);
    }
    // 中身の形は、署名を確かめた後に読む
    let raw: serde_json::Value = serde_json::from_str(&env.payload).map_err(|_| Reject::FORMAT)?;
    if raw.get("format").and_then(|v| v.as_str()) != Some(FORMAT) {
        return Err(Reject::FORMAT);
    }
    let cv = raw
        .get("catalogVersion")
        .and_then(|v| v.as_str())
        .ok_or(Reject::FORMAT)?;
    if format_major(cv) != Some(1) {
        return Err(Reject::UNSUPPORTED);
    }
    let catalog: AppCatalog = serde_json::from_value(raw).map_err(|_| Reject::FORMAT)?;
    if !critical_known(&catalog.critical, KNOWN_FIELDS) {
        return Err(Reject::UNSUPPORTED);
    }
    catalog.rollout.check()?;
    if catalog
        .notes
        .as_ref()
        .is_some_and(|n| n.chars().count() > MAX_NOTES_CHARS)
    {
        return Err(Reject::FORMAT);
    }
    let version = Version::app(&catalog.version).ok_or(Reject::FORMAT)?;
    let issued = parse_utc(&catalog.issued_at).ok_or(Reject::FORMAT)?;
    let expires = parse_utc(&catalog.expires_at).ok_or(Reject::FORMAT)?;
    if expires <= issued {
        return Err(Reject::FORMAT);
    }
    if last_serial.is_some_and(|s| catalog.serial < s) {
        return Err(Reject::OLDER);
    }
    if now >= expires {
        return Err(Reject::EXPIRED);
    }
    Ok(Verified {
        catalog,
        version,
        signer: key,
    })
}

/// 更新をどうするか
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdatePlan {
    /// 今の版が目録の版と同じか新しい
    UpToDate,
    /// 待つ（一時停止・まだこの組の番ではない）
    Wait(Wait),
    /// 更新を受け取る。Tauri の updater に `tauri_pubkey` を渡し、`version` だけを受け付ける
    Offer {
        version: String,
        tauri_pubkey: String,
        /// FP が遅らせられない（最低版に指定された・`noDefer`）
        required: bool,
    },
}

/// 当てるかどうかを決める。`current` は今のアプリの版、`minimum` は取り下げの一覧の最低版（[`crate::revocations`]）
pub fn plan(
    v: &Verified,
    current: &Version,
    cohort: Cohort,
    minimum: Option<&Version>,
) -> UpdatePlan {
    if v.version <= *current {
        return UpdatePlan::UpToDate;
    }
    if v.catalog.paused {
        return UpdatePlan::Wait(Wait::Paused);
    }
    // 最低版より古いアプリは、段階配信の順番を待たずに受け取る（計算と出力が止まっているため。0017 の7）
    let below_minimum = minimum.is_some_and(|m| current < m && v.version >= *m);
    if !below_minimum && !v.catalog.rollout.includes(cohort) {
        return UpdatePlan::Wait(Wait::NotYourTurn);
    }
    UpdatePlan::Offer {
        version: v.catalog.version.clone(),
        tauri_pubkey: v.signer.tauri_pubkey().to_owned(),
        required: below_minimum || v.catalog.no_defer,
    }
}
