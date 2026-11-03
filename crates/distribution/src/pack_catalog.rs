//! 制度データパック・マスタデータパックの配信の目録（0017 の3・6、0022 の3・4）。
//!
//! 配信元の `index.json` は、各パックの「配信の目録」の封筒を並べた入れ物（入れ物そのものには署名しない。中の封筒を1つずつ確かめる）:
//!
//! ```json
//! { "format": "financia-pack-index", "formatVersion": "1.0", "entries": [ <封筒>, … ] }
//! ```
//!
//! 封筒（[`crate::envelope`]。形の名前は `financia-pack-catalog-envelope`）の中身:
//!
//! ```json
//! {
//!   "format": "financia-pack-catalog", "catalogVersion": "1.0",
//!   "packId": "regulation.tax", "field": "tax", "version": "2027.3.1",
//!   "signer": { "keyId": "data-2027a", "role": "data" },
//!   "file": { "path": "packs/regulation.tax/2027.3.1.json", "sha256": "<16進64文字>", "size": 12345 },
//!   "changes": [{ "valueId": "incomeTax.basicDeduction", "kind": "addPeriod", "from": "2027-04" }],
//!   "issuedAt": "2027-03-01T00:00:00Z", "serial": 12, "expiresAt": "2027-06-01T00:00:00Z",
//!   "reviewWindowEndsAt": null,
//!   "rollout": { "stage": 0, "percent": 100 }, "paused": false, "rollbackOf": null, "critical": []
//! }
//! ```
//!
//! - 署名した鍵は、`signer.role` の役割（データ用か自動配信用だけ）の鍵でなければならず、`signer.keyId` と一致しなければならない。
//! - 通し番号はパックごとに増える一方。版は、手元に入っている版より新しいものだけを当てる（巻き戻しも、前の中身を新しい版で配る）。
//! - 自動配信用の鍵で署名したものは、0022 の3 の範囲だけを受け付ける。ここでは目録に書いた変更の種類を確かめ
//!   （`addPeriod`、巻き戻しの `removePeriod` だけ）、確認期間（`reviewWindowEndsAt`）が終わるまで当てない。
//!   パックの中身の差（既にある値IDに同じ形の新しい期間を1つ足すだけか・変化率の上限内か）は、パックを当てる部品が
//!   手元のパックと比べて確かめる（0022 の3。この部品の外）。
//! - パックのファイルは、目録の `sha256` と `size` に合うものだけを使う（[`check_file`]）。中身にプログラムは入らない（0017 の3）。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::envelope;
use crate::keys::{KeyRing, Role};
use crate::rollout::{Cohort, Rollout, Wait};
use crate::{critical_known, format_major, parse_utc, Reject, Version, MAX_DOCUMENT_BYTES};

/// 入れ物の形の名前
pub const INDEX_FORMAT: &str = "financia-pack-index";
/// 封筒の形の名前
pub const ENVELOPE_FORMAT: &str = "financia-pack-catalog-envelope";
/// 中身の形の名前
pub const FORMAT: &str = "financia-pack-catalog";
/// パックのファイルの大きさの上限（バイト）
pub const MAX_PACK_BYTES: u64 = 32 * 1024 * 1024;
/// 1つの目録に書ける変更の数の上限
const MAX_CHANGES: usize = 5000;
/// 入れ物に並べられる目録の数の上限
const MAX_ENTRIES: usize = 256;
/// この版のアプリが知っている欄（`critical` に書けるもの）
pub const KNOWN_FIELDS: &[&str] = &[
    "format",
    "catalogVersion",
    "packId",
    "field",
    "version",
    "signer",
    "file",
    "changes",
    "issuedAt",
    "serial",
    "expiresAt",
    "reviewWindowEndsAt",
    "rollout",
    "paused",
    "rollbackOf",
    "critical",
];

/// 変更の種類
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    /// 既にある値IDに、新しい適用期間を足す（自動配信用の鍵でも受け付ける）
    AddPeriod,
    /// 巻き戻し: 自動配信で足した期間を外す（自動配信用の鍵は `rollbackOf` のある目録でだけ使える）
    RemovePeriod,
    /// 新しい値IDを足す（人の鍵だけ）
    AddValue,
    /// 既にある期間の値を直す（人の鍵だけ）
    ModifyPeriod,
    /// 状態を変える（案→成立など。人の鍵だけ）
    ChangeStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub value_id: String,
    pub kind: ChangeKind,
    /// 適用の始まり（`YYYY-MM`。期間の変更のとき）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Signer {
    pub key_id: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackFile {
    /// 配信元の中の場所（`/v1/` の下の相対の場所。ほかのホストは指せない）
    pub path: String,
    /// SHA-256（小文字の16進64文字）
    pub sha256: String,
    pub size: u64,
}

/// 配信の目録の中身。知らない欄は無視する（`critical` に載っていなければ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackCatalog {
    pub format: String,
    pub catalog_version: String,
    pub pack_id: String,
    pub field: String,
    pub version: String,
    pub signer: Signer,
    pub file: PackFile,
    pub changes: Vec<Change>,
    pub issued_at: String,
    pub serial: u64,
    pub expires_at: String,
    #[serde(default)]
    pub review_window_ends_at: Option<String>,
    pub rollout: Rollout,
    pub paused: bool,
    #[serde(default)]
    pub rollback_of: Option<String>,
    pub critical: Vec<String>,
}

/// 確かめた目録
#[derive(Debug, Clone)]
pub struct Verified {
    pub catalog: PackCatalog,
    pub role: Role,
    pub version: Version,
    review_window_ends: Option<i64>,
}

/// 手元に覚えている、そのパックの状態
#[derive(Debug, Clone, Default)]
pub struct Installed<'a> {
    /// 最後に受け付けた目録の通し番号
    pub last_serial: Option<u64>,
    /// 手元に入っている版
    pub version: Option<&'a str>,
}

fn valid_pack_id(s: &str) -> bool {
    let mut parts = s.split('.');
    matches!(parts.next(), Some("regulation" | "master"))
        && s.len() <= 80
        && s.split('.').count() >= 2
        && parts.all(|p| {
            p.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                && p.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

fn valid_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 200
        && !p.starts_with('/')
        && p.split('/').all(|seg| {
            !seg.is_empty()
                && seg != "."
                && seg != ".."
                && seg
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        })
}

/// 1つの目録の封筒を確かめる
pub fn verify(
    bytes: &[u8],
    ring: &KeyRing,
    installed: &Installed,
    now: i64,
) -> Result<Verified, Reject> {
    // 署名の確認は、データ用と自動配信用の鍵だけで（取り下げ用・アプリ更新用の鍵は使わない）
    let opened = envelope::open(
        bytes,
        ENVELOPE_FORMAT,
        &[Role::Data, Role::AutoDelivery],
        ring,
    )?;
    let raw: serde_json::Value =
        serde_json::from_str(&opened.payload).map_err(|_| Reject::FORMAT)?;
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
    let catalog: PackCatalog = serde_json::from_value(raw).map_err(|_| Reject::FORMAT)?;
    if !critical_known(&catalog.critical, KNOWN_FIELDS) {
        return Err(Reject::UNSUPPORTED);
    }
    // 目録に書いた署名者と、確かめられた鍵が同じであること
    let role = Role::from_name(&catalog.signer.role).ok_or(Reject::FORMAT)?;
    if !matches!(role, Role::Data | Role::AutoDelivery) {
        return Err(Reject::KEY);
    }
    if catalog.signer.key_id != opened.kid || ring.get(role, &opened.kid).is_none() {
        return Err(Reject::SIGNER_MISMATCH);
    }
    // 形
    if !valid_pack_id(&catalog.pack_id)
        || catalog.field.is_empty()
        || catalog.field.len() > 40
        || !valid_path(&catalog.file.path)
        || catalog.file.sha256.len() != 64
        || !catalog
            .file
            .sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || catalog.file.size == 0
        || catalog.file.size > MAX_PACK_BYTES
        || catalog.changes.len() > MAX_CHANGES
    {
        return Err(Reject::FORMAT);
    }
    catalog.rollout.check()?;
    let version = Version::parse(&catalog.version, 3).ok_or(Reject::FORMAT)?;
    if let Some(r) = &catalog.rollback_of {
        if Version::parse(r, 3).is_none_or(|rv| rv >= version) {
            return Err(Reject::FORMAT);
        }
    }
    let issued = parse_utc(&catalog.issued_at).ok_or(Reject::FORMAT)?;
    let expires = parse_utc(&catalog.expires_at).ok_or(Reject::FORMAT)?;
    if expires <= issued {
        return Err(Reject::FORMAT);
    }
    let review_window_ends = match &catalog.review_window_ends_at {
        Some(s) => Some(parse_utc(s).ok_or(Reject::FORMAT)?),
        None => None,
    };
    // 自動配信用の鍵で受け付ける範囲（0022 の3）
    if role == Role::AutoDelivery {
        let allowed = |k: ChangeKind| {
            k == ChangeKind::AddPeriod
                || (k == ChangeKind::RemovePeriod && catalog.rollback_of.is_some())
        };
        if catalog.changes.is_empty()
            || !catalog.changes.iter().all(|c| allowed(c.kind))
            || review_window_ends.is_none()
        {
            return Err(Reject::SCOPE);
        }
    }
    // 古いものを受け付けない
    if installed.last_serial.is_some_and(|s| catalog.serial < s) {
        return Err(Reject::OLDER);
    }
    if let Some(iv) = installed.version.and_then(|v| Version::parse(v, 3)) {
        if version < iv {
            return Err(Reject::OLDER);
        }
    }
    if now >= expires {
        return Err(Reject::EXPIRED);
    }
    Ok(Verified {
        catalog,
        role,
        version,
        review_window_ends,
    })
}

/// 当てるかどうか
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// パックのファイルを取って、確かめてから当てる
    Apply,
    /// 手元の版と同じ
    AlreadyInstalled,
    /// 待つ
    Wait(Wait),
}

/// 当てるかどうかを決める（[`verify`] を通った目録について）
pub fn decide(v: &Verified, installed_version: Option<&str>, cohort: Cohort, now: i64) -> Decision {
    if installed_version
        .and_then(|s| Version::parse(s, 3))
        .is_some_and(|iv| iv == v.version)
    {
        return Decision::AlreadyInstalled;
    }
    if v.catalog.paused {
        return Decision::Wait(Wait::Paused);
    }
    if v.review_window_ends.is_some_and(|t| now < t) {
        return Decision::Wait(Wait::ReviewWindow);
    }
    if !v.catalog.rollout.includes(cohort) {
        return Decision::Wait(Wait::NotYourTurn);
    }
    Decision::Apply
}

/// 取ってきたパックのファイルが、目録の要約と大きさに合うか
pub fn check_file(v: &Verified, bytes: &[u8]) -> Result<(), Reject> {
    if bytes.len() as u64 != v.catalog.file.size {
        return Err(Reject::DIGEST);
    }
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if hex != v.catalog.file.sha256 {
        return Err(Reject::DIGEST);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    format: String,
    format_version: String,
    entries: Vec<serde_json::Value>,
}

/// 入れ物（`index.json`）から、目録の封筒のバイト列を取り出す（1つずつ [`verify`] に渡す）
pub fn split_index(bytes: &[u8]) -> Result<Vec<Vec<u8>>, Reject> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(Reject::FORMAT);
    }
    let idx: Index = serde_json::from_slice(bytes).map_err(|_| Reject::FORMAT)?;
    if idx.format != INDEX_FORMAT {
        return Err(Reject::FORMAT);
    }
    if format_major(&idx.format_version) != Some(1) {
        return Err(Reject::UNSUPPORTED);
    }
    if idx.entries.len() > MAX_ENTRIES {
        return Err(Reject::FORMAT);
    }
    idx.entries
        .iter()
        .map(|e| serde_json::to_vec(e).map_err(|_| Reject::FORMAT))
        .collect()
}
