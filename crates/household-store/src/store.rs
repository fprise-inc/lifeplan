//! データフォルダの世帯ファイル・鍵置き場・事務所データをまとめて扱う（0011・0013）。
//!
//! データフォルダの中（アプリが決めた場所に固定。画面からは選べず、パスも画面に渡さない。0016 の1）:
//!
//! ```text
//! office.json                 事務所ID（平文。保管庫の項目のアカウント名を知るため）
//! device.json                 PCのID（平文。インストールしたときの乱数。0012）
//! office.lpod                 事務所データ（親鍵から導いた鍵で暗号化）: 世帯の一覧・前回開いた世帯・復元キーの記録・削除の記録
//! households/<世帯ID>.lphf    世帯ファイル（＋ .prev が直前の世代）
//! conflicts/                  分岐を見つけたときに、こちらの保存を残す場所（0011 の7）
//! keys/vault.lpkv             鍵置き場（＋ .prev）。OS のバックアップから外す（0013 の4）
//! keys/backups/<日付>.lpkv    鍵置き場の日ごとの世代（最大30日。作った世代は書き換えない）
//! backups/<日付>/             世帯ファイルと事務所データの毎日の写し（暗号化のまま。30世代）
//! ```

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::atomic::{self, FailPoint};
use crate::container::{self, HouseholdHeader};
use crate::crypto::{self, purpose, Key, NONCE_LEN};
use crate::migrate::{self, Access};
use crate::recovery;
use crate::secret::SecretStore;
use crate::vault::Vault;
use crate::{StoreError, HOUSEHOLD_EXT, HOUSEHOLD_FORMAT};

const OFFICE_FILE: &str = "office.json";
const DEVICE_FILE: &str = "device.json";
const OFFICE_DATA_FILE: &str = "office.lpod";
const HOUSEHOLDS_DIR: &str = "households";
const CONFLICTS_DIR: &str = "conflicts";
const KEYS_DIR: &str = "keys";
const VAULT_FILE: &str = "vault.lpkv";
const KEY_BACKUPS_DIR: &str = "backups";
const BACKUPS_DIR: &str = "backups";

const OFFICE_MAGIC: &[u8; 4] = b"LPOD";
const OFFICE_FORMAT: &str = "lifeplan.officeData";
const OFFICE_FORMAT_VERSION: &str = "0.1";

/// 世帯ファイルと事務所データの毎日の写しの世代数（0011 の6・0013 の4）
pub const BACKUP_GENERATIONS: usize = 30;
/// 鍵置き場の日ごとの世代を持つ日数（0013 の4。31日目には消す）
pub const KEY_BACKUP_DAYS: i64 = 30;
/// 本文の大きさの上限
const MAX_BODY: usize = 64 * 1024 * 1024;
/// 一覧に出す世帯の構成の要約の長さの上限（例: 本人・配偶者・子2人）
const MAX_SUMMARY: usize = 60;

/// 時計（テストで日付を進められるように差し替える）
pub trait Clock: Send + Sync {
    /// 1970-01-01 からの秒（UTC）
    fn now_unix(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficeFile {
    format: String,
    format_version: String,
    office_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceFile {
    device_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    customer_no: String,
    summary: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRecord {
    acknowledged_at: Option<String>,
    verified_at: Option<String>,
}

/// 削除の記録（世帯の内部IDと日付だけ。0013 の5）
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Deletion {
    household_id: String,
    on: String,
}

/// 事務所データ（暗号化して保存）
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficeData {
    format_version: String,
    households: BTreeMap<String, CatalogEntry>,
    last_opened: Option<String>,
    recovery: RecoveryRecord,
    deletions: Vec<Deletion>,
    /// 表示用の顧客番号の接頭辞（PCごと。0012 の1）と次の連番
    customer_no_prefix: String,
    customer_no_next: u32,
}

impl OfficeData {
    fn new(device_id: &str) -> OfficeData {
        // 接頭辞の初期値は PCのID から決める（0012 の1。書式は未確定のため仮: 英大文字1字＋4桁）
        let b = crypto::hex_decode(&device_id.replace('-', "")[..2])
            .map(|v| v[0])
            .unwrap_or(0);
        OfficeData {
            format_version: OFFICE_FORMAT_VERSION.to_owned(),
            households: BTreeMap::new(),
            last_opened: None,
            recovery: RecoveryRecord::default(),
            deletions: vec![],
            customer_no_prefix: ((b'A' + b % 26) as char).to_string(),
            customer_no_next: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusState {
    Ready,
    /// 保管庫に親鍵が無い（または鍵置き場と合わない）: 復元キーを入れる
    NeedsRecovery,
}

/// 画面に返す状態（パスは含めない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: StatusState,
    /// この起動で事務所データを初めて作った（復元キーの案内を出す）
    pub first_run: bool,
    pub recovery_acknowledged: bool,
    pub recovery_verified_at: Option<String>,
    pub last_opened: Option<String>,
    /// 削除してから30日たっていない世帯の数（バックアップからも読めなくなるのを待っている）
    pub deletions_pending: usize,
    pub deletions_completed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdEntry {
    pub id: String,
    pub customer_no: String,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 開いた世帯（本文は JSON の文字列）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub id: String,
    pub customer_no: String,
    pub body: String,
    /// MINOR だけが新しい形式: 閲覧だけ
    pub read_only: bool,
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub generation: u64,
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub customer_no: String,
    /// 同じ番号の世帯がほかにある（禁止はしない。0012 の1）
    pub duplicate: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub body: String,
    pub summary: String,
}

struct Session {
    office_id: String,
    device_id: String,
    master: Key,
    vault: Vault,
    data: OfficeData,
}

struct OpenState {
    parent_revision: String,
    generation: u64,
    read_only: bool,
}

#[derive(Default)]
struct Inner {
    session: Option<Session>,
    needs_recovery: bool,
    first_run: bool,
    opened: HashMap<String, OpenState>,
    fail: FailPoint,
}

pub struct Store {
    root: PathBuf,
    secrets: Box<dyn SecretStore>,
    clock: Box<dyn Clock>,
    app_version: String,
    exclude_keys_from_os_backup: bool,
    inner: Mutex<Inner>,
}

// ---- 日付（UTC） ----

fn civil(days: i64) -> (i64, u32, u32) {
    // 1970-01-01 からの日数 → 年月日（よく知られた暦の計算）
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn date_of(unix: i64) -> String {
    let (y, m, d) = civil(unix.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

fn iso_of(unix: i64) -> String {
    let s = unix.rem_euclid(86_400);
    format!(
        "{}T{:02}:{:02}:{:02}Z",
        date_of(unix),
        s / 3600,
        s / 60 % 60,
        s % 60
    )
}

/// "YYYY-MM-DD" → 1970-01-01 からの日数
fn parse_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y = s[0..4].parse().ok()?;
    let m = s[5..7].parse().ok()?;
    let d = s[8..10].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

// ---- 検査 ----

/// 表示用の顧客番号の書式（英数字・ハイフン・下線、16字まで。氏名は入れない。0012）
pub fn valid_customer_no(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 16
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn valid_summary(s: &str) -> bool {
    s.chars().count() <= MAX_SUMMARY && !s.chars().any(char::is_control)
}

fn parse_body(body: &str) -> Result<serde_json::Map<String, Value>, StoreError> {
    if body.len() > MAX_BODY {
        return Err(StoreError::BODY);
    }
    match serde_json::from_str::<Value>(body) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err(StoreError::BODY),
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(p: &Path) -> Result<Option<T>, StoreError> {
    match fs::read(p) {
        Ok(b) => serde_json::from_slice(&b)
            .map(Some)
            .map_err(|_| StoreError::CORRUPT),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(StoreError::IO),
    }
}

fn write_json<T: Serialize>(p: &Path, v: &T) -> Result<(), StoreError> {
    atomic::replace(
        p,
        &serde_json::to_vec_pretty(v).expect("JSON"),
        FailPoint::None,
    )?;
    Ok(())
}

fn encode_office(data: &OfficeData, office_id: &str, master: &[u8; 32]) -> Vec<u8> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct H<'a> {
        cipher: &'a str,
        format: &'a str,
        format_version: &'a str,
        nonce: String,
        office_id: &'a str,
    }
    let nonce = crypto::random_nonce();
    let h = H {
        cipher: crypto::CIPHER,
        format: OFFICE_FORMAT,
        format_version: OFFICE_FORMAT_VERSION,
        nonce: crypto::hex_encode(&nonce),
        office_id,
    };
    let body = Zeroizing::new(serde_json::to_vec(data).expect("事務所データの JSON"));
    let k = crypto::derive(master, purpose::OFFICE_DATA);
    container::seal(OFFICE_MAGIC, &container::header_json(&h), &k, &nonce, &body)
}

fn decode_office(bytes: &[u8], master: &[u8; 32]) -> Result<OfficeData, StoreError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct H {
        cipher: String,
        format: String,
        nonce: String,
    }
    let p = container::split(OFFICE_MAGIC, bytes)?;
    let h: H = serde_json::from_slice(p.header).map_err(|_| StoreError::CORRUPT)?;
    if h.format != OFFICE_FORMAT || h.cipher != crypto::CIPHER {
        return Err(StoreError::CORRUPT);
    }
    let nonce: [u8; NONCE_LEN] = crypto::hex_array(&h.nonce).ok_or(StoreError::CORRUPT)?;
    let k = crypto::derive(master, purpose::OFFICE_DATA);
    let body = crypto::open(&k, &nonce, p.aad, p.ciphertext)?;
    serde_json::from_slice(&body).map_err(|_| StoreError::CORRUPT)
}

/// 世帯ファイルの名前から世帯ID（`<ID>.lphf`・`.prev`・`.tmp-*`）
fn household_id_of(file_name: &str) -> Option<&str> {
    let id = file_name.get(..36)?;
    let rest = &file_name[36..];
    let ext = format!(".{HOUSEHOLD_EXT}");
    (crypto::is_uuid(id) && rest.starts_with(&ext)).then_some(id)
}

impl Store {
    /// データフォルダ `root` を使う。まだ何も読まない（最初の [`Store::status`] で準備する）
    pub fn new(
        root: PathBuf,
        secrets: impl SecretStore + 'static,
        clock: impl Clock + 'static,
        app_version: &str,
    ) -> Store {
        Store {
            root,
            secrets: Box::new(secrets),
            clock: Box::new(clock),
            app_version: app_version.to_owned(),
            exclude_keys_from_os_backup: false,
            inner: Mutex::new(Inner::default()),
        }
    }

    /// 鍵置き場のフォルダを OS のバックアップから外す（0013 の4。Mac は OS のバックアップの除外の印）。アプリ本体だけが使う
    pub fn exclude_keys_from_os_backup(mut self) -> Store {
        self.exclude_keys_from_os_backup = true;
        self
    }

    /// 試験用: 次からの保存を、指定の段階で止める
    #[doc(hidden)]
    pub fn set_fail_point(&self, fp: FailPoint) {
        self.lock().fail = fp;
    }

    /// 試験用: 開いている状態を忘れる（アプリを閉じて開き直した代わり）
    #[doc(hidden)]
    pub fn forget_session(&self) {
        let mut g = self.lock();
        *g = Inner::default();
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn now(&self) -> i64 {
        self.clock.now_unix()
    }

    fn households_dir(&self) -> PathBuf {
        self.root.join(HOUSEHOLDS_DIR)
    }

    fn household_path(&self, id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(id));
        self.households_dir().join(format!("{id}.{HOUSEHOLD_EXT}"))
    }

    fn vault_path(&self) -> PathBuf {
        self.root.join(KEYS_DIR).join(VAULT_FILE)
    }

    fn office_data_path(&self) -> PathBuf {
        self.root.join(OFFICE_DATA_FILE)
    }

    // ---- 準備 ----

    /// 状態（初回は事務所データ・親鍵・鍵置き場を作る。起動時の片付けと毎日のバックアップもここで行う）
    pub fn status(&self) -> Result<Status, StoreError> {
        let mut g = self.lock();
        if g.session.is_none() {
            self.load(&mut g)?;
        }
        Ok(self.status_of(&g))
    }

    fn status_of(&self, g: &Inner) -> Status {
        let today = self.now().div_euclid(86_400);
        let (pending, done) = g.session.as_ref().map_or((0, 0), |s| {
            let p = s
                .data
                .deletions
                .iter()
                .filter(|d| parse_date(&d.on).is_none_or(|on| today - on < KEY_BACKUP_DAYS))
                .count();
            (p, s.data.deletions.len() - p)
        });
        Status {
            state: if g.session.is_some() {
                StatusState::Ready
            } else {
                StatusState::NeedsRecovery
            },
            first_run: g.first_run,
            recovery_acknowledged: g
                .session
                .as_ref()
                .is_some_and(|s| s.data.recovery.acknowledged_at.is_some()),
            recovery_verified_at: g
                .session
                .as_ref()
                .and_then(|s| s.data.recovery.verified_at.clone()),
            last_opened: g.session.as_ref().and_then(|s| s.data.last_opened.clone()),
            deletions_pending: pending,
            deletions_completed: done,
        }
    }

    fn device_id(&self) -> Result<String, StoreError> {
        let p = self.root.join(DEVICE_FILE);
        if let Some(d) = read_json::<DeviceFile>(&p)? {
            if crypto::is_uuid(&d.device_id) {
                return Ok(d.device_id);
            }
        }
        let d = DeviceFile {
            device_id: crypto::new_uuid(),
        };
        write_json(&p, &d)?;
        Ok(d.device_id)
    }

    fn master_of(&self, office_id: &str) -> Result<Option<Key>, StoreError> {
        Ok(match self.secrets.get(office_id)? {
            Some(s) => Some(crypto::key_from_hex(s.trim()).ok_or(StoreError::NEEDS_RECOVERY)?),
            None => None,
        })
    }

    fn ensure_keys_dir(&self) -> Result<(), StoreError> {
        let dir = self.root.join(KEYS_DIR);
        if !dir.exists() {
            fs::create_dir_all(dir.join(KEY_BACKUPS_DIR))?;
            if self.exclude_keys_from_os_backup {
                exclude_from_os_backup(&dir);
            }
        }
        Ok(())
    }

    fn load(&self, g: &mut Inner) -> Result<(), StoreError> {
        fs::create_dir_all(&self.root)?;
        let device_id = self.device_id()?;
        let office_path = self.root.join(OFFICE_FILE);
        let office_id = match read_json::<OfficeFile>(&office_path)? {
            Some(o) if crypto::is_uuid(&o.office_id) => o.office_id,
            Some(_) => return Err(StoreError::CORRUPT),
            None => {
                // office.json だけが消えた: 鍵置き場の見出しから事務所IDを戻す
                let from_vault = fs::read(self.vault_path())
                    .ok()
                    .and_then(|b| Vault::peek_office_id(&b).ok());
                match from_vault {
                    Some(id) if crypto::is_uuid(&id) => {
                        write_json(
                            &office_path,
                            &OfficeFile {
                                format: "lifeplan.office".into(),
                                format_version: "0.1".into(),
                                office_id: id.clone(),
                            },
                        )?;
                        id
                    }
                    _ => return self.create_office(g, &device_id),
                }
            }
        };
        let Some(master) = self.master_of(&office_id)? else {
            g.needs_recovery = true;
            return Ok(());
        };
        self.open_office(g, office_id, device_id, master)
    }

    /// 初回: 事務所ID・親鍵（保管庫へ）・空の鍵置き場・事務所データを作る
    fn create_office(&self, g: &mut Inner, device_id: &str) -> Result<(), StoreError> {
        let office_id = crypto::new_uuid();
        let master = crypto::random_key();
        self.secrets.set(
            &office_id,
            &Zeroizing::new(crypto::hex_encode(master.as_ref())),
        )?;
        self.ensure_keys_dir()?;
        let vault = Vault::new(&office_id, &crypto::new_uuid());
        atomic::replace(&self.vault_path(), &vault.encode(&master), FailPoint::None)?;
        let data = OfficeData::new(device_id);
        atomic::replace(
            &self.office_data_path(),
            &encode_office(&data, &office_id, &master),
            FailPoint::None,
        )?;
        // 最後に事務所IDを書く（ここまでで止まったら、次の起動で作り直す）
        write_json(
            &self.root.join(OFFICE_FILE),
            &OfficeFile {
                format: "lifeplan.office".into(),
                format_version: "0.1".into(),
                office_id: office_id.clone(),
            },
        )?;
        g.first_run = true;
        g.needs_recovery = false;
        g.session = Some(Session {
            office_id,
            device_id: device_id.to_owned(),
            master,
            vault,
            data,
        });
        self.daily_backup(g.session.as_ref().unwrap());
        Ok(())
    }

    fn open_office(
        &self,
        g: &mut Inner,
        office_id: String,
        device_id: String,
        master: Key,
    ) -> Result<(), StoreError> {
        self.ensure_keys_dir()?;
        // 起動時の片付け（鍵置き場・事務所データ）。開けることを確かめてから戻す
        let m = master.clone();
        atomic::recover(&self.vault_path(), |b| Vault::decode(b, &m).ok().map(|_| 0))?;
        let vault = match fs::read(self.vault_path()) {
            Ok(b) => match Vault::decode(&b, &master) {
                Ok(v) => v,
                Err(StoreError::WRONG_MASTER) => {
                    g.needs_recovery = true;
                    return Ok(());
                }
                Err(e) => return Err(e),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // 鍵置き場が無い: 世帯ファイルも無ければ作り直す。世帯ファイルがあるのに無いなら壊れ（勝手に作り直さない）
                if self.household_files().is_empty() {
                    let v = Vault::new(&office_id, &crypto::new_uuid());
                    atomic::replace(&self.vault_path(), &v.encode(&master), FailPoint::None)?;
                    v
                } else {
                    return Err(StoreError::CORRUPT);
                }
            }
            Err(_) => return Err(StoreError::IO),
        };
        atomic::recover(&self.office_data_path(), |b| {
            decode_office(b, &m).ok().map(|_| 0)
        })?;
        let data = match fs::read(self.office_data_path()) {
            Ok(b) => decode_office(&b, &master)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => OfficeData::new(&device_id),
            Err(_) => return Err(StoreError::IO),
        };
        let mut s = Session {
            office_id,
            device_id,
            master,
            vault,
            data,
        };
        // 世帯ファイルの片付け（今のファイルが無く、一時ファイルか .prev だけがある世帯も戻す）
        for id in self.household_files() {
            if let Ok((_, key)) = s.vault.unwrap_key(&s.master, &id) {
                let _ = atomic::recover(&self.household_path(&id), |b| {
                    container::open_household(b, &key)
                        .ok()
                        .map(|(h, _)| h.generation)
                });
            }
        }
        // 一覧に無い世帯ファイル（事務所データが古い世代に戻った場合など）を一覧に戻す
        let missing: Vec<String> = self
            .household_files()
            .into_iter()
            .filter(|id| !s.data.households.contains_key(id) && s.vault.contains(id))
            .collect();
        if !missing.is_empty() {
            for id in missing {
                if let Some(entry) = self.catalog_from_file(&s, &id) {
                    s.data.households.insert(id, entry);
                }
            }
            self.write_office(&s)?;
        }
        g.needs_recovery = false;
        self.daily_backup(&s);
        g.session = Some(s);
        Ok(())
    }

    /// 世帯ファイルの本文から一覧の欄を作り直す
    fn catalog_from_file(&self, s: &Session, id: &str) -> Option<CatalogEntry> {
        let bytes = fs::read(self.household_path(id)).ok()?;
        let (_, key) = s.vault.unwrap_key(&s.master, id).ok()?;
        let (_, body) = container::open_household(&bytes, &key).ok()?;
        let v: Value = serde_json::from_slice(&body).ok()?;
        let meta = v.get("meta");
        let text = |k: &str| {
            meta.and_then(|m| m.get(k))
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        let saved = text("savedAt").unwrap_or_default();
        Some(CatalogEntry {
            customer_no: text("customerNo")
                .filter(|c| valid_customer_no(c))
                .unwrap_or_else(|| "NO-NUMBER".into()),
            summary: String::new(),
            created_at: saved.clone(),
            updated_at: saved,
        })
    }

    /// データフォルダの世帯ファイルの世帯ID（今のファイル・.prev・一時ファイルのどれかがあるもの）
    fn household_files(&self) -> Vec<String> {
        let mut ids: Vec<String> = fs::read_dir(self.households_dir())
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter_map(|e| {
                        household_id_of(&e.file_name().to_string_lossy()).map(str::to_owned)
                    })
                    .collect()
            })
            .unwrap_or_default();
        ids.sort();
        ids.dedup();
        ids
    }

    fn write_vault(&self, s: &Session) -> Result<(), StoreError> {
        atomic::replace(
            &self.vault_path(),
            &s.vault.encode(&s.master),
            FailPoint::None,
        )?;
        Ok(())
    }

    fn write_office(&self, s: &Session) -> Result<(), StoreError> {
        atomic::replace(
            &self.office_data_path(),
            &encode_office(&s.data, &s.office_id, &s.master),
            FailPoint::None,
        )?;
        Ok(())
    }

    fn session(g: &mut Inner) -> Result<&mut Session, StoreError> {
        g.session.as_mut().ok_or(StoreError::NEEDS_RECOVERY)
    }

    // ---- 世帯 ----

    /// 世帯の一覧（新しく保存した順）
    pub fn list(&self) -> Result<Vec<HouseholdEntry>, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let mut v: Vec<HouseholdEntry> = s
            .data
            .households
            .iter()
            .map(|(id, e)| HouseholdEntry {
                id: id.clone(),
                customer_no: e.customer_no.clone(),
                summary: e.summary.clone(),
                created_at: e.created_at.clone(),
                updated_at: e.updated_at.clone(),
            })
            .collect();
        v.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then(a.customer_no.cmp(&b.customer_no))
        });
        Ok(v)
    }

    fn next_customer_no(data: &mut OfficeData) -> String {
        loop {
            let c = format!("{}{:04}", data.customer_no_prefix, data.customer_no_next);
            data.customer_no_next += 1;
            if !data.households.values().any(|e| e.customer_no == c) {
                return c;
            }
        }
    }

    /// 本文の meta（形式名・形式の版・保存日時・保存したアプリの版・表示用の顧客番号）を入れる（0011 の2）
    fn with_meta(
        &self,
        mut body: serde_json::Map<String, Value>,
        customer_no: &str,
        saved_at: &str,
    ) -> Vec<u8> {
        let mut meta = match body.remove("meta") {
            Some(Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        };
        meta.insert("format".into(), HOUSEHOLD_FORMAT.into());
        meta.insert("formatVersion".into(), migrate::CURRENT.into());
        meta.insert("savedAt".into(), saved_at.into());
        meta.insert("appVersion".into(), self.app_version.clone().into());
        meta.insert("customerNo".into(), customer_no.into());
        body.insert("meta".into(), Value::Object(meta));
        serde_json::to_vec(&Value::Object(body)).expect("本文の JSON")
    }

    /// 新しい世帯を作って保存し、開いた状態にする（世帯の内部IDと世帯の鍵はここで作る）
    pub fn create(&self, req: CreateRequest) -> Result<Opened, StoreError> {
        let body = parse_body(&req.body)?;
        if !valid_summary(&req.summary) {
            return Err(StoreError::BODY);
        }
        let mut g = self.lock();
        let fail = g.fail;
        let now = self.now();
        let s = Self::session(&mut g)?;
        let id = crypto::new_uuid();
        let (key_id, key) = s.vault.insert_new(&s.master, &id);
        if let Err(e) = self.write_vault(s) {
            s.vault.remove(&id);
            return Err(e);
        }
        let mut data = s.data.clone();
        let customer_no = Self::next_customer_no(&mut data);
        let saved_at = iso_of(now);
        let plain = Zeroizing::new(self.with_meta(body, &customer_no, &saved_at));
        let header = HouseholdHeader {
            cipher: String::new(),
            compression: "none".into(),
            device_id: s.device_id.clone(),
            format: HOUSEHOLD_FORMAT.into(),
            format_version: migrate::CURRENT.into(),
            generation: 1,
            household_id: id.clone(),
            key_id,
            nonce: String::new(),
            parent_revision: None,
        };
        let bytes = container::seal_household(header, &key, &plain);
        atomic::replace(&self.household_path(&id), &bytes, fail)?;
        data.households.insert(
            id.clone(),
            CatalogEntry {
                customer_no: customer_no.clone(),
                summary: req.summary.clone(),
                created_at: saved_at.clone(),
                updated_at: saved_at,
            },
        );
        data.last_opened = Some(id.clone());
        s.data = data;
        self.write_office(s)?;
        g.opened.insert(
            id.clone(),
            OpenState {
                parent_revision: crypto::digest(&bytes),
                generation: 1,
                read_only: false,
            },
        );
        Ok(Opened {
            id,
            customer_no,
            body: String::from_utf8_lossy(&plain).into_owned(),
            read_only: false,
            generation: 1,
        })
    }

    /// 世帯を開く（古い形式の版は今の版へ変換する）
    pub fn open(&self, id: &str) -> Result<Opened, StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let customer_no = s
            .data
            .households
            .get(id)
            .ok_or(StoreError::UNKNOWN_HOUSEHOLD)?
            .customer_no
            .clone();
        let bytes = match fs::read(self.household_path(id)) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StoreError::UNKNOWN_HOUSEHOLD)
            }
            Err(_) => return Err(StoreError::IO),
        };
        let header = container::read_household_header(&bytes)?;
        if header.household_id != id {
            return Err(StoreError::CORRUPT);
        }
        let access = migrate::access(&header.format_version)?;
        let (key_id, key) = s.vault.unwrap_key(&s.master, id)?;
        if header.key_id != key_id {
            return Err(StoreError::CORRUPT);
        }
        let (h, plain) = container::open_household(&bytes, &key)?;
        let value: Value = serde_json::from_slice(&plain).map_err(|_| StoreError::CORRUPT)?;
        let mut value = migrate::upgrade(&h.format_version, value)?;
        if let Some(meta) = value.get_mut("meta").and_then(Value::as_object_mut) {
            meta.insert("customerNo".into(), customer_no.clone().into());
        }
        if s.data.last_opened.as_deref() != Some(id) {
            s.data.last_opened = Some(id.to_owned());
            self.write_office(s)?;
        }
        g.opened.insert(
            id.to_owned(),
            OpenState {
                parent_revision: crypto::digest(&bytes),
                generation: h.generation,
                read_only: access == Access::ReadOnly,
            },
        );
        Ok(Opened {
            id: id.to_owned(),
            customer_no,
            body: serde_json::to_string(&value).expect("本文の JSON"),
            read_only: access == Access::ReadOnly,
            generation: h.generation,
        })
    }

    /// 開いている世帯を保存する（一時ファイルに書いて差し替え、直前の世代を残す）。
    /// 開いた後に別の保存が先にあった（今のファイルの指紋が開いたときと違う）ときは、上書きせず、こちらの内容を
    /// `conflicts/` に別のファイルとして残して [`StoreError::CONFLICT`] を返す（0011 の7）
    pub fn save(&self, id: &str, body: &str, summary: &str) -> Result<Saved, StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let body = parse_body(body)?;
        if !valid_summary(summary) {
            return Err(StoreError::BODY);
        }
        let mut g = self.lock();
        let fail = g.fail;
        let (parent, generation) = match g.opened.get(id) {
            None => return Err(StoreError::NOT_OPEN),
            Some(st) if st.read_only => return Err(StoreError::READ_ONLY),
            Some(st) => (st.parent_revision.clone(), st.generation),
        };
        let now = self.now();
        let s = Self::session(&mut g)?;
        let customer_no = s
            .data
            .households
            .get(id)
            .ok_or(StoreError::UNKNOWN_HOUSEHOLD)?
            .customer_no
            .clone();
        let (key_id, key) = s.vault.unwrap_key(&s.master, id)?;
        let saved_at = iso_of(now);
        let plain = Zeroizing::new(self.with_meta(body, &customer_no, &saved_at));
        let header = HouseholdHeader {
            cipher: String::new(),
            compression: "none".into(),
            device_id: s.device_id.clone(),
            format: HOUSEHOLD_FORMAT.into(),
            format_version: migrate::CURRENT.into(),
            generation: generation + 1,
            household_id: id.to_owned(),
            key_id,
            nonce: String::new(),
            parent_revision: Some(parent.clone()),
        };
        let bytes = container::seal_household(header, &key, &plain);
        let path = self.household_path(id);
        let current = fs::read(&path).ok().map(|b| crypto::digest(&b));
        if current.as_deref() != Some(parent.as_str()) {
            let mut r = [0u8; 4];
            crypto::fill_random(&mut r);
            let aside = self.root.join(CONFLICTS_DIR).join(format!(
                "{id}.{HOUSEHOLD_EXT}.conflict-{}-{}",
                generation + 1,
                crypto::hex_encode(&r)
            ));
            atomic::replace(&aside, &bytes, FailPoint::None)?;
            return Err(StoreError::CONFLICT);
        }
        atomic::replace(&path, &bytes, fail)?;
        if let Some(e) = s.data.households.get_mut(id) {
            e.updated_at = saved_at.clone();
            e.summary = summary.to_owned();
        }
        self.write_office(s)?;
        self.daily_backup(s);
        g.opened.insert(
            id.to_owned(),
            OpenState {
                parent_revision: crypto::digest(&bytes),
                generation: generation + 1,
                read_only: false,
            },
        );
        Ok(Saved {
            generation: generation + 1,
            saved_at,
        })
    }

    /// 表示用の顧客番号を変える（内部IDは変わらない。同じ番号があっても止めない。0012 の1）
    pub fn rename(&self, id: &str, customer_no: &str) -> Result<RenameOutcome, StoreError> {
        let c = customer_no.trim();
        if !valid_customer_no(c) {
            return Err(StoreError::CUSTOMER_NO);
        }
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        if !s.data.households.contains_key(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let duplicate = s
            .data
            .households
            .iter()
            .any(|(k, e)| k != id && e.customer_no == c);
        if let Some(e) = s.data.households.get_mut(id) {
            e.customer_no = c.to_owned();
        }
        self.write_office(s)?;
        Ok(RenameOutcome {
            customer_no: c.to_owned(),
            duplicate,
        })
    }

    /// 完全削除（0013 の5）: 世帯ファイル・直前の世代・アプリが管理するバックアップの写しを消し、鍵置き場からその世帯の鍵を消す。
    /// 削除の記録（世帯の内部IDと日付だけ）を残す。鍵置き場の古い世代（最大30日）が入れ替わると、どこにも読める鍵が無くなる。
    /// `confirm` は FP が打った顧客番号（取り違えて消さないため）
    pub fn delete(&self, id: &str, confirm: &str) -> Result<(), StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        let entry = s
            .data
            .households
            .get(id)
            .ok_or(StoreError::UNKNOWN_HOUSEHOLD)?;
        if confirm.trim() != entry.customer_no {
            return Err(StoreError::CONFIRM);
        }
        // 1. 世帯ファイル・直前の世代・一時ファイル・分岐の写し
        let path = self.household_path(id);
        for p in [path.clone(), atomic::prev_path(&path)]
            .into_iter()
            .chain(atomic::temp_files(&path))
        {
            remove_if_exists(&p)?;
        }
        for p in files_starting_with(&self.root.join(CONFLICTS_DIR), id) {
            remove_if_exists(&p)?;
        }
        // 3. アプリが管理するバックアップの写し
        for dir in backup_dirs(&self.root.join(BACKUPS_DIR)) {
            remove_if_exists(
                &dir.join(HOUSEHOLDS_DIR)
                    .join(format!("{id}.{HOUSEHOLD_EXT}")),
            )?;
        }
        // 2. 今の鍵置き場から鍵を消す。直前の世代（.prev）にも鍵が残るので、新しい鍵置き場が開けることを確かめてから消す
        s.vault.remove(id);
        self.write_vault(s)?;
        let check = fs::read(self.vault_path()).map_err(|_| StoreError::IO)?;
        let v = Vault::decode(&check, &s.master)?;
        if v.contains(id) {
            return Err(StoreError::CORRUPT);
        }
        remove_if_exists(&atomic::prev_path(&self.vault_path()))?;
        // 4. 削除の記録
        s.data.households.remove(id);
        s.data.deletions.push(Deletion {
            household_id: id.to_owned(),
            on: date_of(now),
        });
        if s.data.last_opened.as_deref() == Some(id) {
            s.data.last_opened = None;
        }
        self.write_office(s)?;
        g.opened.remove(id);
        Ok(())
    }

    // ---- 復元キー（0013 の3） ----

    /// 復元キー（表示の形の72文字）。画面に出すためだけに使う（画面はどこにも保存しない）
    pub fn recovery_key(&self) -> Result<Zeroizing<String>, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        Ok(recovery::encode(&s.master))
    }

    /// 「保管した」を記録する
    pub fn acknowledge_recovery(&self) -> Result<Status, StoreError> {
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        s.data.recovery.acknowledged_at = Some(iso_of(now));
        self.write_office(s)?;
        Ok(self.status_of(&g))
    }

    /// 復元キーで実際に開けるかを試す（データを変えない。開けたら日時を記録する）
    pub fn test_recovery_key(&self, input: &str) -> Result<Status, StoreError> {
        let candidate = recovery::decode(input)?;
        let mut g = self.lock();
        let now = self.now();
        let bytes = fs::read(self.vault_path()).map_err(|_| StoreError::IO)?;
        match Vault::decode(&bytes, &candidate) {
            Ok(_) => {}
            Err(StoreError::WRONG_MASTER) => return Err(StoreError::RECOVERY_MISMATCH),
            Err(e) => return Err(e),
        }
        let s = Self::session(&mut g)?;
        s.data.recovery.verified_at = Some(iso_of(now));
        self.write_office(s)?;
        Ok(self.status_of(&g))
    }

    /// 保管庫から親鍵が消えたとき: 復元キーで鍵置き場が開けることを確かめてから、保管庫に親鍵を入れ直す
    pub fn restore_with_recovery_key(&self, input: &str) -> Result<Status, StoreError> {
        let candidate = recovery::decode(input)?;
        let mut g = self.lock();
        let office: OfficeFile =
            read_json(&self.root.join(OFFICE_FILE))?.ok_or(StoreError::CORRUPT)?;
        let vp = self.vault_path();
        // 今の鍵置き場が無いときは、直前の世代・一時ファイルでも試す
        let candidates = [vp.clone(), atomic::prev_path(&vp)]
            .into_iter()
            .chain(atomic::temp_files(&vp));
        let mut opened = false;
        let mut mismatch = false;
        for p in candidates {
            let Ok(b) = fs::read(&p) else { continue };
            match Vault::decode(&b, &candidate) {
                Ok(_) => {
                    opened = true;
                    break;
                }
                Err(StoreError::WRONG_MASTER) => mismatch = true,
                Err(_) => {}
            }
        }
        if !opened {
            return Err(if mismatch {
                StoreError::RECOVERY_MISMATCH
            } else {
                StoreError::CORRUPT
            });
        }
        self.secrets.set(
            &office.office_id,
            &Zeroizing::new(crypto::hex_encode(candidate.as_ref())),
        )?;
        *g = Inner::default();
        self.load(&mut g)?;
        if g.session.is_none() {
            return Err(StoreError::NEEDS_RECOVERY);
        }
        Ok(self.status_of(&g))
    }

    // ---- 毎日の自動バックアップ（0011 の6・0013 の4） ----

    /// その日の写しがまだ無ければ作り、古い世代を消す。失敗しても保存は止めない
    fn daily_backup(&self, s: &Session) {
        let now = self.now();
        let today = date_of(now);
        let _ = self.backup_households(s, &today);
        let _ = self.backup_vault(&today, now.div_euclid(86_400));
    }

    fn backup_households(&self, s: &Session, today: &str) -> Result<(), StoreError> {
        let base = self.root.join(BACKUPS_DIR);
        let target = base.join(today);
        if !target.exists() {
            let mut r = [0u8; 4];
            crypto::fill_random(&mut r);
            let tmp = base.join(format!(".tmp-{today}-{}", crypto::hex_encode(&r)));
            fs::create_dir_all(tmp.join(HOUSEHOLDS_DIR))?;
            for id in s.data.households.keys() {
                let src = self.household_path(id);
                if src.exists() {
                    fs::copy(
                        &src,
                        tmp.join(HOUSEHOLDS_DIR)
                            .join(format!("{id}.{HOUSEHOLD_EXT}")),
                    )?;
                }
            }
            if self.office_data_path().exists() {
                fs::copy(self.office_data_path(), tmp.join(OFFICE_DATA_FILE))?;
            }
            fs::rename(&tmp, &target)?;
        }
        // 片付け: 途中で止まった一時のフォルダと、30世代より古い写し
        if let Ok(rd) = fs::read_dir(&base) {
            for e in rd.filter_map(|e| e.ok()) {
                if e.file_name().to_string_lossy().starts_with(".tmp-") {
                    let _ = fs::remove_dir_all(e.path());
                }
            }
        }
        let dirs = backup_dirs(&base);
        if dirs.len() > BACKUP_GENERATIONS {
            for d in &dirs[..dirs.len() - BACKUP_GENERATIONS] {
                fs::remove_dir_all(d)?;
            }
        }
        Ok(())
    }

    fn backup_vault(&self, today: &str, today_days: i64) -> Result<(), StoreError> {
        let dir = self.root.join(KEYS_DIR).join(KEY_BACKUPS_DIR);
        fs::create_dir_all(&dir)?;
        let target = dir.join(format!("{today}.lpkv"));
        // 作った世代は後から書き換えない
        if !target.exists() && self.vault_path().exists() {
            let bytes = fs::read(self.vault_path())?;
            atomic::replace(&target, &bytes, FailPoint::None)?;
        }
        for e in fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some(d) = name.strip_suffix(".lpkv").and_then(parse_date) {
                if today_days - d >= KEY_BACKUP_DAYS {
                    fs::remove_file(e.path())?;
                }
            } else if name.contains(".tmp-") || name.ends_with(".prev") {
                let _ = fs::remove_file(e.path());
            }
        }
        Ok(())
    }

    /// 試験用: アプリが管理する鍵置き場の世代（今・直前・日ごと）のどれかで、この世帯の鍵を開けるか
    #[doc(hidden)]
    pub fn any_managed_vault_has_key(&self, id: &str) -> bool {
        let mut g = self.lock();
        let Ok(s) = Self::session(&mut g) else {
            return false;
        };
        let vp = self.vault_path();
        let mut files = vec![vp.clone(), atomic::prev_path(&vp)];
        if let Ok(rd) = fs::read_dir(self.root.join(KEYS_DIR).join(KEY_BACKUPS_DIR)) {
            files.extend(rd.filter_map(|e| e.ok()).map(|e| e.path()));
        }
        files.iter().any(|p| {
            fs::read(p)
                .ok()
                .and_then(|b| Vault::decode(&b, &s.master).ok())
                .is_some_and(|v| v.unwrap_key(&s.master, id).is_ok())
        })
    }

    /// 試験用: アプリが管理する鍵置き場のどれかの鍵で、この世帯ファイルのバイト列を開けるか
    #[doc(hidden)]
    pub fn can_open_bytes_with_managed_keys(&self, id: &str, bytes: &[u8]) -> bool {
        let mut g = self.lock();
        let Ok(s) = Self::session(&mut g) else {
            return false;
        };
        let vp = self.vault_path();
        let mut files = vec![vp.clone(), atomic::prev_path(&vp)];
        if let Ok(rd) = fs::read_dir(self.root.join(KEYS_DIR).join(KEY_BACKUPS_DIR)) {
            files.extend(rd.filter_map(|e| e.ok()).map(|e| e.path()));
        }
        files.iter().any(|p| {
            fs::read(p)
                .ok()
                .and_then(|b| Vault::decode(&b, &s.master).ok())
                .and_then(|v| v.unwrap_key(&s.master, id).ok())
                .is_some_and(|(_, k)| container::open_household(bytes, &k).is_ok())
        })
    }

    /// 試験用: 世帯ファイルのパス（テストの中だけで使う。画面には渡さない）
    #[doc(hidden)]
    pub fn household_path_for_test(&self, id: &str) -> PathBuf {
        self.household_path(id)
    }

    /// 試験用: 世帯の鍵で、指定の形式の版の世帯ファイルを書く（新しい形式の版のファイルを作るため）
    #[doc(hidden)]
    pub fn write_raw_for_test(
        &self,
        id: &str,
        format_version: &str,
        body: &str,
        generation: u64,
    ) -> Result<(), StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let (key_id, key) = s.vault.unwrap_key(&s.master, id)?;
        let header = HouseholdHeader {
            cipher: String::new(),
            compression: "none".into(),
            device_id: s.device_id.clone(),
            format: HOUSEHOLD_FORMAT.into(),
            format_version: format_version.into(),
            generation,
            household_id: id.into(),
            key_id,
            nonce: String::new(),
            parent_revision: None,
        };
        atomic::replace(
            &self.household_path(id),
            &container::seal_household(header, &key, body.as_bytes()),
            FailPoint::None,
        )?;
        Ok(())
    }
}

fn remove_if_exists(p: &Path) -> Result<(), StoreError> {
    match fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(StoreError::IO),
    }
}

fn files_starting_with(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default()
}

/// バックアップのフォルダ（名前が日付のもの。古い順）
fn backup_dirs(base: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(base)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    parse_date(&e.file_name().to_string_lossy()).is_some() && e.path().is_dir()
                })
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// OS のバックアップから外す。Mac は OS のバックアップの除外の印（管理者の権限は要らない）。ほかの OS は何もしない
/// （Windows は同期の対象になりやすい場所の外、ユーザーごとのアプリのデータの場所に置くことで守る。0013 の4）
fn exclude_from_os_backup(dir: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("/usr/bin/tmutil")
            .arg("addexclusion")
            .arg(dir)
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(iso_of(86_400 * 365 + 3661), "1971-01-01T01:01:01Z");
        for d in [-1000i64, 0, 10_000, 20_744, 30_000] {
            let s = date_of(d * 86_400);
            assert_eq!(parse_date(&s), Some(d), "{s}");
        }
        assert_eq!(date_of(1_792_281_600), "2026-10-18");
        assert!(parse_date("2026-13-01").is_none());
    }

    #[test]
    fn household_file_names() {
        let id = crypto::new_uuid();
        assert_eq!(household_id_of(&format!("{id}.lphf")), Some(id.as_str()));
        assert_eq!(
            household_id_of(&format!("{id}.lphf.prev")),
            Some(id.as_str())
        );
        assert_eq!(
            household_id_of(&format!("{id}.lphf.tmp-abc")),
            Some(id.as_str())
        );
        assert_eq!(household_id_of(&format!("{id}.txt")), None);
        assert_eq!(household_id_of("x.lphf"), None);
    }

    #[test]
    fn customer_numbers() {
        assert!(valid_customer_no("A0042"));
        assert!(valid_customer_no("k-12_3"));
        assert!(!valid_customer_no(""));
        assert!(!valid_customer_no("山田"));
        assert!(!valid_customer_no("../x"));
        assert!(!valid_customer_no("A0000000000000000"));
        let mut d = OfficeData::new(&crypto::new_uuid());
        let a = Store::next_customer_no(&mut d);
        assert!(a.ends_with("0001") && a.len() == 5, "{a}");
    }
}
