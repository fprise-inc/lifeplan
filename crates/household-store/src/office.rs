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
//!   statement-dict/<メンバーID>.lpsd          明細の取り込みでそのメンバーが覚えた辞書と形（"LPSD"。0034）
//! ```
//!
//! どのファイルも 0011 の1 と同じ容器（識別の印・容器の版・見出しの長さ・見出しの JSON・暗号文）で、見出し全体を改ざん検出の対象にする。
//! 鍵は事務所の親鍵から用途ごとに導く（0013 の2）。この部品はファイルの形だけを扱い、どこに書くかは [`crate::Store`] が決める。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use zeroize::Zeroizing;

use crate::container;
use crate::crypto::{self, purpose, Key, KEY_LEN, NONCE_LEN};
use crate::member::{self, MemberKeys, Wrap};
use crate::numbering::{Category, Label};
use crate::StoreError;

/// 選んだフォルダの中に作る事務所のフォルダの名前
pub const OFFICE_DIR: &str = "lifeplan-office";
pub const OFFICE_FILE_FORMAT: &str = "lifeplan.sharedOffice";
pub const MEMBERS_FORMAT: &str = "lifeplan.officeMembers";
pub const KEYS_FORMAT: &str = "lifeplan.householdKeys";
pub const CARD_FORMAT: &str = "lifeplan.householdCard";
pub const PRESENCE_FORMAT: &str = "lifeplan.presence";
pub const REQUEST_FORMAT: &str = "lifeplan.joinRequest";
pub const STATEMENT_DICT_FORMAT: &str = "lifeplan.statementDictionary";
/// 共有フォルダの中のファイルの形式の版（β公開までは 0.x）。
///
/// 読む側の決まり（0023 の追記 2026-11-04。1.0 の前に決めた）:
/// - MAJOR が新しいファイルは使わない（[`StoreError::OFFICE_FORMAT_TOO_NEW`]。アプリの更新を案内する）。書き換えもしない。
/// - MINOR だけが新しいファイルは読んで使い、名簿・世帯の札を書き直すときは**知らない欄を残す**（`extra`）。
///   世帯ファイルと違って閲覧だけにしないのは、名簿と札は事務所の全員が書くため（1人が更新しただけで全員の承認・保存が止まらないように）。
/// - 暗号の見出し（平文）と世帯の鍵の札・開いている印の本文は、書くたびに作り直すので知らない欄を残さない。そこに欄を足すときは MAJOR を上げる。
pub const SHARED_FORMAT_VERSION: &str = "0.1";

/// これまでの共有フォルダの形式の版（古い順）。消さない。版ごとに `tests/fixtures/shared-format/<版>/` の見本がある
/// - 0.1: 最初の版（2026-10-19。0023・0024・0033 の番号の中身・0034 の明細の辞書）
pub const SHARED_KNOWN: &[&str] = &["0.1"];

/// 共有フォルダのファイルの形式の版を確かめる（形が違えば壊れている、MAJOR が新しければ使わない）
pub fn check_shared_version(v: &str) -> Result<(), StoreError> {
    let (ma, _) = crate::migrate::parse(v).ok_or(StoreError::CORRUPT)?;
    let (cur, _) = crate::migrate::parse(SHARED_FORMAT_VERSION).expect("共有フォルダの形式の版");
    if ma > cur {
        return Err(StoreError::OFFICE_FORMAT_TOO_NEW);
    }
    Ok(())
}

/// この版が知らない欄（MINOR の新しいアプリが足した欄）。書き直すときに残す
pub type Extra = Map<String, Value>;

const MEMBERS_MAGIC: &[u8; 4] = b"LPMB";
const KEYS_MAGIC: &[u8; 4] = b"LPHK";
const CARD_MAGIC: &[u8; 4] = b"LPCD";
const PRESENCE_MAGIC: &[u8; 4] = b"LPOP";
const STATEMENT_DICT_MAGIC: &[u8; 4] = b"LPSD";
/// 明細の取り込みの辞書のファイルの見出しの世帯ID の欄（世帯のファイルではないので決まった値）
const STATEMENT_DICT_SCOPE: &str = "statement-dictionary";

/// 役割（今は「すべての操作ができる」だけ。知らない役割は閲覧だけとして扱う。0023 の2）
pub const ROLE_MEMBER: &str = "member";
/// 開いている印が無効になるまでの秒（5分）
pub const PRESENCE_TTL_SECS: i64 = 300;
/// 開いている印を新しくする間隔（1分）
pub const PRESENCE_REFRESH_SECS: i64 = 60;
/// アプリ本体が「印を新しくする時期か」を確かめる間隔（秒）。書くのは [`PRESENCE_REFRESH_SECS`] ごと。
/// 開いている印の時間の値（この3つ）は、実機の同期の遅れに合わせて後から変えてよい（0023 の7）
pub const PRESENCE_POLL_SECS: u64 = 20;
/// 前の親鍵を名簿に残す日数（0023 の4。鍵置き場の世代と同じ 30日）
pub const PREVIOUS_MASTER_DAYS: i64 = 30;
/// 世帯の鍵の札に残す前の世帯の鍵の数の上限
pub const MAX_PREVIOUS_KEYS: usize = 16;
/// 表示名の長さの上限（文字）
pub const MAX_DISPLAY_NAME: usize = 20;
/// 名簿の履歴の行の上限（古い行から消す）
pub const MAX_ROSTER_EVENTS: usize = 200;
/// 名簿の履歴: 復元キーで名簿に自分を足した（全員の PC が使えなくなったとき。0023 の5）
pub const EVENT_RECOVERY_JOIN: &str = "recoveryJoin";
/// 名簿の使い方: 1人の FP が複数の PC で使う同期フォルダ（0024）。メンバーは PC ごと、表示名は PC の呼び名
pub const USAGE_PERSONAL: &str = "personal";
/// 名簿の使い方: 複数の FP の事務所での共有（0023）。欄が無い名簿もこれとして読む
pub const USAGE_OFFICE: &str = "office";

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
    pub fn statement_dict_dir(&self) -> PathBuf {
        self.root.join("statement-dict")
    }
    pub fn statement_dict(&self, member_id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(member_id));
        self.statement_dict_dir().join(format!("{member_id}.lpsd"))
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
        check_shared_version(&f.format_version)?;
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
    /// 役割（今は `member` だけ。知らない役割は閲覧だけとして扱う）
    pub role: String,
    /// この版が知らない欄（書き直すときに残す）
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Extra,
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
    /// すべての操作ができる役割か（知らない役割は閲覧だけ。将来の版が役割を足しても、古いアプリが権限を広く取り違えない。0023 の2）
    pub fn can_edit(&self) -> bool {
        self.role == ROLE_MEMBER
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedMember {
    pub member_id: String,
    pub display_name: String,
    pub removed_at: String,
    pub removed_by: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Extra,
}

/// 事務所の復元キーを保管した記録（その時代の親鍵についてだけ有効）。
/// 「保管した」の記録か、「復元キーで実際に開けるか試す」を通ったこと（`verified_*`）のどちらかで保管済みとみなす（0023 の5）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryAck {
    pub master_key_id: String,
    pub acknowledged_at: String,
    pub acknowledged_by: String,
    /// 復元キーで実際に開けることを確かめた日時と人（任意）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_by: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Extra,
}

/// 名簿の履歴の1行（今は復元キーで加わったことだけを書く。知らない種類の行は読む側が無視する）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterEvent {
    pub kind: String,
    pub member_id: String,
    pub display_name: String,
    pub at: String,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Extra,
}

/// 事務所の共有を終えた印（最後の1人が「共有をやめる」を行った。0023 の10）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedMark {
    pub closed_at: String,
    pub closed_by: String,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Extra,
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
    /// 名簿の履歴（復元キーで加わった、など）
    pub events: Vec<RosterEvent>,
    /// 事務所の共有を終えた印
    pub closed: Option<ClosedMark>,
    /// 使い方（[`USAGE_PERSONAL`]・[`USAGE_OFFICE`]）。無ければ事務所での共有（0024）
    pub usage: Option<String>,
    /// 顧客番号の区分（事務所全体で1つ。0033）。無ければ各 PC の設定を使う
    pub categories: Option<Vec<Category>>,
    pub updated_at: String,
    pub updated_by: Option<String>,
    /// この版が知らない本文の欄（MINOR の新しいアプリが足した欄。書き直すときに残す）
    pub extra: Extra,
}

impl Roster {
    /// 1人の FP が複数の PC で使う同期フォルダか（0024）
    pub fn personal(&self) -> bool {
        self.usage.as_deref() == Some(USAGE_PERSONAL)
    }
    /// 履歴に1行足す（上限を超えたら古い行から消す）
    pub fn push_event(&mut self, e: RosterEvent) {
        self.events.push(e);
        if self.events.len() > MAX_ROSTER_EVENTS {
            let extra = self.events.len() - MAX_ROSTER_EVENTS;
            self.events.drain(..extra);
        }
    }
    /// 復元キーで加わったメンバーか
    pub fn joined_by_recovery(&self, member_id: &str) -> bool {
        self.events
            .iter()
            .any(|e| e.kind == EVENT_RECOVERY_JOIN && e.member_id == member_id)
    }
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    events: Vec<RosterEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    closed: Option<ClosedMark>,
    /// 使い方（足した欄。無い名簿は事務所での共有として読む。0024）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    usage: Option<String>,
    /// 顧客番号の区分（足した欄。0033）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    categories: Option<Vec<Category>>,
    updated_at: String,
    updated_by: Option<String>,
    #[serde(flatten, default)]
    extra: Extra,
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
            events: r.events.clone(),
            closed: r.closed.clone(),
            usage: r.usage.clone(),
            categories: r.categories.clone(),
            updated_at: r.updated_at.clone(),
            updated_by: r.updated_by.clone(),
            extra: r.extra.clone(),
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
    check_shared_version(&h.format_version)?;
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
    check_shared_version(&b.format_version)?;
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
        events: b.events,
        closed: b.closed,
        usage: b.usage,
        categories: b.categories,
        updated_at: b.updated_at,
        updated_by: b.updated_by,
        extra: b.extra,
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
    check_shared_version(&h.format_version)?;
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
    check_shared_version(&h.format_version)?;
    let master = master_for(&h.master_key_id).ok_or(StoreError::NO_KEY)?;
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let k = crypto::derive(&master, purpose);
    let body = crypto::open(&k, &nonce, p.aad, p.ciphertext)?;
    serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)
}

/// 小さなファイル（世帯の札・明細の辞書）の見出しの親鍵の鍵ID（暗号は外さない。入れ替えの後に古い時代のまま残ったものを探す）
fn peek_small_master(magic: &[u8; 4], bytes: &[u8]) -> Result<String, StoreError> {
    let p = container::split(magic, bytes)?;
    let h: SmallHeader = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    Ok(h.master_key_id)
}

pub fn peek_card_master(bytes: &[u8]) -> Result<String, StoreError> {
    peek_small_master(CARD_MAGIC, bytes)
}

pub fn peek_statement_dict_master(bytes: &[u8]) -> Result<String, StoreError> {
    peek_small_master(STATEMENT_DICT_MAGIC, bytes)
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
    /// 番号の中身（区分・通し番号・枝番・見本。0033）。欄の無い札は区分なしの自由な番号
    #[serde(flatten)]
    pub label: Label,
    /// この版が知らない欄（MINOR の新しいアプリが足した欄。保存で札を書き直すときに残す。`label` の後に置く）
    #[serde(flatten, default)]
    pub extra: Extra,
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

/// 明細の取り込みでそのメンバーが覚えた辞書と形のファイル（0034）
pub fn encode_statement_dict(
    office_id: &str,
    master_key_id: &str,
    member_id: &str,
    v: &crate::statement_dict::StatementOffice,
    master: &[u8; KEY_LEN],
) -> Vec<u8> {
    seal_small(
        STATEMENT_DICT_MAGIC,
        STATEMENT_DICT_FORMAT,
        purpose::STATEMENT_DICT,
        office_id,
        master_key_id,
        STATEMENT_DICT_SCOPE,
        Some(member_id),
        v,
        master,
    )
}

pub fn open_statement_dict(
    bytes: &[u8],
    member_id: &str,
    master_for: impl Fn(&str) -> Option<Key>,
) -> Result<crate::statement_dict::StatementOffice, StoreError> {
    open_small(
        STATEMENT_DICT_MAGIC,
        STATEMENT_DICT_FORMAT,
        purpose::STATEMENT_DICT,
        bytes,
        STATEMENT_DICT_SCOPE,
        Some(member_id),
        master_for,
    )
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
        check_shared_version(&self.format_version)?;
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
            events: vec![],
            closed: None,
            usage: None,
            categories: None,
            updated_at: "2026-10-19T00:00:00Z".into(),
            updated_by: None,
            extra: Default::default(),
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
            extra: Default::default(),
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
    fn roster_history_closed_mark_and_verification_round_trip() {
        let a = MemberKeys::generate();
        let ma = member_of(&a, "Aさん");
        let mut r = roster(&crypto::new_uuid(), vec![ma.clone()]);
        for i in 0..(MAX_ROSTER_EVENTS + 3) {
            r.push_event(RosterEvent {
                kind: EVENT_RECOVERY_JOIN.into(),
                member_id: if i == MAX_ROSTER_EVENTS + 2 {
                    ma.member_id.clone()
                } else {
                    crypto::new_uuid()
                },
                display_name: "Aさん".into(),
                at: format!("2026-10-19T00:00:{:02}Z", i % 60),
                extra: Default::default(),
            });
        }
        assert_eq!(r.events.len(), MAX_ROSTER_EVENTS, "古い行から消す");
        r.recovery = Some(RecoveryAck {
            master_key_id: r.master_key_id.clone(),
            acknowledged_at: "x".into(),
            acknowledged_by: ma.member_id.clone(),
            verified_at: Some("y".into()),
            verified_by: Some(ma.member_id.clone()),
            extra: Default::default(),
        });
        r.closed = Some(ClosedMark {
            closed_at: "z".into(),
            closed_by: ma.member_id.clone(),
            extra: Default::default(),
        });
        r.usage = Some(USAGE_PERSONAL.into());
        let m = crypto::random_key();
        let back = open_roster_with_master(&encode_roster(&r, &m).unwrap(), &m).unwrap();
        assert!(back.personal());
        assert_eq!(back.events, r.events);
        assert_eq!(back.recovery, r.recovery);
        assert_eq!(back.closed, r.closed);
        assert!(back.joined_by_recovery(&ma.member_id));
        assert!(!back.joined_by_recovery(&crypto::new_uuid()));
        // 履歴・終えた印・確かめた記録の無い名簿（前の形）もそのまま読める
        let plain = roster(&crypto::new_uuid(), vec![ma]);
        let back = open_roster_with_master(&encode_roster(&plain, &m).unwrap(), &m).unwrap();
        assert!(back.events.is_empty() && back.closed.is_none() && back.recovery.is_none());
        // 使い方の欄の無い名簿は、事務所での共有として読む（0024）
        assert!(back.usage.is_none() && !back.personal());
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
            label: Label {
                category: Some("A".into()),
                serial: Some(1),
                branch: None,
                sample: None,
                fictional: false,
            },
            extra: Default::default(),
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

    /// 名簿・小さなファイルの形式の版を書き換えた写し（試験用。見出しと本文の両方の版を変える）
    fn with_version(
        bytes: &[u8],
        magic: &[u8; 4],
        purpose: &str,
        master: &Key,
        v: &str,
    ) -> Vec<u8> {
        let p = container::split(magic, bytes).unwrap();
        let mut h: Value = serde_json::from_slice(p.header).unwrap();
        let nonce: [u8; NONCE_LEN] = crypto::hex_array(h["nonce"].as_str().unwrap()).unwrap();
        let k = crypto::derive(master, purpose);
        let body = crypto::open(&k, &nonce, p.aad, p.ciphertext).unwrap();
        let mut b: Value = serde_json::from_slice(&body).unwrap();
        if b.get("formatVersion").is_some() {
            b["formatVersion"] = v.into();
        }
        h["formatVersion"] = v.into();
        container::seal(
            magic,
            &container::header_json(&h),
            &k,
            &nonce,
            &serde_json::to_vec(&b).unwrap(),
        )
    }

    #[test]
    fn newer_major_files_are_not_used_and_newer_minor_files_are_read() {
        let a = MemberKeys::generate();
        let ma = member_of(&a, "Aさん");
        let r = roster(&crypto::new_uuid(), vec![ma.clone()]);
        let m = crypto::random_key();
        let bytes = encode_roster(&r, &m).unwrap();
        let minor = with_version(&bytes, MEMBERS_MAGIC, purpose::OFFICE_MEMBERS, &m, "0.9");
        assert!(open_roster(&minor, &a, &ma.member_id).is_ok());
        let major = with_version(&bytes, MEMBERS_MAGIC, purpose::OFFICE_MEMBERS, &m, "1.0");
        assert_eq!(
            open_roster(&major, &a, &ma.member_id).err(),
            Some(StoreError::OFFICE_FORMAT_TOO_NEW)
        );
        let broken = with_version(&bytes, MEMBERS_MAGIC, purpose::OFFICE_MEMBERS, &m, "1");
        assert_eq!(
            open_roster(&broken, &a, &ma.member_id).err(),
            Some(StoreError::CORRUPT)
        );
        // 世帯の札・世帯の鍵の札・参加の申請・office.json も同じ
        let h = crypto::new_uuid();
        let card = Card {
            customer_no: "A0001".into(),
            summary: "本人".into(),
            created_at: "x".into(),
            updated_at: "y".into(),
            updated_by: None,
            generation: 1,
            label: Label::default(),
            extra: Extra::default(),
        };
        let cb = encode_card(&r.office_id, &r.master_key_id, &h, &card, &m);
        let lookup = |_: &str| Some(m.clone());
        let cb2 = with_version(&cb, CARD_MAGIC, purpose::HOUSEHOLD_CARD, &m, "2.3");
        assert_eq!(
            open_card(&cb2, &h, lookup).err(),
            Some(StoreError::OFFICE_FORMAT_TOO_NEW)
        );
        let kb = encode_keys(
            &r.office_id,
            &r.master_key_id,
            &h,
            &HouseholdKeys::new(),
            &m,
        );
        let kb2 = with_version(&kb, KEYS_MAGIC, purpose::HOUSEHOLD_KEYS, &m, "1.0");
        assert_eq!(
            open_keys(&kb2, &h, &m).err(),
            Some(StoreError::OFFICE_FORMAT_TOO_NEW)
        );
        let req = |v: &str| JoinRequest {
            format: REQUEST_FORMAT.into(),
            format_version: v.into(),
            office_id: r.office_id.clone(),
            member_id: crypto::new_uuid(),
            display_name: "Bさん".into(),
            public_key: a.public_hex(),
            requested_at: "x".into(),
        };
        assert!(req("0.7").checked(&r.office_id).is_ok());
        assert_eq!(
            req("1.0").checked(&r.office_id).err(),
            Some(StoreError::OFFICE_FORMAT_TOO_NEW)
        );
        assert_eq!(check_shared_version(SHARED_FORMAT_VERSION), Ok(()));
    }

    #[test]
    fn unknown_fields_survive_a_round_trip() {
        // 世帯の札: 番号の中身（label）の欄は label に入り、知らない欄だけが extra に入る（同じキーを2度書かない）
        let json = serde_json::json!({
            "customerNo": "A0042", "summary": "本人", "createdAt": "x", "updatedAt": "y",
            "generation": 2, "category": "A", "serial": 42, "futureTag": ["顧問"], "futureNo": 1
        });
        let c: Card = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(c.label.category.as_deref(), Some("A"));
        assert_eq!(c.label.serial, Some(42));
        assert_eq!(c.extra.len(), 2);
        assert!(c.extra.contains_key("futureTag") && c.extra.contains_key("futureNo"));
        let text = serde_json::to_string(&c).unwrap();
        assert_eq!(text.matches("\"category\"").count(), 1);
        let back: Value = serde_json::from_str(&text).unwrap();
        let mut expected = json;
        expected["updatedBy"] = Value::Null;
        assert_eq!(back, expected);
        // 名簿: 本文・メンバー・外したメンバー・履歴の知らない欄
        let a = MemberKeys::generate();
        let mut ma = member_of(&a, "Aさん");
        ma.extra.insert("futurePermission".into(), "all".into());
        let mut r = roster(&crypto::new_uuid(), vec![ma]);
        r.extra
            .insert("futureOffice".into(), serde_json::json!({"n": 1}));
        r.removed.push(RemovedMember {
            member_id: crypto::new_uuid(),
            display_name: "Bさん".into(),
            removed_at: "x".into(),
            removed_by: None,
            extra: [("futureReason".to_owned(), Value::from("PCをなくした"))]
                .into_iter()
                .collect(),
        });
        let m = crypto::random_key();
        let back = open_roster_with_master(&encode_roster(&r, &m).unwrap(), &m).unwrap();
        assert_eq!(back.extra, r.extra);
        assert_eq!(back.members, r.members);
        assert_eq!(back.removed, r.removed);
        // 知らない欄が無ければ書かない（今までの形のまま）
        let plain = roster(&crypto::new_uuid(), vec![member_of(&a, "Aさん")]);
        let text = serde_json::to_string(&plain.members[0]).unwrap();
        assert!(!text.contains("extra"));
    }

    #[test]
    fn unknown_roles_cannot_edit() {
        let a = MemberKeys::generate();
        let mut m = member_of(&a, "Aさん");
        assert!(m.can_edit());
        m.role = "viewer".into();
        assert!(!m.can_edit());
        m.role = String::new();
        assert!(!m.can_edit());
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
