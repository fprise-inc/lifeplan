//! 事務所での共有（0023）: 共有フォルダの名簿・世帯の鍵の札・世帯の札・開いている印と、事務所の設定の操作。
//!
//! - 共有フォルダの場所は、このPCの事務所データ（暗号化）にだけ持ち、画面には渡さない。選ぶダイアログはアプリ本体が出す（0023 の8）。
//! - このPCの保管庫には、メンバーの秘密鍵（アカウント名 `<事務所ID>.member`）と、共有の事務所の親鍵の写し（アカウント名 `<事務所ID>`）を置く。
//! - 名簿は、手元の親鍵と同じか、手元の親鍵を「前の親鍵の一覧」に含むときだけ受け入れる（0023 の2）。
//! - 1人の FP が複数の PC で使う同期フォルダ（0024）も、同じ名簿・札・開いている印に「メンバー＝PC」として乗せる。
//!   名簿の使い方の欄が `personal` のとき、表示名は PC の呼び名、2台目の PC は復元キーで名簿に自分を足し（承認は無い）、
//!   参加の申請は承認しない。この PC の中へ戻すのは、もう1台の PC がいても1台でできる（[`Store::sync_end`]）。

use std::collections::HashSet;

use super::*;
use crate::member;
use crate::office::{
    Card, ClosedMark, HouseholdKeys, Member, Paths, Presence, PreviousMaster, RemovedMember,
    RosterEvent,
};

/// 開いている他のメンバー（画面に返す。0023 の7）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceView {
    pub name: String,
    /// 開いた日時（ISO 8601）
    pub since: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView {
    pub member_id: String,
    pub name: String,
    pub fingerprint: String,
    pub joined_at: String,
    /// 承認した人の表示名（事務所を始めた人は null）
    pub approved_by: Option<String>,
    pub role: String,
    pub is_me: bool,
    /// 復元キーで名簿に自分を足したメンバー（承認した人はいない。0023 の5）
    pub via_recovery: bool,
}

/// ほかのメンバーへの知らせ（名簿の履歴から。今は「復元キーで○○さんが加わりました」だけ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticeView {
    /// `recoveryJoin`
    pub kind: String,
    pub name: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedView {
    pub name: String,
    pub removed_at: String,
    pub removed_by: Option<String>,
}

/// 参加の申請（承認する人の画面には指紋を出さない。0023 の3）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub request_id: String,
    pub name: String,
    pub requested_at: String,
}

/// 事務所の共有の状態（画面に返す。パス・鍵は入れない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeStatus {
    /// `off`／`pending`（承認待ち）／`member`／`removed`（外された）／`unavailable`（使えない）
    pub state: String,
    /// 使い方: `personal`（1人で複数の PC の同期フォルダ。0024）／`office`（事務所での共有）。`off` のときは null
    pub usage: Option<String>,
    /// 使えない理由の符号
    pub problem: Option<String>,
    pub my_name: Option<String>,
    /// 自分の指紋（参加の申請のとき、承認する人に読み上げる）
    pub my_fingerprint: Option<String>,
    pub members: Vec<MemberView>,
    pub removed: Vec<RemovedView>,
    pub requests: Vec<RequestView>,
    /// 事務所の確かめ用の番号（全員の画面で同じ。0023 の2）
    pub office_code: Option<String>,
    /// 選んだフォルダが同期フォルダの中か
    pub sync_folder: bool,
    /// このPCの中に残っている世帯の数（共有フォルダへ移せる）
    pub local_households: usize,
    pub recovery_acknowledged: bool,
    pub recovery_acknowledged_by: Option<String>,
    pub recovery_acknowledged_at: Option<String>,
    /// 復元キーで実際に開けることを確かめた日時（今の親鍵について）
    pub recovery_verified_at: Option<String>,
    /// 事務所の復元キーを保管するまで、共有の操作（承認・外す）を止めている（世帯の閲覧・編集は止めない。0023 の5）
    pub recovery_required: bool,
    /// まだ見ていない知らせ（復元キーで加わった人など）
    pub notices: Vec<NoticeView>,
}

/// 分岐を選ぶ画面の材料（0023 の7）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkInfo {
    /// 保存のときに見つけた分岐があるか（こちらの写しを残してある）
    pub saved_conflict: bool,
    /// 今の改訂（相手）を保存した日時・人・世代番号
    pub theirs_saved_at: Option<String>,
    pub theirs_by: Option<String>,
    pub theirs_generation: u64,
    /// こちらの保存しようとした世代番号
    pub ours_generation: Option<u64>,
    /// 同期サービスの衝突の写しの数
    pub sync_copies: usize,
    /// 1人で複数の PC の同期フォルダ（相手は人ではなく、もう1台の PC。0024）
    pub personal: bool,
}

/// 保存先と同期の知らせ（画面の上の帯の「知らせ」にまとめられる形。パス・鍵は入れない。0024）
///
/// `kind` の一覧:
/// - `needsRecovery`（alert）: 保管庫に事務所の鍵が無い。復元キーを入れる
/// - `recoveryNotKept`（同期フォルダ・事務所の共有では warn、PC の中だけなら info）: 今の復元キーがまだ保管されていない
/// - `unavailable`（warn）: 同期フォルダ・共有フォルダを使えない（`code` に理由の符号）
/// - `closed`（warn）: 同期フォルダ・共有の事務所は終わっている（ほかの PC でこの PC の中へ戻した・共有をやめた）
/// - `removed`（alert）: この PC は外された
/// - `pending`（info）: 参加の申請の承認待ち
/// - `recoveryJoin`（alert）: 復元キーで PC（人）が加わった（`name`・`at`）
/// - `joinRequest`（1人の同期フォルダでは alert、事務所では info）: 参加の申請がある（`count`）
/// - `localHouseholds`（info）: この PC の中に、まだ移していない世帯がある（`count`）
/// - `syncCopies`（warn）: 同期サービスの衝突の写しがある世帯がある（`count`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageNotice {
    pub kind: String,
    /// `info`／`warn`／`alert`
    pub level: String,
    /// どの保存先の知らせか: `local`（この PC の中）／`personal`（1人で複数の PC の同期フォルダ）／`office`（事務所での共有）
    pub scope: String,
    pub count: Option<usize>,
    pub name: Option<String>,
    pub at: Option<String>,
    pub code: Option<String>,
}

impl StorageNotice {
    fn new(kind: &str, level: &str, scope: &str) -> StorageNotice {
        StorageNotice {
            kind: kind.into(),
            level: level.into(),
            scope: scope.into(),
            count: None,
            name: None,
            at: None,
            code: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForkChoice {
    /// 相手の内容を残す（こちらの写しは `conflicts/` に残る）
    Theirs,
    /// こちらの内容で上書きする（相手の改訂も `conflicts/` に残す）
    Ours,
}

/// 承認済みのメンバーとして開いた共有の事務所
pub(super) struct Shared {
    pub(super) paths: Paths,
    pub(super) office_id: String,
    pub(super) me: Author,
    pub(super) keys: MemberKeys,
    pub(super) master: Key,
    pub(super) roster: Roster,
    pub(super) members_digest: String,
    pub(super) device_id: String,
    /// 自分が開いている印（世帯ID → (開いた時刻, 最後に書いた時刻)）
    pub(super) present: HashMap<String, (i64, i64)>,
}

fn digest_of(p: &Path) -> Option<String> {
    fs::read(p).ok().map(|b| crypto::digest(&b))
}

impl Shared {
    pub(super) fn household_path(&self, id: &str) -> PathBuf {
        debug_assert!(crypto::is_uuid(id));
        self.paths
            .households_dir()
            .join(format!("{id}.{HOUSEHOLD_EXT}"))
    }

    fn master_for(&self, master_key_id: &str) -> Option<Key> {
        self.roster.master_for(&self.master, master_key_id)
    }

    pub(super) fn read_card(&self, id: &str) -> Result<Card, StoreError> {
        let bytes = match fs::read(self.paths.card(id)) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StoreError::UNKNOWN_HOUSEHOLD)
            }
            Err(_) => return Err(StoreError::IO),
        };
        office::open_card(&bytes, id, |mk| self.master_for(mk))
    }

    pub(super) fn write_card(&self, id: &str, card: &Card) -> Result<(), StoreError> {
        let bytes = office::encode_card(
            &self.office_id,
            &self.roster.master_key_id,
            id,
            card,
            &self.master,
        );
        atomic::replace_no_prev(&self.paths.card(id), &bytes)?;
        Ok(())
    }

    /// 世帯の札の一覧（開けないものは出さない）
    pub(super) fn list_cards(&self) -> Vec<(String, Card)> {
        let mut out = vec![];
        if let Ok(rd) = fs::read_dir(self.paths.cards_dir()) {
            for e in rd.filter_map(|e| e.ok()) {
                let name = e.file_name().to_string_lossy().into_owned();
                let Some(id) = name.strip_suffix(".lpcd").filter(|i| crypto::is_uuid(i)) else {
                    continue;
                };
                if let Ok(c) = self.read_card(id) {
                    out.push((id.to_owned(), c));
                }
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    fn write_keys(
        &self,
        master_key_id: &str,
        master: &Key,
        id: &str,
        k: &HouseholdKeys,
    ) -> Result<(), StoreError> {
        let bytes = office::encode_keys(&self.office_id, master_key_id, id, k, master);
        atomic::replace(
            &self.paths.key_file(master_key_id, id),
            &bytes,
            FailPoint::None,
        )?;
        Ok(())
    }

    /// 新しい世帯の鍵を作って、今の時代の札に書く
    pub(super) fn create_keys(&self, id: &str) -> Result<HouseholdKeys, StoreError> {
        let k = HouseholdKeys::new();
        self.write_keys(&self.roster.master_key_id, &self.master, id, &k)?;
        Ok(k)
    }

    fn read_keys_in(
        &self,
        master_key_id: &str,
        master: &Key,
        id: &str,
    ) -> Result<Option<HouseholdKeys>, StoreError> {
        match fs::read(self.paths.key_file(master_key_id, id)) {
            Ok(b) => office::open_keys(&b, id, master).map(Some),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(StoreError::IO),
        }
    }

    /// 世帯の鍵（読むため）: 今の時代の札、無ければ前の時代の札（入れ替えの直後の同期の遅れ・迷子の札）
    pub(super) fn keys_for_read(&self, id: &str) -> Result<HouseholdKeys, StoreError> {
        if let Some(k) = self.read_keys_in(&self.roster.master_key_id, &self.master, id)? {
            return Ok(k);
        }
        for p in &self.roster.previous {
            if let Some(k) = self.read_keys_in(&p.master_key_id, &p.key, id)? {
                return Ok(k);
            }
        }
        Err(if self.household_path(id).exists() {
            StoreError::OFFICE_WAITING_SYNC
        } else {
            StoreError::NO_KEY
        })
    }

    /// 世帯の鍵（保存するため）: 今の時代の札が要る。前の時代にだけある札は、入れ替えの後に作られた世帯（迷子の札）なら、
    /// 世帯の鍵を新しくして今の時代へ引き取る。入れ替えの前からある世帯なら、同期を待つ（0023 の4）
    pub(super) fn keys_for_write(
        &self,
        id: &str,
        created_at: &str,
    ) -> Result<HouseholdKeys, StoreError> {
        if let Some(k) = self.read_keys_in(&self.roster.master_key_id, &self.master, id)? {
            return Ok(k);
        }
        for p in &self.roster.previous {
            if let Some(k) = self.read_keys_in(&p.master_key_id, &p.key, id)? {
                if created_at > p.retired_at.as_str() {
                    let adopted = k.rotated();
                    self.write_keys(&self.roster.master_key_id, &self.master, id, &adopted)?;
                    return Ok(adopted);
                }
                return Err(StoreError::OFFICE_WAITING_SYNC);
            }
        }
        Err(StoreError::NO_KEY)
    }

    fn read_presence(&self, hid: &str, mid: &str) -> Option<Presence> {
        let b = fs::read(self.paths.presence(hid, mid)).ok()?;
        office::open_presence(&b, hid, mid, |mk| self.master_for(mk)).ok()
    }

    /// 他のメンバーの有効な開いている印（世帯ID → 開いている人）。無効になった印は片付ける
    pub(super) fn presence_map(&self, now: i64) -> HashMap<String, Vec<PresenceView>> {
        let mut out: HashMap<String, Vec<PresenceView>> = HashMap::new();
        let Ok(rd) = fs::read_dir(self.paths.presence_dir()) else {
            return out;
        };
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().into_owned();
            let Some((hid, mid)) = office::presence_ids(&name) else {
                continue;
            };
            if mid == self.me.member_id {
                continue;
            }
            match self.read_presence(&hid, &mid) {
                Some(p) if p.valid_at(now) => out.entry(hid).or_default().push(PresenceView {
                    name: p.display_name,
                    since: iso_of(p.opened_at),
                }),
                Some(_) => {
                    // 5分新しくならない印は無効。見つけた人が片付けてよい（0023 の7）
                    let _ = fs::remove_file(e.path());
                }
                None => {}
            }
        }
        out
    }

    fn others_present(&self, id: &str, now: i64) -> Vec<PresenceView> {
        self.presence_map(now).remove(id).unwrap_or_default()
    }

    fn write_presence(&self, id: &str, opened_at: i64, now: i64) {
        let p = Presence {
            member_id: self.me.member_id.clone(),
            display_name: self.me.name.clone(),
            opened_at,
            heartbeat_at: now,
            device_id: self.device_id.clone(),
        };
        let bytes = office::encode_presence(
            &self.office_id,
            &self.roster.master_key_id,
            id,
            &p,
            &self.master,
        );
        let _ = atomic::replace_no_prev(&self.paths.presence(id, &self.me.member_id), &bytes);
    }

    /// 世帯を開いた: 他の世帯の自分の印を消し、この世帯の印を置く。他に開いている人を返す
    pub(super) fn enter(&mut self, id: &str, now: i64) -> Vec<PresenceView> {
        let others: Vec<String> = self.present.keys().filter(|k| *k != id).cloned().collect();
        for o in others {
            let _ = fs::remove_file(self.paths.presence(&o, &self.me.member_id));
            self.present.remove(&o);
        }
        let opened_at = self.present.get(id).map_or(now, |(o, _)| *o);
        self.write_presence(id, opened_at, now);
        self.present.insert(id.to_owned(), (opened_at, now));
        self.others_present(id, now)
    }

    /// 保存したとき・定期的に: 印を新しくする（1分ごと）
    pub(super) fn touch(&mut self, id: &str, now: i64) {
        if let Some((opened, last)) = self.present.get(id).copied() {
            if now - last >= office::PRESENCE_REFRESH_SECS {
                self.write_presence(id, opened, now);
                self.present.insert(id.to_owned(), (opened, now));
            }
        }
    }

    fn heartbeat(&mut self, now: i64) {
        let ids: Vec<String> = self.present.keys().cloned().collect();
        for id in ids {
            self.touch(&id, now);
        }
    }

    fn leave_all(&mut self) {
        for id in self.present.keys() {
            let _ = fs::remove_file(self.paths.presence(id, &self.me.member_id));
        }
        self.present.clear();
    }

    /// 完全削除: 共有フォルダの世帯ファイル・直前の世代・一時ファイル・衝突の写し・世帯の札・開いている印・すべての時代の世帯の鍵の札
    pub(super) fn delete_household(&self, id: &str) -> Result<(), StoreError> {
        let path = self.household_path(id);
        for p in [path.clone(), atomic::prev_path(&path)]
            .into_iter()
            .chain(atomic::temp_files(&path))
        {
            remove_if_exists(&p)?;
        }
        for p in sync_copy_names(&self.paths.households_dir())
            .remove(id)
            .unwrap_or_default()
        {
            remove_if_exists(&p)?;
        }
        remove_if_exists(&self.paths.card(id))?;
        for p in files_starting_with(&self.paths.presence_dir(), id) {
            remove_if_exists(&p)?;
        }
        if let Ok(rd) = fs::read_dir(self.paths.keys_root()) {
            for e in rd.filter_map(|e| e.ok()) {
                for p in files_starting_with(&e.path(), id) {
                    remove_if_exists(&p)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn recovery_acknowledged(&self) -> bool {
        self.roster
            .recovery
            .as_ref()
            .is_some_and(|r| r.master_key_id == self.roster.master_key_id)
    }

    /// 名簿を書く（読んだ後にほかの PC が書き換えていたら書かない）
    pub(super) fn write_roster(&mut self, r: Roster, master: &Key) -> Result<(), StoreError> {
        if digest_of(&self.paths.members()).as_deref() != Some(self.members_digest.as_str()) {
            return Err(StoreError::OFFICE_BUSY);
        }
        let bytes = office::encode_roster(&r, master)?;
        atomic::replace(&self.paths.members(), &bytes, FailPoint::None)?;
        self.members_digest = crypto::digest(&bytes);
        self.roster = r;
        Ok(())
    }

    /// 今の親鍵の保管の記録（前の時代の記録は使わない）
    fn current_ack(&self) -> Option<&office::RecoveryAck> {
        self.roster
            .recovery
            .as_ref()
            .filter(|r| r.master_key_id == self.roster.master_key_id)
    }

    pub(super) fn recovery_verified_at(&self) -> Option<String> {
        self.current_ack().and_then(|a| a.verified_at.clone())
    }

    /// 共有の操作（承認・外す）の前に: 事務所の復元キーを保管するまで止める（0023 の5）
    fn require_recovery(&self) -> Result<(), StoreError> {
        if self.recovery_acknowledged() {
            Ok(())
        } else {
            Err(StoreError::OFFICE_RECOVERY_REQUIRED)
        }
    }

    pub(super) fn acknowledge_recovery(&mut self, now: &str) -> Result<(), StoreError> {
        let mut r = self.roster.clone();
        let prev = self.current_ack().cloned();
        r.recovery = Some(office::RecoveryAck {
            master_key_id: r.master_key_id.clone(),
            acknowledged_at: now.to_owned(),
            acknowledged_by: self.me.member_id.clone(),
            verified_at: prev.as_ref().and_then(|a| a.verified_at.clone()),
            verified_by: prev.and_then(|a| a.verified_by),
        });
        r.updated_at = now.to_owned();
        r.updated_by = Some(self.me.member_id.clone());
        let m = self.master.clone();
        self.write_roster(r, &m)
    }

    /// 復元キーで実際に開けることを確かめた: 名簿に記録し、保管済みとみなす（「保管した」の記録が無ければ、それも今の日時で書く）
    pub(super) fn verify_recovery(&mut self, now: &str) -> Result<(), StoreError> {
        let mut r = self.roster.clone();
        let me = self.me.member_id.clone();
        let prev = self.current_ack().cloned();
        r.recovery = Some(office::RecoveryAck {
            master_key_id: r.master_key_id.clone(),
            acknowledged_at: prev
                .as_ref()
                .map_or_else(|| now.to_owned(), |a| a.acknowledged_at.clone()),
            acknowledged_by: prev
                .as_ref()
                .map_or_else(|| me.clone(), |a| a.acknowledged_by.clone()),
            verified_at: Some(now.to_owned()),
            verified_by: Some(me.clone()),
        });
        r.updated_at = now.to_owned();
        r.updated_by = Some(me);
        let m = self.master.clone();
        self.write_roster(r, &m)
    }
}

/// 選んだフォルダが使えるか（データフォルダ・カスタム層・SDK・AIの作業フォルダの中、またはそれらを含む場所は選べない。0023 の8）
fn check_folder(folder: &Path, forbidden: &[PathBuf]) -> Result<PathBuf, StoreError> {
    let f = fs::canonicalize(folder).map_err(|_| StoreError::OFFICE_FOLDER)?;
    if !f.is_dir() {
        return Err(StoreError::OFFICE_FOLDER);
    }
    for r in forbidden {
        let rc = fs::canonicalize(r).unwrap_or_else(|_| r.clone());
        if f.starts_with(&rc) || rc.starts_with(&f) {
            return Err(StoreError::OFFICE_FOLDER);
        }
    }
    Ok(f)
}

fn member_account(office_id: &str) -> String {
    format!("{office_id}.member")
}

/// 名簿の使い方（欄が無い名簿は事務所での共有。0024）
fn usage_of(r: &Roster) -> &'static str {
    if r.personal() {
        office::USAGE_PERSONAL
    } else {
        office::USAGE_OFFICE
    }
}

impl Store {
    /// 事務所データの共有の設定から、共有の事務所を開く（起動時・承認待ちの確かめ）
    pub(super) fn activate_shared(&self, s: &mut Session) {
        let present = s.shared.take().map(|sh| sh.present).unwrap_or_default();
        s.share_problem = None;
        let Some(mut set) = s.data.sharing.clone() else {
            return;
        };
        if set.state != "member" && set.state != "pending" {
            return;
        }
        match self.connect(&set, &s.device_id) {
            Ok(Some(mut sh)) => {
                sh.present = present;
                let usage = Some(usage_of(&sh.roster).to_owned());
                if set.state == "pending" || set.usage != usage {
                    if set.state == "pending" {
                        set.state = "member".into();
                        set.joined_at = Some(iso_of(self.now()));
                    }
                    set.usage = usage;
                    s.data.sharing = Some(set);
                    let _ = self.write_office(s);
                }
                self.prune_previous(&mut sh);
                let align = sh.roster.personal().then(|| sh.master.clone());
                s.shared = Some(sh);
                // 1人で複数の PC: 同期フォルダの鍵が入れ替わっていたら（PC を外した）、この PC の中の事務所の鍵もそろえる（0024）
                if let Some(m) = align {
                    let _ = self.adopt_local_master(s, &m);
                }
            }
            Ok(None) => {}
            Err(StoreError::OFFICE_REMOVED) => {
                set.state = "removed".into();
                s.data.sharing = Some(set);
                let _ = self.write_office(s);
            }
            Err(e) => s.share_problem = Some(e),
        }
    }

    /// 名簿を開く。承認待ちでまだ包みが無ければ None。外されていれば [`StoreError::OFFICE_REMOVED`]
    fn connect(&self, set: &SharingSetting, device_id: &str) -> Result<Option<Shared>, StoreError> {
        let paths = Paths::new(PathBuf::from(&set.folder));
        if !paths.office_file().is_file() {
            return Err(StoreError::OFFICE_UNAVAILABLE);
        }
        let secret = self
            .secrets
            .get(&member_account(&set.office_id))?
            .ok_or(StoreError::OFFICE_KEY_MISSING)?;
        let keys = MemberKeys::from_hex(&secret).ok_or(StoreError::OFFICE_KEY_MISSING)?;
        let bytes = match fs::read(paths.members()) {
            Ok(b) => b,
            Err(_) if set.state == "pending" => return Ok(None),
            Err(_) => return Err(StoreError::OFFICE_UNAVAILABLE),
        };
        let (roster, master) = match office::open_roster(&bytes, &keys, &set.member_id) {
            Ok(v) => v,
            Err(StoreError::OFFICE_NOT_MEMBER) if set.state == "pending" => return Ok(None),
            Err(StoreError::OFFICE_NOT_MEMBER) => return Err(StoreError::OFFICE_REMOVED),
            Err(e) => return Err(e),
        };
        if roster.office_id != set.office_id {
            return Err(StoreError::OFFICE_FORGED);
        }
        if roster.closed.is_some() {
            // 共有をやめた事務所（やめる途中で止まった場合を含む）。世帯は先にこの PC の中へ写してある（0023 の10）
            return Err(StoreError::OFFICE_CLOSED);
        }
        // 手元の親鍵と違う名簿は、手元の親鍵を前の親鍵の一覧に含むときだけ受け入れる（入れ替え）
        match self.master_of(&set.office_id)? {
            Some(cached) if *cached == *master => {}
            Some(cached) => {
                if !roster.previous.iter().any(|p| *p.key == *cached) {
                    return Err(StoreError::OFFICE_FORGED);
                }
                self.secrets.set(
                    &set.office_id,
                    &Zeroizing::new(crypto::hex_encode(master.as_ref())),
                )?;
            }
            None => {
                self.secrets.set(
                    &set.office_id,
                    &Zeroizing::new(crypto::hex_encode(master.as_ref())),
                )?;
            }
        }
        let me = roster
            .member(&set.member_id)
            .map(Member::author)
            .ok_or(StoreError::OFFICE_NOT_MEMBER)?;
        Ok(Some(Shared {
            paths,
            office_id: set.office_id.clone(),
            me,
            keys,
            master,
            roster,
            members_digest: crypto::digest(&bytes),
            device_id: device_id.to_owned(),
            present: HashMap::new(),
        }))
    }

    /// 前の親鍵のうち、退いてから30日たったものを名簿から消し、その時代のフォルダを片付ける（0023 の4）
    fn prune_previous(&self, sh: &mut Shared) {
        let today = self.now().div_euclid(86_400);
        let expired = |p: &PreviousMaster| {
            parse_iso(&p.retired_at)
                .is_some_and(|t| today - t.div_euclid(86_400) >= office::PREVIOUS_MASTER_DAYS)
        };
        if !sh.roster.previous.iter().any(expired) {
            return;
        }
        let gone: Vec<String> = sh
            .roster
            .previous
            .iter()
            .filter(|p| expired(p))
            .map(|p| p.master_key_id.clone())
            .collect();
        // 迷子の札があれば、先に今の時代へ引き取る
        for mk in &gone {
            if let Ok(rd) = fs::read_dir(sh.paths.keys_dir(mk)) {
                for e in rd.filter_map(|e| e.ok()) {
                    let name = e.file_name().to_string_lossy().into_owned();
                    if let Some(id) = name.strip_suffix(".lphk").filter(|i| crypto::is_uuid(i)) {
                        if !sh.paths.key_file(&sh.roster.master_key_id, id).exists() {
                            if let Ok(k) = sh.keys_for_read(id) {
                                let _ = sh.write_keys(
                                    &sh.roster.master_key_id.clone(),
                                    &sh.master.clone(),
                                    id,
                                    &k.rotated(),
                                );
                            }
                        }
                    }
                }
            }
        }
        let mut r = sh.roster.clone();
        r.previous.retain(|p| !expired(p));
        let m = sh.master.clone();
        if sh.write_roster(r, &m).is_ok() {
            for mk in gone {
                let _ = fs::remove_dir_all(sh.paths.keys_dir(&mk));
            }
        }
    }

    /// 名簿がほかの PC で書き換えられていたら読み直す（保存の前など。0023 の7）
    pub(super) fn refresh_shared(&self, s: &mut Session) -> Result<(), StoreError> {
        let Some(sh) = &s.shared else {
            return Ok(());
        };
        if digest_of(&sh.paths.members()).as_deref() == Some(sh.members_digest.as_str()) {
            return Ok(());
        }
        self.activate_shared(s);
        if let Some(e) = s.share_problem {
            return Err(e);
        }
        if s.shared.is_none() {
            return Err(StoreError::OFFICE_REMOVED);
        }
        Ok(())
    }

    /// 書いた人（事務所で共有しているときの自分。共有していなければ None）
    pub fn current_author(&self) -> Option<Author> {
        let mut g = self.lock();
        let s = Self::session(&mut g).ok()?;
        s.shared.as_ref().map(|sh| sh.me.clone())
    }

    /// 事務所の共有の状態（承認待ちなら、名簿に自分の包みが入ったかを確かめる）
    pub fn office_status(&self) -> Result<OfficeStatus, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let pending = s
            .data
            .sharing
            .as_ref()
            .is_some_and(|x| x.state == "pending");
        if pending || s.share_problem.is_some() {
            self.activate_shared(s);
        } else if s.shared.is_some() {
            let _ = self.refresh_shared(s);
        }
        Ok(self.office_status_of(s))
    }

    fn office_status_of(&self, s: &Session) -> OfficeStatus {
        let set = s.data.sharing.as_ref();
        let mut st = OfficeStatus {
            state: "off".into(),
            usage: None,
            problem: s.share_problem.map(|e| e.code().to_owned()),
            my_name: set.map(|x| x.display_name.clone()),
            my_fingerprint: None,
            members: vec![],
            removed: vec![],
            requests: vec![],
            office_code: None,
            sync_folder: set.is_some_and(|x| x.sync_folder),
            local_households: s.data.households.len(),
            recovery_acknowledged: false,
            recovery_acknowledged_by: None,
            recovery_acknowledged_at: None,
            recovery_verified_at: None,
            recovery_required: false,
            notices: vec![],
        };
        let Some(set) = set else {
            return st;
        };
        st.state = if s.share_problem.is_some() && set.state != "removed" {
            "unavailable".into()
        } else {
            set.state.clone()
        };
        st.usage = Some(match &s.shared {
            Some(sh) => usage_of(&sh.roster).to_owned(),
            None => set
                .usage
                .clone()
                .unwrap_or_else(|| office::USAGE_OFFICE.to_owned()),
        });
        if set.state == "pending" {
            if let Ok(Some(secret)) = self.secrets.get(&member_account(&set.office_id)) {
                if let Some(k) = MemberKeys::from_hex(&secret) {
                    st.my_fingerprint = Some(member::fingerprint(&k.public()));
                }
            }
        }
        if let Some(sh) = &s.shared {
            let r = &sh.roster;
            st.my_name = Some(sh.me.name.clone());
            st.my_fingerprint = Some(member::fingerprint(&sh.keys.public()));
            st.office_code = Some(member::office_code(&sh.master));
            st.members = r
                .members
                .iter()
                .map(|m| MemberView {
                    member_id: m.member_id.clone(),
                    name: m.display_name.clone(),
                    fingerprint: m.fingerprint.clone(),
                    joined_at: m.joined_at.clone(),
                    approved_by: m.approved_by.as_deref().and_then(|a| r.name_of(a)),
                    role: m.role.clone(),
                    is_me: m.member_id == sh.me.member_id,
                    via_recovery: r.joined_by_recovery(&m.member_id),
                })
                .collect();
            st.removed = r
                .removed
                .iter()
                .map(|x| RemovedView {
                    name: x.display_name.clone(),
                    removed_at: x.removed_at.clone(),
                    removed_by: x.removed_by.as_deref().and_then(|a| r.name_of(a)),
                })
                .collect();
            st.requests = read_requests(&sh.paths, &sh.office_id)
                .into_iter()
                .filter(|q| r.member(&q.member_id).is_none())
                .map(|q| RequestView {
                    request_id: q.member_id,
                    name: q.display_name,
                    requested_at: q.requested_at,
                })
                .collect();
            if let Some(ack) = sh.current_ack() {
                st.recovery_acknowledged = true;
                st.recovery_acknowledged_by = r.name_of(&ack.acknowledged_by);
                st.recovery_acknowledged_at = Some(ack.acknowledged_at.clone());
                st.recovery_verified_at = ack.verified_at.clone();
            }
            st.recovery_required = !st.recovery_acknowledged;
            // 知らせ: 自分が加わった後の、ほかのメンバーの「復元キーで加わった」で、この PC でまだ見ていないもの
            let seen = set.notices_seen_at.as_deref().unwrap_or("");
            let since = set.joined_at.as_deref().unwrap_or("");
            st.notices = r
                .events
                .iter()
                .filter(|e| {
                    e.kind == office::EVENT_RECOVERY_JOIN
                        && e.member_id != sh.me.member_id
                        && e.at.as_str() > seen
                        && e.at.as_str() >= since
                })
                .map(|e| NoticeView {
                    kind: e.kind.clone(),
                    name: e.display_name.clone(),
                    at: e.at.clone(),
                })
                .collect();
        }
        st
    }

    /// 事務所の共有を始める（最初の1人）: 選んだフォルダの中に事務所のフォルダを作り、このPCの世帯を移す（0023 の1）。
    /// `folder` はアプリ本体が OS のダイアログで選ばせたもの（画面から受け取らない）。`forbidden` はカスタム層・SDK・AIの作業フォルダ
    pub fn office_start(
        &self,
        folder: &Path,
        display_name: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
    ) -> Result<OfficeStatus, StoreError> {
        self.start_shared(folder, display_name, sync_folder, forbidden, false)
    }

    /// 保存先を同期フォルダにする（1人の FP が複数の PC で使う。0024）: 選んだフォルダの中に同期フォルダ用の事務所のフォルダを作り、
    /// このPCの世帯を暗号化したまま移す。`pc_name` はこの PC の呼び名。事務所での共有と違い、**今の事務所の鍵（復元キー）をそのまま使う**
    /// （保管済みの復元キーで2台目の PC を開ける）。復元キーを保管していなければ移さない（[`StoreError::SYNC_RECOVERY_REQUIRED`]。0013 の3）。
    /// `folder` はアプリ本体が OS のダイアログで選ばせたもの（画面から受け取らない）
    pub fn sync_start(
        &self,
        folder: &Path,
        pc_name: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
    ) -> Result<OfficeStatus, StoreError> {
        self.start_shared(folder, pc_name, sync_folder, forbidden, true)
    }

    fn start_shared(
        &self,
        folder: &Path,
        display_name: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
        personal: bool,
    ) -> Result<OfficeStatus, StoreError> {
        if !office::valid_display_name(display_name) {
            return Err(StoreError::OFFICE_NAME);
        }
        let name = display_name.trim().to_owned();
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        if s.data
            .sharing
            .as_ref()
            .is_some_and(|x| x.state != "removed")
        {
            return Err(StoreError::OFFICE_STATE);
        }
        let local_ack = s
            .data
            .recovery
            .acknowledged_at
            .clone()
            .or_else(|| s.data.recovery.verified_at.clone());
        if personal && local_ack.is_none() {
            return Err(StoreError::SYNC_RECOVERY_REQUIRED);
        }
        let mut roots = forbidden.to_vec();
        roots.push(self.root.clone());
        let folder = check_folder(folder, &roots)?;
        if office::locate(&folder).is_some() {
            return Err(StoreError::OFFICE_EXISTS);
        }
        let paths = Paths::new(folder.join(office::OFFICE_DIR));
        let office_id = crypto::new_uuid();
        // 1人で複数の PC: 今の事務所の鍵をそのまま使う（FP が保管済みの復元キーが、そのまま同期フォルダの復元キーになる。0024）。
        // 事務所での共有: 新しい鍵（共有の事務所の復元キーは新しくなる。0023 の1）
        let master = if personal {
            s.master.clone()
        } else {
            crypto::random_key()
        };
        let master_key_id = crypto::new_uuid();
        let keys = MemberKeys::generate();
        let member_id = crypto::new_uuid();
        let at = iso_of(now);
        // 1人で複数の PC: この PC の復元キーの保管の記録を、名簿の保管の記録として引き継ぐ（同じ鍵なので）
        let recovery = match (personal, local_ack) {
            (true, Some(acked)) => Some(office::RecoveryAck {
                master_key_id: master_key_id.clone(),
                acknowledged_at: acked,
                acknowledged_by: member_id.clone(),
                verified_at: s.data.recovery.verified_at.clone(),
                verified_by: s
                    .data
                    .recovery
                    .verified_at
                    .as_ref()
                    .map(|_| member_id.clone()),
            }),
            _ => None,
        };
        // 先に保管庫へ（ここで止まっても、共有フォルダには何も無い）
        self.secrets.set(
            &office_id,
            &Zeroizing::new(crypto::hex_encode(master.as_ref())),
        )?;
        self.secrets
            .set(&member_account(&office_id), &keys.secret_hex())?;
        let me = Member {
            member_id: member_id.clone(),
            display_name: name.clone(),
            public_key: keys.public_hex(),
            fingerprint: member::fingerprint(&keys.public()),
            joined_at: at.clone(),
            approved_by: None,
            role: office::ROLE_MEMBER.into(),
        };
        let roster = Roster {
            office_id: office_id.clone(),
            master_key_id,
            members: vec![me.clone()],
            removed: vec![],
            previous: vec![],
            recovery,
            events: vec![],
            closed: None,
            usage: Some(
                if personal {
                    office::USAGE_PERSONAL
                } else {
                    office::USAGE_OFFICE
                }
                .to_owned(),
            ),
            // 区分は、始めた PC の設定を事務所の設定にする（0033）。まだ決めていなければ書かず、事務所で1回決める
            categories: s
                .data
                .numbering
                .decided
                .then(|| s.data.numbering.categories.clone()),
            updated_at: at.clone(),
            updated_by: Some(member_id.clone()),
        };
        for d in [
            paths.households_dir(),
            paths.cards_dir(),
            paths.presence_dir(),
            paths.requests_dir(),
            paths.keys_dir(&roster.master_key_id),
        ] {
            fs::create_dir_all(d)?;
        }
        let bytes = office::encode_roster(&roster, &master)?;
        atomic::replace(&paths.members(), &bytes, FailPoint::None)?;
        write_json(&paths.office_file(), &office::OfficeFile::new(&office_id))?;
        s.data.sharing = Some(SharingSetting {
            folder: paths.root.to_string_lossy().into_owned(),
            office_id: office_id.clone(),
            member_id,
            display_name: name,
            state: "member".into(),
            requested_at: at.clone(),
            joined_at: Some(at),
            sync_folder,
            notices_seen_at: None,
            usage: Some(usage_of(&roster).to_owned()),
        });
        self.write_office(s)?;
        s.shared = Some(Shared {
            paths,
            office_id,
            me: me.author(),
            keys,
            master,
            roster,
            members_digest: crypto::digest(&bytes),
            device_id: s.device_id.clone(),
            present: HashMap::new(),
        });
        s.share_problem = None;
        self.move_local(s)?;
        g.opened.clear();
        let s = Self::session(&mut g)?;
        Ok(self.office_status_of(s))
    }

    /// 事務所の共有に参加する（2人目から）: 参加の申請を置き、承認を待つ（0023 の3）
    pub fn office_join(
        &self,
        folder: &Path,
        display_name: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
    ) -> Result<OfficeStatus, StoreError> {
        if !office::valid_display_name(display_name) {
            return Err(StoreError::OFFICE_NAME);
        }
        let name = display_name.trim().to_owned();
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        if s.data
            .sharing
            .as_ref()
            .is_some_and(|x| x.state != "removed")
        {
            return Err(StoreError::OFFICE_STATE);
        }
        let mut roots = forbidden.to_vec();
        roots.push(self.root.clone());
        let folder = check_folder(folder, &roots)?;
        let root = office::locate(&folder).ok_or(StoreError::OFFICE_NOT_FOUND)?;
        let root = check_folder(&root, &roots)?;
        let paths = Paths::new(root);
        let of = office::OfficeFile::read(&paths)?;
        let keys = MemberKeys::generate();
        let member_id = crypto::new_uuid();
        let at = iso_of(now);
        self.secrets
            .set(&member_account(&of.office_id), &keys.secret_hex())?;
        let req = office::JoinRequest {
            format: office::REQUEST_FORMAT.into(),
            format_version: office::SHARED_FORMAT_VERSION.into(),
            office_id: of.office_id.clone(),
            member_id: member_id.clone(),
            display_name: name.clone(),
            public_key: keys.public_hex(),
            requested_at: at.clone(),
        };
        write_json(&paths.request(&member_id), &req)?;
        s.data.sharing = Some(SharingSetting {
            folder: paths.root.to_string_lossy().into_owned(),
            office_id: of.office_id,
            member_id,
            display_name: name,
            state: "pending".into(),
            requested_at: at,
            joined_at: None,
            sync_folder,
            notices_seen_at: None,
            usage: Some(office::USAGE_OFFICE.to_owned()),
        });
        s.share_problem = None;
        self.write_office(s)?;
        Ok(self.office_status_of(s))
    }

    /// 参加の申請を取り下げる・外された設定を片付ける（このPCの事務所に戻る）
    pub fn office_leave_setting(&self) -> Result<OfficeStatus, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let Some(set) = s.data.sharing.clone() else {
            return Ok(self.office_status_of(s));
        };
        if set.state == "member" && s.share_problem.is_none() {
            // 承認済みのメンバーは、ここでは抜けない。抜けるときはほかのメンバーに外してもらい（鍵の入れ替え）、
            // 最後の1人は「共有をやめる」（office_end）を使う（0023 の10）
            return Err(StoreError::OFFICE_STATE);
        }
        let closed = s.share_problem == Some(StoreError::OFFICE_CLOSED);
        if set.state == "pending" && crypto::is_uuid(&set.member_id) {
            let _ = fs::remove_file(Paths::new(PathBuf::from(&set.folder)).request(&set.member_id));
        }
        let _ = self.secrets.delete(&member_account(&set.office_id));
        if set.state != "member" || closed {
            let _ = self.secrets.delete(&set.office_id);
        }
        s.data.sharing = None;
        s.shared = None;
        s.share_problem = None;
        self.write_office(s)?;
        Ok(self.office_status_of(s))
    }

    /// 全員の PC が使えなくなったとき: 事務所の復元キーで名簿を開き、この PC を事務所のメンバーとして名簿に足す（0023 の5）。
    /// 復元キー（＝今の親鍵）を持つことを本人の証明とする。足したことを名簿の履歴に残し、ほかのメンバーの画面に知らせを出す。
    /// `folder` はアプリ本体が OS のダイアログで選ばせたもの（画面から受け取らない）
    pub fn office_recover_join(
        &self,
        folder: &Path,
        display_name: &str,
        recovery_key: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
    ) -> Result<OfficeStatus, StoreError> {
        self.recover_join_shared(
            folder,
            display_name,
            recovery_key,
            sync_folder,
            forbidden,
            false,
        )
    }

    /// 2台目の PC で、すでに使っている同期フォルダを開く（1人の FP が複数の PC で使う。0024）: 復元キーで名簿を開き、この PC を名簿に足す
    /// （承認は要らない。復元キーを持つことが本人の証明）。この PC の保管庫に鍵を置くので、次からは復元キーなしで開ける。
    /// 足したことは名簿の履歴に残り、ほかの PC の画面に知らせが出る。事務所での共有（複数の FP）のフォルダは開かない
    /// （[`StoreError::SYNC_IS_OFFICE`]。事務所の設定の「参加する」から）。`pc_name` はこの PC の呼び名
    pub fn sync_open(
        &self,
        folder: &Path,
        pc_name: &str,
        recovery_key: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
    ) -> Result<OfficeStatus, StoreError> {
        self.recover_join_shared(folder, pc_name, recovery_key, sync_folder, forbidden, true)
    }

    fn recover_join_shared(
        &self,
        folder: &Path,
        display_name: &str,
        recovery_key: &str,
        sync_folder: bool,
        forbidden: &[PathBuf],
        personal_only: bool,
    ) -> Result<OfficeStatus, StoreError> {
        if !office::valid_display_name(display_name) {
            return Err(StoreError::OFFICE_NAME);
        }
        let candidate = recovery::decode(recovery_key)?;
        let name = display_name.trim().to_owned();
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        if s.data
            .sharing
            .as_ref()
            .is_some_and(|x| x.state != "removed")
        {
            return Err(StoreError::OFFICE_STATE);
        }
        let mut roots = forbidden.to_vec();
        roots.push(self.root.clone());
        let folder = check_folder(folder, &roots)?;
        let root = office::locate(&folder).ok_or(StoreError::OFFICE_NOT_FOUND)?;
        let root = check_folder(&root, &roots)?;
        let paths = Paths::new(root);
        let of = office::OfficeFile::read(&paths)?;
        let bytes = fs::read(paths.members()).map_err(|_| StoreError::OFFICE_UNAVAILABLE)?;
        // 今の親鍵でだけ開く（古い控え＝前の時代の親鍵では加われない）
        let mut roster = match office::open_roster_with_master(&bytes, &candidate) {
            Ok(r) => r,
            Err(StoreError::WRONG_MASTER) => return Err(StoreError::RECOVERY_MISMATCH),
            Err(e) => return Err(e),
        };
        if roster.office_id != of.office_id {
            return Err(StoreError::OFFICE_FORGED);
        }
        if roster.closed.is_some() {
            return Err(StoreError::OFFICE_CLOSED);
        }
        if personal_only && !roster.personal() {
            return Err(StoreError::SYNC_IS_OFFICE);
        }
        let keys = MemberKeys::generate();
        let member_id = crypto::new_uuid();
        let at = iso_of(now);
        let me = Member {
            member_id: member_id.clone(),
            display_name: name.clone(),
            public_key: keys.public_hex(),
            fingerprint: member::fingerprint(&keys.public()),
            joined_at: at.clone(),
            approved_by: None,
            role: office::ROLE_MEMBER.into(),
        };
        roster.members.push(me.clone());
        roster.push_event(RosterEvent {
            kind: office::EVENT_RECOVERY_JOIN.into(),
            member_id: member_id.clone(),
            display_name: name.clone(),
            at: at.clone(),
        });
        // 復元キーで開けたので、今の親鍵の保管の記録が無ければ「試して確かめた」として書く
        if !roster
            .recovery
            .as_ref()
            .is_some_and(|r| r.master_key_id == roster.master_key_id)
        {
            roster.recovery = Some(office::RecoveryAck {
                master_key_id: roster.master_key_id.clone(),
                acknowledged_at: at.clone(),
                acknowledged_by: member_id.clone(),
                verified_at: Some(at.clone()),
                verified_by: Some(member_id.clone()),
            });
        }
        roster.updated_at = at.clone();
        roster.updated_by = Some(member_id.clone());
        // 読んだ後にほかの PC が名簿を書き換えていたら書かない
        if digest_of(&paths.members()).as_deref() != Some(crypto::digest(&bytes).as_str()) {
            return Err(StoreError::OFFICE_BUSY);
        }
        // 先に保管庫へ（ここで止まっても、名簿は変わっていない）
        self.secrets.set(
            &roster.office_id,
            &Zeroizing::new(crypto::hex_encode(candidate.as_ref())),
        )?;
        self.secrets
            .set(&member_account(&roster.office_id), &keys.secret_hex())?;
        let out = office::encode_roster(&roster, &candidate)?;
        atomic::replace(&paths.members(), &out, FailPoint::None)?;
        s.data.sharing = Some(SharingSetting {
            folder: paths.root.to_string_lossy().into_owned(),
            office_id: roster.office_id.clone(),
            member_id,
            display_name: name,
            state: "member".into(),
            requested_at: at.clone(),
            joined_at: Some(at),
            sync_folder,
            notices_seen_at: None,
            usage: Some(usage_of(&roster).to_owned()),
        });
        self.write_office(s)?;
        let personal = roster.personal();
        let master = candidate.clone();
        s.shared = Some(Shared {
            paths,
            office_id: roster.office_id.clone(),
            me: me.author(),
            keys,
            master: candidate,
            roster,
            members_digest: crypto::digest(&out),
            device_id: s.device_id.clone(),
            present: HashMap::new(),
        });
        s.share_problem = None;
        if personal {
            // 1人で複数の PC: この PC の中の事務所の鍵も同期フォルダの鍵にそろえる（復元キーは1つで足りる。0024）。
            // 途中で止まっても、次の起動で続きから終える
            let _ = self.adopt_local_master(s, &master);
        }
        g.opened.clear();
        let s = Self::session(&mut g)?;
        Ok(self.office_status_of(s))
    }

    /// 知らせ（復元キーで加わった人など）を見た: この PC では次から出さない
    pub fn office_dismiss_notices(&self) -> Result<OfficeStatus, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        let last = self
            .office_status_of(s)
            .notices
            .into_iter()
            .map(|n| n.at)
            .max();
        if let (Some(last), Some(set)) = (last, s.data.sharing.as_mut()) {
            set.notices_seen_at = Some(last);
            self.write_office(s)?;
        }
        Ok(self.office_status_of(s))
    }

    /// 事務所の共有をやめる（最後の1人だけ。0023 の10）: 共有フォルダの世帯をこの PC の中へ移し（PC の鍵置き場の新しい世帯の鍵で
    /// 暗号化し直し、開けることを確かめる）、名簿に「終えた」印を書いてから、共有フォルダの世帯ファイル・鍵の札・世帯の札を消す。
    /// `confirm` は自分の表示名（取り違えて押さないため）。ほかのメンバーがいる間はできない（先に外す）
    pub fn office_end(&self, confirm: &str) -> Result<OfficeStatus, StoreError> {
        self.end_shared(confirm, false)
    }

    /// 保存先をこの PC の中へ戻す（1人の FP が複数の PC で使う同期フォルダ。0024）: 手順は「共有をやめる」と同じ
    /// （世帯をこの PC の中へ写して開けることを確かめ、名簿に「終えた」印を書いてから、同期フォルダの世帯を消す）。
    /// もう1台の PC が名簿にいても、この PC だけでできる（同じ FP の PC なので。もう1台の PC は次に開いたとき「終わっています」と出る）。
    /// ただし、もう1台の PC で世帯を開いている間はしない（[`StoreError::SYNC_OTHER_PC_OPEN`]。保存が届く前に消さないため）。
    /// `confirm` はこの PC の呼び名
    pub fn sync_end(&self, confirm: &str) -> Result<OfficeStatus, StoreError> {
        self.end_shared(confirm, true)
    }

    fn end_shared(&self, confirm: &str, personal: bool) -> Result<OfficeStatus, StoreError> {
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        self.refresh_shared(s)?;
        let sh = Self::shared_mut(s)?;
        if personal && !sh.roster.personal() {
            return Err(StoreError::OFFICE_STATE);
        }
        if confirm.trim() != sh.me.name {
            return Err(StoreError::OFFICE_CONFIRM);
        }
        if personal {
            if !sh.presence_map(now).is_empty() {
                return Err(StoreError::SYNC_OTHER_PC_OPEN);
            }
        } else if sh
            .roster
            .members
            .iter()
            .any(|m| m.member_id != sh.me.member_id)
        {
            return Err(StoreError::OFFICE_OTHERS_REMAIN);
        }
        sh.leave_all();
        // 1. 共有フォルダの世帯を、この PC の中へ写す（途中で止まっても、共有フォルダはそのまま。やり直すと写していない世帯から続ける）
        let mut ids: Vec<String> = sh.list_cards().into_iter().map(|(id, _)| id).collect();
        if let Ok(rd) = fs::read_dir(sh.paths.households_dir()) {
            for e in rd.filter_map(|e| e.ok()) {
                let name = e.file_name().to_string_lossy().into_owned();
                if let Some(id) = name
                    .strip_suffix(&format!(".{HOUSEHOLD_EXT}"))
                    .filter(|i| crypto::is_uuid(i))
                {
                    ids.push(id.to_owned());
                }
            }
        }
        ids.sort();
        ids.dedup();
        for id in &ids {
            self.copy_to_local(s, id)?;
        }
        // 2. 名簿に「終えた」印（ここで共有の事務所は使えなくなる。復元キーで加わることもできない）
        let at = iso_of(now);
        let sh = Self::shared_mut(s)?;
        let mut r = sh.roster.clone();
        r.closed = Some(ClosedMark {
            closed_at: at.clone(),
            closed_by: sh.me.member_id.clone(),
        });
        r.updated_at = at;
        r.updated_by = Some(sh.me.member_id.clone());
        let m = sh.master.clone();
        sh.write_roster(r, &m)?;
        // 3. 共有フォルダの世帯ファイル・直前の世代・衝突の写し・世帯の札・開いている印・鍵の札・参加の申請を消す（失敗しても続ける）
        for id in &ids {
            let _ = sh.delete_household(id);
        }
        for q in files_starting_with(&sh.paths.requests_dir(), "") {
            let _ = fs::remove_file(q);
        }
        // 4. この PC の共有の設定と、保管庫の共有の事務所の鍵を片付ける（PC の中の事務所と、その復元キーに戻る）
        let office_id = sh.office_id.clone();
        // この PC の中の事務所の復元キーの保管の記録: 共有の鍵と同じ鍵（1人で複数の PC で、入れ替えていない）なら、共有の鍵の記録を写す。
        // 違う鍵なら、記録を消して保管を促す（入れ替えの後に古い控えを破棄していると、この PC の中の鍵の控えが無いことがあるため。0024）
        let shared_master = sh.master.clone();
        let shared_ack = sh.current_ack().cloned();
        if *shared_master == *s.master {
            if let Some(a) = shared_ack {
                s.data.recovery.acknowledged_at = Some(a.acknowledged_at);
                if a.verified_at.is_some() {
                    s.data.recovery.verified_at = a.verified_at;
                }
            }
        } else {
            s.data.recovery = RecoveryRecord::default();
        }
        s.data.sharing = None;
        s.shared = None;
        s.share_problem = None;
        self.write_office(s)?;
        let _ = self.secrets.delete(&member_account(&office_id));
        let _ = self.secrets.delete(&office_id);
        g.opened.clear();
        let s = Self::session(&mut g)?;
        Ok(self.office_status_of(s))
    }

    /// 共有の事務所の世帯を1つ、この PC の中へ写す（既に写してあれば何もしない）
    fn copy_to_local(&self, s: &mut Session, id: &str) -> Result<(), StoreError> {
        let local = self.household_path(id);
        if s.data.households.contains_key(id) && s.vault.contains(id) && local.exists() {
            return Ok(());
        }
        let sh = s.shared.as_ref().ok_or(StoreError::OFFICE_STATE)?;
        // 世帯の札だけがあって世帯ファイルがまだ届いていないときは、同期を待つ（消してしまわない）
        let bytes = match fs::read(sh.household_path(id)) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StoreError::OFFICE_WAITING_SYNC)
            }
            Err(_) => return Err(StoreError::IO),
        };
        let h = container::read_household_header(&bytes)?;
        if h.household_id != id {
            return Err(StoreError::CORRUPT);
        }
        let keys = sh.keys_for_read(id)?;
        let key = keys.find(&h.key_id).ok_or(StoreError::CORRUPT)?;
        let (_, plain) = container::open_household(&bytes, &key)?;
        let entry = match sh.read_card(id) {
            Ok(c) => CatalogEntry {
                customer_no: c.customer_no,
                summary: c.summary,
                created_at: c.created_at,
                updated_at: c.updated_at,
                label: c.label,
            },
            Err(_) => {
                let v: Value = serde_json::from_slice(&plain).map_err(|_| StoreError::CORRUPT)?;
                let text = |k: &str| {
                    v.pointer(&format!("/meta/{k}"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                };
                let saved = text("savedAt").unwrap_or_default();
                let customer_no = text("customerNo")
                    .filter(|c| valid_customer_no(c))
                    .unwrap_or_else(|| "NO-NUMBER".into());
                CatalogEntry {
                    label: crate::numbering::label_from_no(&customer_no),
                    customer_no,
                    summary: String::new(),
                    created_at: saved.clone(),
                    updated_at: saved,
                }
            }
        };
        let (key_id, k) = s.vault.insert_new(&s.master, id);
        if let Err(e) = self.write_vault(s) {
            s.vault.remove(id);
            return Err(e);
        }
        let header = HouseholdHeader {
            cipher: String::new(),
            compression: "none".into(),
            device_id: s.device_id.clone(),
            format: HOUSEHOLD_FORMAT.into(),
            format_version: h.format_version.clone(),
            generation: h.generation + 1,
            household_id: id.to_owned(),
            key_id,
            nonce: String::new(),
            parent_revision: None,
        };
        fs::create_dir_all(self.households_dir())?;
        atomic::replace(
            &local,
            &container::seal_household(header, &k, &plain),
            FailPoint::None,
        )?;
        // 書いたものが PC の中の鍵で開けることを確かめる
        let check = fs::read(&local)?;
        let (_, k2) = s.vault.unwrap_key(&s.master, id)?;
        container::open_household(&check, &k2)?;
        s.data.households.insert(id.to_owned(), entry);
        self.write_office(s)?;
        Ok(())
    }

    pub(super) fn shared_mut(s: &mut Session) -> Result<&mut Shared, StoreError> {
        s.shared.as_mut().ok_or(StoreError::OFFICE_STATE)
    }

    /// 参加の申請を承認する。`fingerprint` は、承認する人が新しいメンバーから別の経路で聞いて入力した指紋（0023 の3）
    pub fn office_approve(
        &self,
        request_id: &str,
        fingerprint: &str,
    ) -> Result<OfficeStatus, StoreError> {
        if !crypto::is_uuid(request_id) {
            return Err(StoreError::OFFICE_STATE);
        }
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        self.refresh_shared(s)?;
        let sh = Self::shared_mut(s)?;
        // 1人で複数の PC の同期フォルダには、ほかの人を加えない（PC は復元キーで加わる。0024）
        if sh.roster.personal() {
            return Err(StoreError::SYNC_PERSONAL);
        }
        // 申請のファイルを、承認のこの時点で読み直す（承認の直前に差し替えられても、入力した指紋と合わなければ承認しない）
        let bytes = fs::read(sh.paths.request(request_id)).map_err(|_| StoreError::OFFICE_STATE)?;
        let req: office::JoinRequest =
            serde_json::from_slice(&bytes).map_err(|_| StoreError::CORRUPT)?;
        let req = req.checked(&sh.office_id)?;
        if req.member_id != request_id {
            return Err(StoreError::CORRUPT);
        }
        sh.require_recovery()?;
        let public = req.public()?;
        if !member::fingerprint_matches(fingerprint, &public) {
            return Err(StoreError::OFFICE_FINGERPRINT);
        }
        if sh.roster.member(request_id).is_none() {
            let mut r = sh.roster.clone();
            r.members.push(Member {
                member_id: req.member_id.clone(),
                display_name: req.display_name.trim().to_owned(),
                public_key: req.public_key.clone(),
                fingerprint: member::fingerprint(&public),
                joined_at: iso_of(now),
                approved_by: Some(sh.me.member_id.clone()),
                role: office::ROLE_MEMBER.into(),
            });
            r.updated_at = iso_of(now);
            r.updated_by = Some(sh.me.member_id.clone());
            let m = sh.master.clone();
            sh.write_roster(r, &m)?;
        }
        let _ = fs::remove_file(sh.paths.request(request_id));
        Ok(self.office_status_of(s))
    }

    /// 参加の申請を断る（申請のファイルを消す）
    pub fn office_reject(&self, request_id: &str) -> Result<OfficeStatus, StoreError> {
        if !crypto::is_uuid(request_id) {
            return Err(StoreError::OFFICE_STATE);
        }
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        self.refresh_shared(s)?;
        let sh = Self::shared_mut(s)?;
        remove_if_exists(&sh.paths.request(request_id))?;
        Ok(self.office_status_of(s))
    }

    /// メンバーを外す: 親鍵を新しくして残りのメンバーにだけ包み直し、すべての世帯の鍵も新しくする（0023 の4）。
    /// `confirm` は外す人の表示名（取り違えて外さないため）
    pub fn office_remove(
        &self,
        member_id: &str,
        confirm: &str,
    ) -> Result<OfficeStatus, StoreError> {
        let mut g = self.lock();
        let now = self.now();
        let s = Self::session(&mut g)?;
        self.refresh_shared(s)?;
        let sh = Self::shared_mut(s)?;
        if member_id == sh.me.member_id {
            return Err(StoreError::OFFICE_SELF);
        }
        sh.require_recovery()?;
        let target = sh
            .roster
            .member(member_id)
            .cloned()
            .ok_or(StoreError::OFFICE_STATE)?;
        if confirm.trim() != target.display_name {
            return Err(StoreError::OFFICE_CONFIRM);
        }
        if sh.roster.members.len() <= 1 {
            return Err(StoreError::OFFICE_SELF);
        }
        let at = iso_of(now);
        let old_mk = sh.roster.master_key_id.clone();
        let old_master = sh.master.clone();
        let new_master = crypto::random_key();
        let new_mk = crypto::new_uuid();
        // 1. すべての世帯の鍵を新しくして、新しい時代のフォルダへ（今の時代＋前の時代の迷子の札）
        let mut ids: Vec<(String, HouseholdKeys)> = vec![];
        let mut seen = HashSet::new();
        let mut epochs: Vec<(String, Key)> = vec![(old_mk.clone(), old_master.clone())];
        epochs.extend(
            sh.roster
                .previous
                .iter()
                .map(|p| (p.master_key_id.clone(), p.key.clone())),
        );
        for (mk, m) in &epochs {
            if let Ok(rd) = fs::read_dir(sh.paths.keys_dir(mk)) {
                for e in rd.filter_map(|e| e.ok()) {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let Some(id) = name.strip_suffix(".lphk").filter(|i| crypto::is_uuid(i)) else {
                        continue;
                    };
                    if !seen.insert(id.to_owned()) {
                        continue;
                    }
                    let b = fs::read(e.path())?;
                    let k = office::open_keys(&b, id, m)?;
                    ids.push((id.to_owned(), k.rotated()));
                }
            }
        }
        let new_dir = sh.paths.keys_dir(&new_mk);
        fs::create_dir_all(&new_dir)?;
        for (id, k) in &ids {
            if let Err(e) = sh.write_keys(&new_mk, &new_master, id, k) {
                let _ = fs::remove_dir_all(&new_dir);
                return Err(e);
            }
        }
        // 2. 名簿を書き直す（ここで入れ替えが成り立つ）
        let mut r = sh.roster.clone();
        r.members.retain(|m| m.member_id != member_id);
        r.removed.push(RemovedMember {
            member_id: target.member_id.clone(),
            display_name: target.display_name.clone(),
            removed_at: at.clone(),
            removed_by: Some(sh.me.member_id.clone()),
        });
        r.previous.insert(
            0,
            PreviousMaster {
                master_key_id: old_mk.clone(),
                key: old_master.clone(),
                retired_at: at.clone(),
            },
        );
        r.master_key_id = new_mk.clone();
        r.recovery = None;
        r.updated_at = at.clone();
        r.updated_by = Some(sh.me.member_id.clone());
        if let Err(e) = sh.write_roster(r, &new_master) {
            let _ = fs::remove_dir_all(&new_dir);
            return Err(e);
        }
        // 3. 自分の保管庫の親鍵の写しを入れ替え、世帯の札・開いている印を新しい親鍵で書き直す
        self.secrets.set(
            &sh.office_id,
            &Zeroizing::new(crypto::hex_encode(new_master.as_ref())),
        )?;
        let cards: Vec<(String, Card)> = sh.list_cards();
        sh.master = new_master;
        for (id, c) in cards {
            sh.write_card(&id, &c)?;
        }
        for p in fs::read_dir(sh.paths.presence_dir())
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
        {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if office::presence_ids(&name).is_some_and(|(_, m)| m == member_id) {
                let _ = fs::remove_file(&p);
            }
        }
        let open_ids: Vec<(String, (i64, i64))> =
            sh.present.iter().map(|(k, v)| (k.clone(), *v)).collect();
        for (id, (opened, _)) in open_ids {
            sh.write_presence(&id, opened, now);
        }
        // 1人で複数の PC: この PC の中の事務所の鍵も、新しい同期フォルダの鍵にそろえる（0024）
        if sh.roster.personal() {
            let m = sh.master.clone();
            let _ = self.adopt_local_master(s, &m);
        }
        Ok(self.office_status_of(s))
    }

    /// このPCの中の世帯を、共有フォルダへ移す（0023 の8）。移した数
    pub fn office_move_local(&self) -> Result<usize, StoreError> {
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        self.refresh_shared(s)?;
        let n = self.move_local(s)?;
        g.opened.clear();
        Ok(n)
    }

    /// 世帯ごとに、PCの中の鍵で開き、共有の事務所の新しい世帯の鍵で暗号化し直して共有フォルダに書き、
    /// 開けることを確かめてから、PCの中の世帯ファイル（直前の世代を含む）とその鍵を消す
    fn move_local(&self, s: &mut Session) -> Result<usize, StoreError> {
        if s.shared.is_none() {
            return Err(StoreError::OFFICE_STATE);
        }
        let ids: Vec<String> = s.data.households.keys().cloned().collect();
        let mut moved = 0;
        for id in ids {
            let path = self.household_path(&id);
            let entry = s.data.households.get(&id).cloned().expect("一覧の世帯");
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let header = container::read_household_header(&bytes)?;
            let (key_id, key) = s.vault.unwrap_key(&s.master, &id)?;
            if header.key_id != key_id || header.household_id != id {
                return Err(StoreError::CORRUPT);
            }
            let (_, plain) = container::open_household(&bytes, &key)?;
            let sh = s.shared.as_ref().expect("共有の事務所");
            let target = sh.household_path(&id);
            if !target.exists() {
                let hk = sh.create_keys(&id)?;
                let new_header = HouseholdHeader {
                    cipher: String::new(),
                    compression: "none".into(),
                    device_id: s.device_id.clone(),
                    format: HOUSEHOLD_FORMAT.into(),
                    format_version: header.format_version.clone(),
                    generation: header.generation + 1,
                    household_id: id.clone(),
                    key_id: hk.current_id.clone(),
                    nonce: String::new(),
                    parent_revision: None,
                };
                let out = container::seal_household(new_header, &hk.current, &plain);
                atomic::replace(&target, &out, FailPoint::None)?;
                sh.write_card(
                    &id,
                    &Card {
                        customer_no: entry.customer_no.clone(),
                        summary: entry.summary.clone(),
                        created_at: entry.created_at.clone(),
                        updated_at: entry.updated_at.clone(),
                        updated_by: None,
                        generation: header.generation + 1,
                        label: entry.label.clone(),
                    },
                )?;
            }
            // 書いたものが開けることを確かめる
            let check = fs::read(&target)?;
            let h2 = container::read_household_header(&check)?;
            let k2 = sh.keys_for_read(&id)?;
            let key2 = k2.find(&h2.key_id).ok_or(StoreError::CORRUPT)?;
            container::open_household(&check, &key2)?;
            sh.read_card(&id)?;
            // PCの中の写しと鍵を消す
            for p in [path.clone(), atomic::prev_path(&path)]
                .into_iter()
                .chain(atomic::temp_files(&path))
            {
                remove_if_exists(&p)?;
            }
            s.vault.remove(&id);
            self.write_vault(s)?;
            s.data.households.remove(&id);
            self.write_office(s)?;
            moved += 1;
        }
        Ok(moved)
    }

    /// 開いている印を新しくする（アプリ本体が定期的に呼ぶ。1分ごとに書く）
    pub fn heartbeat(&self) {
        let mut g = self.lock();
        let now = self.now();
        if let Some(sh) = g.session.as_mut().and_then(|s| s.shared.as_mut()) {
            sh.heartbeat(now);
        }
    }

    /// 自分の開いている印をすべて消す（アプリを閉じるとき）
    pub fn leave_all(&self) {
        let mut g = self.lock();
        if let Some(sh) = g.session.as_mut().and_then(|s| s.shared.as_mut()) {
            sh.leave_all();
        }
    }

    /// 分岐を選ぶ画面の材料
    pub fn fork_info(&self, id: &str) -> Result<ForkInfo, StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let mut g = self.lock();
        let conflict = g.opened.get(id).and_then(|st| st.conflict.clone());
        let s = Self::session(&mut g)?;
        Self::usable(s)?;
        let bytes = fs::read(self.hh_path(s, id)).map_err(|_| StoreError::UNKNOWN_HOUSEHOLD)?;
        let h = container::read_household_header(&bytes)?;
        let keys = self.keys_for_read(s, id)?;
        let key = keys.find(&h.key_id).ok_or(StoreError::CORRUPT)?;
        let (_, plain) = container::open_household(&bytes, &key)?;
        let v: Value = serde_json::from_slice(&plain).map_err(|_| StoreError::CORRUPT)?;
        let ours_generation = conflict
            .as_ref()
            .and_then(|p| fs::read(p).ok())
            .and_then(|b| container::read_household_header(&b).ok())
            .map(|h| h.generation);
        Ok(ForkInfo {
            saved_conflict: conflict.is_some(),
            theirs_saved_at: v
                .pointer("/meta/savedAt")
                .and_then(Value::as_str)
                .map(str::to_owned),
            theirs_by: v
                .pointer("/meta/savedBy/name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            theirs_generation: h.generation,
            ours_generation,
            sync_copies: sync_copy_names(&self.hh_dir(s)).get(id).map_or(0, Vec::len),
            personal: s.shared.as_ref().is_some_and(|sh| sh.roster.personal()),
        })
    }

    /// 保存先と同期の知らせ（世帯の一覧・保存先・事務所の設定のパネルに出す。画面の上の帯の「知らせ」にまとめられる形。0024）。
    /// パス・鍵は入れない。種類は [`StorageNotice`]
    pub fn storage_notices(&self) -> Result<Vec<StorageNotice>, StoreError> {
        let status = self.status()?;
        if status.state == StatusState::NeedsRecovery {
            return Ok(vec![StorageNotice::new("needsRecovery", "alert", "local")]);
        }
        let of = self.office_status()?;
        let scope = match of.usage.as_deref() {
            None => "local",
            Some(office::USAGE_PERSONAL) => "personal",
            Some(_) => "office",
        };
        let mut out = vec![];
        match of.state.as_str() {
            "unavailable" if of.problem.as_deref() == Some(StoreError::OFFICE_CLOSED.code()) => {
                out.push(StorageNotice::new("closed", "warn", scope));
            }
            "unavailable" => out.push(StorageNotice {
                code: of.problem.clone(),
                ..StorageNotice::new("unavailable", "warn", scope)
            }),
            "removed" => out.push(StorageNotice::new("removed", "alert", scope)),
            "pending" => out.push(StorageNotice::new("pending", "info", scope)),
            _ => {}
        }
        if !status.recovery_acknowledged {
            let level = if scope == "local" { "info" } else { "warn" };
            out.push(StorageNotice::new("recoveryNotKept", level, scope));
        }
        for n in &of.notices {
            out.push(StorageNotice {
                name: Some(n.name.clone()),
                at: Some(n.at.clone()),
                ..StorageNotice::new(&n.kind, "alert", scope)
            });
        }
        if !of.requests.is_empty() {
            let level = if scope == "personal" { "alert" } else { "info" };
            out.push(StorageNotice {
                count: Some(of.requests.len()),
                ..StorageNotice::new("joinRequest", level, scope)
            });
        }
        if of.state == "member" && of.local_households > 0 {
            out.push(StorageNotice {
                count: Some(of.local_households),
                ..StorageNotice::new("localHouseholds", "info", scope)
            });
        }
        if let Ok(list) = self.list() {
            let n = list.iter().filter(|e| e.forks > 0).count();
            if n > 0 {
                out.push(StorageNotice {
                    count: Some(n),
                    ..StorageNotice::new("syncCopies", "warn", scope)
                });
            }
        }
        Ok(out)
    }

    /// 保存のときに見つけた分岐を選ぶ。相手を残すなら開き直し、こちらで上書きするなら相手の改訂も `conflicts/` に残してから保存する
    pub fn resolve_fork(&self, id: &str, choice: ForkChoice) -> Result<Opened, StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        if choice == ForkChoice::Theirs {
            return self.open(id);
        }
        let (body, summary) = {
            let mut g = self.lock();
            let conflict = g
                .opened
                .get(id)
                .and_then(|st| st.conflict.clone())
                .ok_or(StoreError::NO_FORK)?;
            let s = Self::session(&mut g)?;
            Self::usable(s)?;
            let ours = fs::read(&conflict).map_err(|_| StoreError::NO_FORK)?;
            let oh = container::read_household_header(&ours)?;
            if oh.household_id != id {
                return Err(StoreError::CORRUPT);
            }
            let keys = self.keys_for_read(s, id)?;
            let key = keys.find(&oh.key_id).ok_or(StoreError::CORRUPT)?;
            let (_, plain) = container::open_household(&ours, &key)?;
            let current = fs::read(self.hh_path(s, id)).map_err(|_| StoreError::IO)?;
            let ch = container::read_household_header(&current)?;
            // 相手の改訂を残す
            atomic::replace(
                &self.aside_path(id, ch.generation, "theirs"),
                &current,
                FailPoint::None,
            )?;
            let ck = keys.find(&ch.key_id).ok_or(StoreError::CORRUPT)?;
            let (_, cplain) = container::open_household(&current, &ck)?;
            let cv: Value = serde_json::from_slice(&cplain).map_err(|_| StoreError::CORRUPT)?;
            let summary = match &s.shared {
                Some(sh) => sh.read_card(id)?.summary,
                None => s
                    .data
                    .households
                    .get(id)
                    .map(|e| e.summary.clone())
                    .unwrap_or_default(),
            };
            let carry = MetaCarry::from_meta(cv.get("meta"));
            if let Some(st) = g.opened.get_mut(id) {
                st.parent_revision = crypto::digest(&current);
                st.generation = ch.generation;
                st.carry = carry;
                st.conflict = None;
                st.read_only = false;
            }
            (String::from_utf8_lossy(&plain).into_owned(), summary)
        };
        self.save(id, &body, &summary)?;
        self.open(id)
    }

    /// 同期サービスの衝突の写しを片付ける。`adopt` なら一番新しい写しを今の内容にする（今の内容は `conflicts/` に残す）
    pub fn resolve_sync_copies(&self, id: &str, adopt: bool) -> Result<(), StoreError> {
        if !crypto::is_uuid(id) {
            return Err(StoreError::UNKNOWN_HOUSEHOLD);
        }
        let mut g = self.lock();
        let s = Self::session(&mut g)?;
        Self::usable(s)?;
        let copies = sync_copy_names(&self.hh_dir(s))
            .remove(id)
            .unwrap_or_default();
        if copies.is_empty() {
            return Err(StoreError::NO_FORK);
        }
        if adopt {
            let keys = self.keys_for_read(s, id)?;
            let mut best: Option<(u64, Vec<u8>)> = None;
            for p in &copies {
                let Ok(b) = fs::read(p) else { continue };
                let Ok(h) = container::read_household_header(&b) else {
                    continue;
                };
                let Some(k) = keys.find(&h.key_id) else {
                    continue;
                };
                if h.household_id == id
                    && container::open_household(&b, &k).is_ok()
                    && best.as_ref().is_none_or(|(g0, _)| h.generation > *g0)
                {
                    best = Some((h.generation, b));
                }
            }
            let (_, b) = best.ok_or(StoreError::CORRUPT)?;
            let path = self.hh_path(s, id);
            if let Ok(cur) = fs::read(&path) {
                let gen = container::read_household_header(&cur)
                    .map(|h| h.generation)
                    .unwrap_or(0);
                atomic::replace(&self.aside_path(id, gen, "replaced"), &cur, FailPoint::None)?;
            }
            atomic::replace(&path, &b, FailPoint::None)?;
        }
        for (i, p) in copies.iter().enumerate() {
            let b = fs::read(p)?;
            let gen = container::read_household_header(&b)
                .map(|h| h.generation)
                .unwrap_or(0);
            atomic::replace(
                &self.aside_path(id, gen, &format!("sync{i}")),
                &b,
                FailPoint::None,
            )?;
            remove_if_exists(p)?;
        }
        g.opened.remove(id);
        Ok(())
    }

    /// 試験用: 共有フォルダの、自分の開いている印を書き直す（時計を進めた後の確かめ）
    #[doc(hidden)]
    pub fn shared_root_for_test(&self) -> Option<PathBuf> {
        let mut g = self.lock();
        let s = Self::session(&mut g).ok()?;
        s.shared.as_ref().map(|sh| sh.paths.root.clone())
    }
}

/// 申請の一覧（壊れた・別の事務所の申請は出さない）
fn read_requests(paths: &Paths, office_id: &str) -> Vec<office::JoinRequest> {
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(paths.requests_dir()) {
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".json").filter(|i| crypto::is_uuid(i)) else {
                continue;
            };
            let Ok(b) = fs::read(e.path()) else { continue };
            let Ok(r) = serde_json::from_slice::<office::JoinRequest>(&b) else {
                continue;
            };
            if let Ok(r) = r.checked(office_id) {
                if r.member_id == id {
                    out.push(r);
                }
            }
        }
    }
    out.sort_by(|a, b| a.requested_at.cmp(&b.requested_at));
    out
}
