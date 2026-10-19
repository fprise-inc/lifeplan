//! 共有フォルダの中のファイルの形（0023）。
//!
//! ```text
//! <選んだフォルダ>/lifeplan-office/
//!   office.json                              事務所ID（平文）
//!   members.lpmb                             名簿と、親鍵をメンバーごとの公開鍵で包んだもの（"LPMB"）
//!   requests/<メンバーID>.json               参加の申請（平文）
//!   keys/<親鍵の鍵ID>/<世帯ID>.lphk           世帯の鍵の札（その時代の親鍵から導いた鍵で暗号化。"LPHK"）
//!   cards/<世帯ID>.lpcd                      世帯の札（一覧に出す顧客番号・要約・最後に直した人。"LPCD"）
//!   households/<世帯ID>.lphf                 世帯ファイル（今までと同じ封筒。0011）
//!   presence/<世帯ID>.<メンバーID>.lpop       開いている印（"LPOP"）
//! ```
//!
//! どのファイルも 0011 の1 と同じ容器（識別の印・容器の版・見出しの長さ・見出しの JSON・暗号文）で、見出し全体を改ざん検出の対象にする。
//! 鍵は事務所の親鍵から用途ごとに導く（0013 の2）。この部品はファイルの形だけを扱い、どこに書くかは [`crate::Store`] が決める。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::container;
use crate::crypto::{self, purpose, Key, KEY_LEN, NONCE_LEN};
use crate::member::{self, MemberKeys, Wrap};
use crate::StoreError;

/// 選んだフォルダの中に作る事務所のフォルダの名前
pub const OFFICE_DIR: &str = "lifeplan-office";
pub const OFFICE_FILE_FORMAT: &str = "lifeplan.sharedOffice";
pub const MEMBERS_FORMAT: &str = "lifeplan.officeMembers";
pub const KEYS_FORMAT: &str = "lifeplan.householdKeys";
pub const CARD_FORMAT: &str = "lifeplan.householdCard";
pub const PRESENCE_FORMAT: &str = "lifeplan.presence";
pub const REQUEST_FORMAT: &str = "lifeplan.joinRequest";
/// 共有フォルダの中のファイルの形式の版（β公開までは 0.x）
pub const SHARED_FORMAT_VERSION: &str = "0.1";

const MEMBERS_MAGIC: &[u8; 4] = b"LPMB";
const KEYS_MAGIC: &[u8; 4] = b"LPHK";
const CARD_MAGIC: &[u8; 4] = b"LPCD";
const PRESENCE_MAGIC: &[u8; 4] = b"LPOP";

/// 役割（今は「すべての操作ができる」だけ。知らない役割は閲覧だけとして扱う。0023 の2）
pub const ROLE_MEMBER: &str = "member";
/// 開いている印が無効になるまでの秒（5分）
pub const PRESENCE_TTL_SECS: i64 = 300;
/// 開いている印を新しくする間隔（1分）
pub const PRESENCE_REFRESH_SECS: i64 = 60;
/// 前の親鍵を名簿に残す日数（0023 の4。鍵置き場の世代と同じ 30日）
pub const PREVIOUS_MASTER_DAYS: i64 = 30;
/// 世帯の鍵の札に残す前の世帯の鍵の数の上限
pub const MAX_PREVIOUS_KEYS: usize = 16;
/// 表示名の長さの上限（文字）
pub const MAX_DISPLAY_NAME: usize = 20;

/// 事務所のフォルダの中の場所
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Paths {
        Paths { root }
    }
    pub fn office_file(&self) -> PathBuf {
        self.root.join("office.json")
    }
    pub fn members(&self) -> PathBuf {
        self.root.join("members.lpmb")
    }
    pub fn requests_dir(&self) -> PathBuf {
        self.root.join("requests")
    }
    pub fn request(&self, member_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(member_id));
        self.requests_dir().join(format!("{member_id}.json"))
    }
    pub fn keys_root(&self) -> PathBuf {
        self.root.join("keys")
    }
    pub fn keys_dir(&self, master_key_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(master_key_id));
        self.keys_root().join(master_key_id)
    }
    pub fn key_file(&self, master_key_id: &str, household_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(household_id));
        self.keys_dir(master_key_id)
            .join(format!("{household_id}.lphk"))
    }
    pub fn cards_dir(&self) -> PathBuf {
        self.root.join("cards")
    }
    pub fn card(&self, household_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(household_id));
        self.cards_dir().join(format!("{household_id}.lpcd"))
    }
    pub fn households_dir(&self) -> PathBuf {
        self.root.join("households")
    }
    pub fn presence_dir(&self) -> PathBuf {
        self.root.join("presence")
    }
    pub fn presence(&self, household_id: &str, member_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(household_id) && crypto::is_uuid(member_id));
        self.presence_dir()
            .join(format!("{household_id}.{member_id}.lpop"))
    }
}

/// 選んだフォルダから、既にある事務所のフォルダを探す（`lifeplan-office` そのもの、またはそれを含むフォルダ）
pub fn locate(folder: &Path) -> Option<PathBuf> {
    let direct = folder.join("office.json");
    if folder.file_name().is_some_and(|n| n == OFFICE_DIR) && direct.is_file() {
        return Some(folder.to_path_buf());
    }
    let inner = folder.join(OFFICE_DIR);
    inner.join("office.json").is_file().then_some(inner)
}

/// `office.json`（平文）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeFile {
    pub format: String,
    pub format_version: String,
    pub office_id: String,
}

impl OfficeFile {
    pub fn new(office_id: &str) -> OfficeFile {
        OfficeFile {
            format: OFFICE_FILE_FORMAT.into(),
            format_version: SHARED_FORMAT_VERSION.into(),
            office_id: office_id.into(),
        }
    }
    pub fn read(p: &Paths) -> Result<OfficeFile, StoreError> {
        let b = std::fs::read(p.office_file()).map_err(|_| StoreError::OFFICE_NOT_FOUND)?;
        let f: OfficeFile = serde_json::from_slice(&b).map_err(|_| StoreError::CORRUPT)?;
        if f.format != OFFICE_FILE_FORMAT || !crypto::is_uuid(&f.office_id) {
            return Err(StoreError::CORRUPT);
        }
        Ok(f)
    }
}

/// 書いた人（メンバーの内部IDと表示名。表示名は FP 自身の名前で、顧客の識別子ではない。0023 の6）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub member_id: String,
    pub name: String,
}

/// 表示名の形（前後の空白を除いて1〜20文字、制御文字なし）
pub fn valid_display_name(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.chars().count() <= MAX_DISPLAY_NAME && !t.chars().any(char::is_control)
}

// ------------------------------------------------------------------ 名簿

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub member_id: String,
    pub display_name: String,
    /// X25519 の公開鍵（16進）
    pub public_key: String,
    pub fingerprint: String,
    pub joined_at: String,
    /// 承認したメンバーの ID（事務所を始めた人は null）
    pub approved_by: Option<String>,
    /// 役割（今は `member` だけ）
    pub role: String,
}

impl Member {
    pub fn public(&self) -> Result<[u8; 32], StoreError> {
        crypto::hex_array(&self.public_key).ok_or(StoreError::CORRUPT)
    }
    pub fn author(&self) -> Author {
        Author {
            member_id: self.member_id.clone(),
            name: self.display_name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedMember {
    pub member_id: String,
    pub display_name: String,
    pub removed_at: String,
    pub removed_by: Option<String>,
}

/// 事務所の復元キーを保管した記録（その時代の親鍵についてだけ有効）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryAck {
    pub master_key_id: String,
    pub acknowledged_at: String,
    pub acknowledged_by: String,
}

/// 前の親鍵（入れ替えの後、30日だけ持つ）
pub struct PreviousMaster {
    pub master_key_id: String,
    pub key: Key,
    pub retired_at: String,
}

impl Clone for PreviousMaster {
    fn clone(&self) -> Self {
        PreviousMaster {
            master_key_id: self.master_key_id.clone(),
            key: self.key.clone(),
            retired_at: self.retired_at.clone(),
        }
    }
}

/// 開いた名簿
#[derive(Clone)]
pub struct Roster {
    pub office_id: String,
    pub master_key_id: String,
    pub members: Vec<Member>,
    pub removed: Vec<RemovedMember>,
    pub previous: Vec<PreviousMaster>,
    pub recovery: Option<RecoveryAck>,
    pub updated_at: String,
    pub updated_by: Option<String>,
}

impl Roster {
    pub fn member(&self, id: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.member_id == id)
    }
    /// その時代の親鍵（今の親鍵か、前の親鍵の一覧から）
    pub fn master_for(&self, current: &Key, master_key_id: &str) -> Option<Key> {
        if master_key_id == self.master_key_id {
            return Some(current.clone());
        }
        self.previous
            .iter()
            .find(|p| p.master_key_id == master_key_id)
            .map(|p| p.key.clone())
    }
    pub fn name_of(&self, member_id: &str) -> Option<String> {
        self.member(member_id)
            .map(|m| m.display_name.clone())
            .or_else(|| {
                self.removed
                    .iter()
                    .find(|r| r.member_id == member_id)
                    .map(|r| r.display_name.clone())
            })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembersHeader {
    cipher: String,
    format: String,
    format_version: String,
    kcv: String,
    master_key_id: String,
    nonce: String,
    office_id: String,
    wraps: Vec<Wrap>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviousMasterRaw {
    master_key_id: String,
    key: String,
    retired_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembersBody {
    format_version: String,
    office_id: String,
    master_key_id: String,
    members: Vec<Member>,
    #[serde(default)]
    removed: Vec<RemovedMember>,
    #[serde(default)]
    previous_masters: Vec<PreviousMasterRaw>,
    #[serde(default)]
    recovery: Option<RecoveryAck>,
    updated_at: String,
    updated_by: Option<String>,
}

/// 確かめ値（0013 の2 と同じ形）
pub fn kcv(master: &[u8; KEY_LEN]) -> String {
    crypto::hex_encode(&crypto::derive(master, purpose::KEY_CHECK)[..8])
}

/// 名簿をファイルにする（包みは、メンバーの公開鍵ごとに新しく作る）
pub fn encode_roster(r: &Roster, master: &[u8; KEY_LEN]) -> Result<Vec<u8>, StoreError> {
    let mut wraps = Vec::with_capacity(r.members.len());
    for m in &r.members {
        wraps.push(member::wrap_master(
            master,
            &m.public()?,
            &r.office_id,
            &r.master_key_id,
            &m.member_id,
        )?);
    }
    let nonce = crypto::random_nonce();
    let header = MembersHeader {
        cipher: crypto::CIPHER.into(),
        format: MEMBERS_FORMAT.into(),
        format_version: SHARED_FORMAT_VERSION.into(),
        kcv: kcv(master),
        master_key_id: r.master_key_id.clone(),
        nonce: crypto::hex_encode(&nonce),
        office_id: r.office_id.clone(),
        wraps,
    };
    let body = Zeroizing::new(
        serde_json::to_vec(&MembersBody {
            format_version: SHARED_FORMAT_VERSION.into(),
            office_id: r.office_id.clone(),
            master_key_id: r.master_key_id.clone(),
            members: r.members.clone(),
            removed: r.removed.clone(),
            previous_masters: r
                .previous
                .iter()
                .map(|p| PreviousMasterRaw {
                    master_key_id: p.master_key_id.clone(),
                    key: crypto::hex_encode(p.key.as_ref()),
                    retired_at: p.retired_at.clone(),
                })
                .collect(),
            recovery: r.recovery.clone(),
            updated_at: r.updated_at.clone(),
            updated_by: r.updated_by.clone(),
        })
        .expect("名簿の JSON"),
    );
    let k = crypto::derive(master, purpose::OFFICE_MEMBERS);
    Ok(container::seal(
        MEMBERS_MAGIC,
        &container::header_json(&header),
        &k,
        &nonce,
        &body,
    ))
}

fn members_header(bytes: &[u8]) -> Result<(MembersHeader, container::Parts<'_>), StoreError> {
    let p = container::split(MEMBERS_MAGIC, bytes)?;
    let h: MembersHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    if h.format != MEMBERS_FORMAT || h.cipher != crypto::CIPHER {
        return Err(StoreError::CORRUPT);
    }
    Ok((h, p))
}

/// 親鍵で名簿を開く（確かめ値が違えば [`StoreError::WRONG_MASTER`]）
pub fn open_roster_with_master(bytes: &[u8], master: &[u8; KEY_LEN]) -> Result<Roster, StoreError> {
    let (h, p) = members_header(bytes)?;
    if h.kcv != kcv(master) {
        return Err(StoreError::WRONG_MASTER);
    }
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let k = crypto::derive(master, purpose::OFFICE_MEMBERS);
    let body = crypto::open(&k, &nonce, p.aad, p.ciphertext)?;
    let b: MembersBody = serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)?;
    if b.office_id != h.office_id || b.master_key_id != h.master_key_id {
        return Err(StoreError::CORRUPT);
    }
    let mut previous = Vec::with_capacity(b.previous_masters.len());
    for pm in b.previous_masters {
        previous.push(PreviousMaster {
            master_key_id: pm.master_key_id,
            key: crypto::key_from_hex(&pm.key).ok_or(StoreError::CORRUPT)?,
            retired_at: pm.retired_at,
        });
    }
    Ok(Roster {
        office_id: b.office_id,
        master_key_id: b.master_key_id,
        members: b.members,
        removed: b.removed,
        previous,
        recovery: b.recovery,
        updated_at: b.updated_at,
        updated_by: b.updated_by,
    })
}

/// 自分の秘密鍵で名簿を開く。包みが無ければ [`StoreError::OFFICE_NOT_MEMBER`]。
/// 本文のメンバーの一覧に自分（同じ公開鍵）が入っていることも確かめる
pub fn open_roster(
    bytes: &[u8],
    keys: &MemberKeys,
    member_id: &str,
) -> Result<(Roster, Key), StoreError> {
    let (h, _) = members_header(bytes)?;
    let w = h
        .wraps
        .iter()
        .find(|w| w.member_id == member_id)
        .ok_or(StoreError::OFFICE_NOT_MEMBER)?;
    let master = member::unwrap_master(w, keys, &h.office_id, &h.master_key_id)?;
    let r = open_roster_with_master(bytes, &master)?;
    match r.member(member_id) {
        Some(m) if m.public_key == keys.public_hex() => Ok((r, master)),
        _ => Err(StoreError::OFFICE_NOT_MEMBER),
    }
}

/// 見出しの事務所IDと親鍵の鍵ID（暗号は外さない）
pub fn peek_roster(bytes: &[u8]) -> Result<(String, String), StoreError> {
    let (h, _) = members_header(bytes)?;
    Ok((h.office_id, h.master_key_id))
}

// ------------------------------------------------------------------ 世帯の鍵の札

/// 世帯の鍵（今の鍵と、前の鍵の一覧）
pub struct HouseholdKeys {
    pub current_id: String,
    pub current: Key,
    pub previous: Vec<(String, Key)>,
}

impl HouseholdKeys {
    pub fn new() -> HouseholdKeys {
        HouseholdKeys {
            current_id: crypto::new_uuid(),
            current: crypto::random_key(),
            previous: vec![],
        }
    }
    /// 鍵IDで探す（今の鍵か前の鍵）
    pub fn find(&self, key_id: &str) -> Option<Key> {
        if key_id == self.current_id {
            return Some(self.current.clone());
        }
        self.previous
            .iter()
            .find(|(id, _)| id == key_id)
            .map(|(_, k)| k.clone())
    }
    /// 世帯の鍵を新しくする（今の鍵を前の鍵に回す。0023 の4）
    pub fn rotated(&self) -> HouseholdKeys {
        let mut previous = vec![(self.current_id.clone(), self.current.clone())];
        previous.extend(self.previous.iter().cloned());
        previous.truncate(MAX_PREVIOUS_KEYS);
        HouseholdKeys {
            current_id: crypto::new_uuid(),
            current: crypto::random_key(),
            previous,
        }
    }
}

impl Default for HouseholdKeys {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeysHeader {
    cipher: String,
    format: String,
    format_version: String,
    household_id: String,
    master_key_id: String,
    nonce: String,
    office_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyEntry {
    key_id: String,
    key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeysBody {
    household_id: String,
    current: KeyEntry,
    previous: Vec<KeyEntry>,
}

pub fn encode_keys(
    office_id: &str,
    master_key_id: &str,
    household_id: &str,
    k: &HouseholdKeys,
    master: &[u8; KEY_LEN],
) -> Vec<u8> {
    let nonce = crypto::random_nonce();
    let header = KeysHeader {
        cipher: crypto::CIPHER.into(),
        format: KEYS_FORMAT.into(),
        format_version: SHARED_FORMAT_VERSION.into(),
        household_id: household_id.into(),
        master_key_id: master_key_id.into(),
        nonce: crypto::hex_encode(&nonce),
        office_id: office_id.into(),
    };
    let entry = |id: &str, key: &Key| KeyEntry {
        key_id: id.into(),
        key: crypto::hex_encode(key.as_ref()),
    };
    let body = Zeroizing::new(
        serde_json::to_vec(&KeysBody {
            household_id: household_id.into(),
            current: entry(&k.current_id, &k.current),
            previous: k.previous.iter().map(|(i, key)| entry(i, key)).collect(),
        })
        .expect("世帯の鍵の札の JSON"),
    );
    let dk = crypto::derive(master, purpose::HOUSEHOLD_KEYS);
    container::seal(
        KEYS_MAGIC,
        &container::header_json(&header),
        &dk,
        &nonce,
        &body,
    )
}

/// 札の見出しの親鍵の鍵ID（暗号は外さない）
pub fn peek_keys_master(bytes: &[u8]) -> Result<String, StoreError> {
    let p = container::split(KEYS_MAGIC, bytes)?;
    let h: KeysHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    Ok(h.master_key_id)
}

/// 世帯の鍵の札を開く（別の世帯の札なら開かない）
pub fn open_keys(
    bytes: &[u8],
    household_id: &str,
    master: &[u8; KEY_LEN],
) -> Result<HouseholdKeys, StoreError> {
    let p = container::split(KEYS_MAGIC, bytes)?;
    let h: KeysHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    if h.format != KEYS_FORMAT || h.cipher != crypto::CIPHER || h.household_id != household_id {
        return Err(StoreError::CORRUPT);
    }
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let dk = crypto::derive(master, purpose::HOUSEHOLD_KEYS);
    let body = crypto::open(&dk, &nonce, p.aad, p.ciphertext)?;
    let b: KeysBody = serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)?;
    if b.household_id != household_id {
        return Err(StoreError::CORRUPT);
    }
    let key = |e: &KeyEntry| crypto::key_from_hex(&e.key).ok_or(StoreError::CORRUPT);
    let mut previous = Vec::with_capacity(b.previous.len());
    for e in &b.previous {
        previous.push((e.key_id.clone(), key(e)?));
    }
    Ok(HouseholdKeys {
        current_id: b.current.key_id.clone(),
        current: key(&b.current)?,
        previous,
    })
}

// ------------------------------------------------------------------ 世帯の札・開いている印（同じ形の小さなファイル）

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmallHeader {
    cipher: String,
    format: String,
    format_version: String,
    household_id: String,
    master_key_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    member_id: Option<String>,
    nonce: String,
    office_id: String,
}

#[allow(clippy::too_many_arguments)]
fn seal_small<T: Serialize>(
    magic: &[u8; 4],
    format: &str,
    purpose: &str,
    office_id: &str,
    master_key_id: &str,
    household_id: &str,
    member_id: Option<&str>,
    value: &T,
    master: &[u8; KEY_LEN],
) -> Vec<u8> {
    let nonce = crypto::random_nonce();
    let header = SmallHeader {
        cipher: crypto::CIPHER.into(),
        format: format.into(),
        format_version: SHARED_FORMAT_VERSION.into(),
        household_id: household_id.into(),
        master_key_id: master_key_id.into(),
        member_id: member_id.map(str::to_owned),
        nonce: crypto::hex_encode(&nonce),
        office_id: office_id.into(),
    };
    let body = Zeroizing::new(serde_json::to_vec(value).expect("JSON"));
    let k = crypto::derive(master, purpose);
    container::seal(magic, &container::header_json(&header), &k, &nonce, &body)
}

fn open_small<T: for<'de> Deserialize<'de>>(
    magic: &[u8; 4],
    format: &str,
    purpose: &str,
    bytes: &[u8],
    household_id: &str,
    member_id: Option<&str>,
    master_for: impl Fn(&str) -> Option<Key>,
) -> Result<T, StoreError> {
    let p = container::split(magic, bytes)?;
    let h: SmallHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    if h.format != format
        || h.cipher != crypto::CIPHER
        || h.household_id != household_id
        || h.member_id.as_deref() != member_id
    {
        return Err(StoreError::CORRUPT);
    }
    let master = master_for(&h.master_key_id).ok_or(StoreError::NO_KEY)?;
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let k = crypto::derive(&master, purpose);
    let body = crypto::open(&k, &nonce, p.aad, p.ciphertext)?;
    serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)
}

/// 世帯の札（一覧のための値。0023 の2）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub customer_no: String,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub updated_by: Option<Author>,
    pub generation: u64,
}

pub fn encode_card(
    office_id: &str,
    master_key_id: &str,
    household_id: &str,
    card: &Card,
    master: &[u8; KEY_LEN],
) -> Vec<u8> {
    seal_small(
        CARD_MAGIC,
        CARD_FORMAT,
        purpose::HOUSEHOLD_CARD,
        office_id,
        master_key_id,
        household_id,
        None,
        card,
        master,
    )
}

pub fn open_card(
    bytes: &[u8],
    household_id: &str,
    master_for: impl Fn(&str) -> Option<Key>,
) -> Result<Card, StoreError> {
    open_small(
        CARD_MAGIC,
        CARD_FORMAT,
        purpose::HOUSEHOLD_CARD,
        bytes,
        household_id,
        None,
        master_for,
    )
}

/// 開いている印（0023 の7）。時刻は 1970-01-01 からの秒（UTC）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub member_id: String,
    pub display_name: String,
    pub opened_at: i64,
    pub heartbeat_at: i64,
    pub device_id: String,
}

impl Presence {
    /// 有効か（最後に新しくしてから5分以内。未来の時刻も5分を超えたら無効）
    pub fn valid_at(&self, now: i64) -> bool {
        (now - self.heartbeat_at).abs() <= PRESENCE_TTL_SECS
    }
}

pub fn encode_presence(
    office_id: &str,
    master_key_id: &str,
    household_id: &str,
    p: &Presence,
    master: &[u8; KEY_LEN],
) -> Vec<u8> {
    seal_small(
        PRESENCE_MAGIC,
        PRESENCE_FORMAT,
        purpose::PRESENCE,
        office_id,
        master_key_id,
        household_id,
        Some(&p.member_id),
        p,
        master,
    )
}

pub fn open_presence(
    bytes: &[u8],
    household_id: &str,
    member_id: &str,
    master_for: impl Fn(&str) -> Option<Key>,
) -> Result<Presence, StoreError> {
    let p: Presence = open_small(
        PRESENCE_MAGIC,
        PRESENCE_FORMAT,
        purpose::PRESENCE,
        bytes,
        household_id,
        Some(member_id),
        master_for,
    )?;
    if p.member_id != member_id {
        return Err(StoreError::CORRUPT);
    }
    Ok(p)
}

/// `presence/` のファイル名から（世帯ID, メンバーID）
pub fn presence_ids(file_name: &str) -> Option<(String, String)> {
    let stem = file_name.strip_suffix(".lpop")?;
    let (h, m) = stem.split_once('.')?;
    (crypto::is_uuid(h) && crypto::is_uuid(m)).then(|| (h.to_owned(), m.to_owned()))
}

// ------------------------------------------------------------------ 参加の申請（平文）

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub format: String,
    pub format_version: String,
    pub office_id: String,
    pub member_id: String,
    pub display_name: String,
    pub public_key: String,
    pub requested_at: String,
}

impl JoinRequest {
    /// 形を確かめる（壊れた・別の事務所の申請は使わない）
    pub fn checked(self, office_id: &str) -> Result<JoinRequest, StoreError> {
        let ok = self.format == REQUEST_FORMAT
            && self.office_id == office_id
            && crypto::is_uuid(&self.member_id)
            && valid_display_name(&self.display_name)
            && crypto::hex_array::<32>(&self.public_key).is_some();
        if ok {
            Ok(self)
        } else {
            Err(StoreError::CORRUPT)
        }
    }
    pub fn public(&self) -> Result<[u8; 32], StoreError> {
        crypto::hex_array(&self.public_key).ok_or(StoreError::CORRUPT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster(master_key_id: &str, members: Vec<Member>) -> Roster {
        Roster {
            office_id: crypto::new_uuid(),
            master_key_id: master_key_id.into(),
            members,
            removed: vec![],
            previous: vec![],
            recovery: None,
            updated_at: "2026-10-19T00:00:00Z".into(),
            updated_by: None,
        }
    }

    fn member_of(keys: &MemberKeys, name: &str) -> Member {
        Member {
            member_id: crypto::new_uuid(),
            display_name: name.into(),
            public_key: keys.public_hex(),
            fingerprint: member::fingerprint(&keys.public()),
            joined_at: "2026-10-19T00:00:00Z".into(),
            approved_by: None,
            role: ROLE_MEMBER.into(),
        }
    }

    #[test]
    fn roster_opens_only_for_members() {
        let a = MemberKeys::generate();
        let b = MemberKeys::generate();
        let outsider = MemberKeys::generate();
        let ma = member_of(&a, "Aさん");
        let mb = member_of(&b, "Bさん");
        let r = roster(&crypto::new_uuid(), vec![ma.clone(), mb.clone()]);
        let m = crypto::random_key();
        let bytes = encode_roster(&r, &m).unwrap();
        let (ra, ka) = open_roster(&bytes, &a, &ma.member_id).unwrap();
        assert_eq!(*ka, *m);
        assert_eq!(ra.members.len(), 2);
        let (_, kb) = open_roster(&bytes, &b, &mb.member_id).unwrap();
        assert_eq!(*kb, *m);
        // 名簿に無い人
        assert_eq!(
            open_roster(&bytes, &outsider, &crypto::new_uuid()).err(),
            Some(StoreError::OFFICE_NOT_MEMBER)
        );
        // 他人のメンバーIDを名乗っても、秘密鍵が違えば開かない
        assert!(open_roster(&bytes, &outsider, &ma.member_id).is_err());
        // 違う親鍵
        assert_eq!(
            open_roster_with_master(&bytes, &crypto::random_key()).err(),
            Some(StoreError::WRONG_MASTER)
        );
        // 1ビットの改ざん（見出しの包みの一覧を含む）
        for i in [10usize, bytes.len() / 2, bytes.len() - 1] {
            let mut bad = bytes.clone();
            bad[i] ^= 1;
            assert!(open_roster(&bad, &a, &ma.member_id).is_err(), "{i}");
        }
        // 名簿に鍵の値が平文で出ない
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(&crypto::hex_encode(m.as_ref())));
        assert!(!text.contains("Aさん"));
    }

    #[test]
    fn keys_file_is_bound_to_the_household() {
        let m = crypto::random_key();
        let office = crypto::new_uuid();
        let mk = crypto::new_uuid();
        let h1 = crypto::new_uuid();
        let h2 = crypto::new_uuid();
        let k = HouseholdKeys::new();
        let bytes = encode_keys(&office, &mk, &h1, &k, &m);
        let back = open_keys(&bytes, &h1, &m).unwrap();
        assert_eq!(back.current_id, k.current_id);
        assert_eq!(*back.current, *k.current);
        assert!(
            open_keys(&bytes, &h2, &m).is_err(),
            "別の世帯としては開かない"
        );
        assert!(open_keys(&bytes, &h1, &crypto::random_key()).is_err());
        assert_eq!(peek_keys_master(&bytes).unwrap(), mk);
        let r = k.rotated();
        assert_ne!(r.current_id, k.current_id);
        assert_eq!(*r.find(&k.current_id).unwrap(), *k.current);
        assert!(r.find(&crypto::new_uuid()).is_none());
    }

    #[test]
    fn cards_and_presence() {
        let m = crypto::random_key();
        let office = crypto::new_uuid();
        let mk = crypto::new_uuid();
        let h = crypto::new_uuid();
        let card = Card {
            customer_no: "A0001".into(),
            summary: "本人・配偶者".into(),
            created_at: "x".into(),
            updated_at: "y".into(),
            updated_by: Some(Author {
                member_id: crypto::new_uuid(),
                name: "Aさん".into(),
            }),
            generation: 3,
        };
        let b = encode_card(&office, &mk, &h, &card, &m);
        let mm = m.clone();
        let mkc = mk.clone();
        let lookup = move |id: &str| (id == mkc).then(|| mm.clone());
        assert_eq!(open_card(&b, &h, &lookup).unwrap(), card);
        assert!(open_card(&b, &crypto::new_uuid(), &lookup).is_err());
        assert_eq!(open_card(&b, &h, |_| None).err(), Some(StoreError::NO_KEY));
        let mid = crypto::new_uuid();
        let p = Presence {
            member_id: mid.clone(),
            display_name: "Aさん".into(),
            opened_at: 100,
            heartbeat_at: 1000,
            device_id: crypto::new_uuid(),
        };
        let pb = encode_presence(&office, &mk, &h, &p, &m);
        assert_eq!(open_presence(&pb, &h, &mid, &lookup).unwrap(), p);
        assert!(open_presence(&pb, &h, &crypto::new_uuid(), &lookup).is_err());
        assert!(p.valid_at(1000 + PRESENCE_TTL_SECS));
        assert!(!p.valid_at(1001 + PRESENCE_TTL_SECS));
        assert!(
            !p.valid_at(1000 - PRESENCE_TTL_SECS - 1),
            "未来の時刻の印も期限で無効"
        );
        let name = format!("{h}.{mid}.lpop");
        assert_eq!(presence_ids(&name), Some((h.clone(), mid.clone())));
        assert_eq!(presence_ids("x.lpop"), None);
    }

    #[test]
    fn display_names() {
        assert!(valid_display_name("佐藤"));
        assert!(valid_display_name(" FP 田中 "));
        assert!(!valid_display_name(""));
        assert!(!valid_display_name("   "));
        assert!(!valid_display_name("a\nb"));
        assert!(!valid_display_name(&"あ".repeat(21)));
    }
}
