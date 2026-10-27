// 1人の FP が2台の PC で使う同期フォルダの試験（0024 の「テストで確かめること」）。
// 2台の PC を「別々のデータフォルダ＋それぞれのメモリの保管庫＋同じ同期フォルダ（テスト用の一時フォルダ）」で模す。
// OS の保管庫には触れない。
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::office;
use household_store::{
    crypto, recovery, Clock, CreateRequest, ForkChoice, MemorySecretStore, SecretStore, Store,
    StoreError,
};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl TestClock {
    fn new() -> TestClock {
        // 2026-10-19 09:00:00Z
        TestClock(Arc::new(AtomicI64::new(1_792_368_000 + 9 * 3600)))
    }
    fn advance(&self, secs: i64) {
        self.0.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// 1台の PC（データフォルダと保管庫）
struct Pc {
    root: PathBuf,
    secrets: Arc<MemorySecretStore>,
    clock: TestClock,
}

impl Pc {
    fn store(&self) -> Store {
        Store::new(
            self.root.clone(),
            self.secrets.clone(),
            self.clock.clone(),
            "0.1.0-test",
        )
    }
    /// この PC の中の事務所の ID（データフォルダの office.json）
    fn office_id(&self) -> String {
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(self.root.join("office.json")).unwrap())
                .unwrap();
        v["officeId"].as_str().unwrap().to_owned()
    }
}

/// 同期フォルダと、2台の PC
struct World {
    base: PathBuf,
    sync: PathBuf,
    clock: TestClock,
}

impl World {
    fn new() -> World {
        let base = std::env::temp_dir().join(format!("hs-sync-{}", crypto::new_uuid()));
        let sync = base.join("同期フォルダ");
        std::fs::create_dir_all(&sync).unwrap();
        World {
            base,
            sync,
            clock: TestClock::new(),
        }
    }
    fn pc(&self, name: &str) -> Pc {
        Pc {
            root: self.base.join(format!("pc-{name}")).join("data"),
            secrets: Arc::new(MemorySecretStore::default()),
            clock: self.clock.clone(),
        }
    }
    fn office_root(&self) -> PathBuf {
        self.sync.join(office::OFFICE_DIR)
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

fn body(n: i64) -> String {
    serde_json::json!({
        "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"members": [{"id": "m1", "kind": "self"}]}}}, "memo": ["架空のメモ"]},
        "proposals": [{"id": "p1", "title": "B案", "n": n}],
        "workspace": {"band": ["p1"], "base": "current", "selected": "p1"},
        "display": {"metrics": ["takeHome"], "atAge": 90},
        "extDefinitions": {},
        "ext": {}
    })
    .to_string()
}

fn n_of(body: &str) -> i64 {
    serde_json::from_str::<serde_json::Value>(body).unwrap()["proposals"][0]["n"]
        .as_i64()
        .unwrap()
}

fn create(store: &Store, n: i64) -> household_store::Opened {
    store
        .create(CreateRequest {
            body: body(n),
            summary: "本人".into(),
        })
        .unwrap()
}

/// 顧客番号が平文で書かれているか。番号（例 `0001`）は数字だけのことが多く、平文の見出しの16進の文字列
/// （ノンス・ID）の中にたまたま同じ並びが出るため、番号だけでは探さない。平文で書けば JSON の値として
/// 引用符で囲まれ（`"0001"`）、欄の名前（`customerNo`）も並ぶので、その形で探す
fn shows_customer_no(text: &str, customer_no: &str) -> bool {
    text.contains("customerNo") || text.contains(&format!("\"{customer_no}\""))
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                out.extend(files_under(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

fn kinds(store: &Store) -> Vec<String> {
    store
        .storage_notices()
        .unwrap()
        .into_iter()
        .map(|n| n.kind)
        .collect()
}

/// 1台目: 世帯を作り、復元キーを保管してから、保存先を同期フォルダにする
fn first_pc(w: &World, a: &Store) -> String {
    a.status().unwrap();
    a.acknowledge_recovery().unwrap();
    let st = a.sync_start(&w.sync, "事務所のPC", true, &[]).unwrap();
    assert_eq!(st.state, "member");
    assert_eq!(st.usage.as_deref(), Some("personal"));
    a.recovery_key().unwrap().to_string()
}

/// 2台目: 初めて起動して、すでに使っている同期フォルダを復元キーで開く
fn second_pc(w: &World, b: &Store, key: &str) {
    let st = b.status().unwrap();
    assert!(st.first_run);
    let st = b
        .sync_open(&w.sync, "自宅のノート", key, true, &[])
        .unwrap();
    assert_eq!(st.state, "member");
    assert_eq!(st.usage.as_deref(), Some("personal"));
}

#[test]
fn moving_to_the_sync_folder_and_back_keeps_the_households_encrypted() {
    let w = World::new();
    let pa = w.pc("a");
    let a = pa.store();
    a.status().unwrap();
    let h1 = create(&a, 1);
    let h2 = create(&a, 2);
    let key_before = a.recovery_key().unwrap().to_string();
    // 復元キーを保管するまでは、同期フォルダへ移さない（2台目で開くときに要る）
    assert_eq!(
        a.sync_start(&w.sync, "事務所のPC", true, &[]).unwrap_err(),
        StoreError::SYNC_RECOVERY_REQUIRED
    );
    assert!(!w.office_root().exists());
    a.acknowledge_recovery().unwrap();
    // 呼び名の形・選べない場所（データフォルダ）
    assert_eq!(
        a.sync_start(&w.sync, "", true, &[]).unwrap_err(),
        StoreError::OFFICE_NAME
    );
    assert_eq!(
        a.sync_start(&pa.root, "事務所のPC", true, &[]).unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    let st = a.sync_start(&w.sync, "事務所のPC", true, &[]).unwrap();
    assert_eq!(st.local_households, 0);
    // 今の事務所の鍵をそのまま使う: 保管済みの復元キーが、そのまま同期フォルダの復元キー。保管済みの記録も引き継ぐ
    assert_eq!(a.recovery_key().unwrap().to_string(), key_before);
    assert!(a.status().unwrap().recovery_acknowledged);
    assert!(!st.recovery_required);
    // 世帯は同期フォルダに暗号化したまま移り、PC の中の世帯ファイルと鍵は消える
    let local: Vec<PathBuf> = files_under(&pa.root.join("households"));
    assert!(local.is_empty(), "{local:?}");
    for p in files_under(&w.office_root()) {
        let text = String::from_utf8_lossy(&std::fs::read(&p).unwrap()).into_owned();
        assert!(!text.contains("架空のメモ"), "{p:?}");
        assert!(!shows_customer_no(&text, &h1.customer_no), "{p:?}");
        assert!(!text.contains("事務所のPC") || p.extension().is_some_and(|e| e == "json"));
    }
    let list = a.list().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(n_of(&a.open(&h2.id).unwrap().body), 2);
    a.save(&h2.id, &body(22), "本人").unwrap();
    // アプリを開き直しても、復元キーなしで同期フォルダの世帯を開ける
    let a2 = pa.store();
    a2.status().unwrap();
    assert_eq!(n_of(&a2.open(&h2.id).unwrap().body), 22);
    assert!(kinds(&a2).is_empty(), "{:?}", kinds(&a2));
    // この PC の中へ戻す: 確認の呼び名が違えば戻さない
    assert_eq!(
        a2.sync_end("自宅のノート").unwrap_err(),
        StoreError::OFFICE_CONFIRM
    );
    let st = a2.sync_end("事務所のPC").unwrap();
    assert_eq!(st.state, "off");
    assert!(st.usage.is_none());
    let list = a2.list().unwrap();
    assert_eq!(list.len(), 2);
    for (h, n) in [(&h1, 1), (&h2, 22)] {
        let p = pa.root.join("households").join(format!("{}.lphf", h.id));
        let raw = std::fs::read(&p).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("架空のメモ"));
        assert_eq!(n_of(&a2.open(&h.id).unwrap().body), n);
    }
    a2.save(&h1.id, &body(11), "本人").unwrap();
    // 同じ鍵のまま戻ったので、復元キーも保管済みの記録もそのまま
    assert_eq!(a2.recovery_key().unwrap().to_string(), key_before);
    assert!(a2.status().unwrap().recovery_acknowledged);
    // 同期フォルダの世帯ファイル・鍵の札・世帯の札は消える（名簿の「終えた」印は残る）
    let left: Vec<PathBuf> = files_under(&w.office_root())
        .into_iter()
        .filter(|p| {
            let s = p.to_string_lossy();
            s.contains(".lphf") || s.ends_with(".lphk") || s.ends_with(".lpcd")
        })
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn the_second_pc_opens_with_the_recovery_key_and_then_without_it() {
    let w = World::new();
    let (pa, pb, pc) = (w.pc("a"), w.pc("b"), w.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    b.status().unwrap();
    // 違う復元キー（別の PC の鍵）では開けない。打ち間違いは打ち間違いとして出す
    c.status().unwrap();
    let other = c.recovery_key().unwrap().to_string();
    assert_eq!(
        b.sync_open(&w.sync, "自宅のノート", &other, true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    let mut typo = key.clone();
    typo.replace_range(0..1, if key.starts_with('A') { "B" } else { "A" });
    assert_eq!(
        b.sync_open(&w.sync, "自宅のノート", &typo, true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_TYPO
    );
    // 同期フォルダの事務所が無いフォルダ
    let empty = w.base.join("空のフォルダ");
    std::fs::create_dir_all(&empty).unwrap();
    assert_eq!(
        b.sync_open(&empty, "自宅のノート", &key, true, &[])
            .unwrap_err(),
        StoreError::OFFICE_NOT_FOUND
    );
    assert_eq!(b.office_status().unwrap().state, "off");
    second_pc(&w, &b, &key);
    // 2台目で開ける・直せる。1台目に届く
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 1);
    b.save(&h.id, &body(5), "本人").unwrap();
    b.leave_all();
    assert_eq!(n_of(&a.open(&h.id).unwrap().body), 5);
    let row = a
        .list()
        .unwrap()
        .into_iter()
        .find(|e| e.id == h.id)
        .unwrap();
    assert_eq!(row.updated_by.as_deref(), Some("自宅のノート"));
    // 2台目の中の事務所の鍵も同期フォルダの鍵にそろう（復元キーは1つで足りる）
    assert_eq!(b.recovery_key().unwrap().to_string(), key);
    assert!(b.status().unwrap().recovery_acknowledged);
    // 2台目のアプリを開き直す: 保管庫に鍵があるので、復元キーなしで開ける
    let b2 = pb.store();
    assert_eq!(
        b2.status().unwrap().state,
        household_store::StatusState::Ready
    );
    assert_eq!(n_of(&b2.open(&h.id).unwrap().body), 5);
    // 1台目には「復元キーで PC が加わった」の知らせが出る（見たら出ない）。2台目自身には出ない
    let st = a.office_status().unwrap();
    assert_eq!(st.notices.len(), 1);
    assert_eq!(st.notices[0].name, "自宅のノート");
    assert!(kinds(&a).contains(&"recoveryJoin".to_owned()));
    assert!(b2.office_status().unwrap().notices.is_empty());
    a.office_dismiss_notices().unwrap();
    assert!(!kinds(&a).contains(&"recoveryJoin".to_owned()));
    // 名簿には2台の PC が並ぶ（2台目は復元キーで加わった PC）
    let members = a.office_status().unwrap().members;
    assert_eq!(members.len(), 2);
    assert!(members
        .iter()
        .any(|m| m.name == "自宅のノート" && m.via_recovery && !m.is_me));
}

#[test]
fn the_second_pc_recovers_its_own_keychain_with_the_same_recovery_key() {
    let w = World::new();
    let (pa, pb) = (w.pc("a"), w.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    let h = create(&a, 3);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    // 2台目の保管庫の鍵がすべて消えた（OS の入れ直しなど。データフォルダは残っている）
    let local_id = pb.office_id();
    let shared_id: String = serde_json::from_str::<serde_json::Value>(
        &std::fs::read_to_string(w.office_root().join("office.json")).unwrap(),
    )
    .unwrap()["officeId"]
        .as_str()
        .unwrap()
        .to_owned();
    for account in [
        local_id.clone(),
        shared_id.clone(),
        format!("{shared_id}.member"),
    ] {
        pb.secrets.delete(&account).unwrap();
    }
    let b2 = pb.store();
    assert_eq!(
        b2.status().unwrap().state,
        household_store::StatusState::NeedsRecovery
    );
    // 同じ復元キー（同期フォルダの鍵）で、2台目の中の事務所の鍵を戻せる
    b2.restore_with_recovery_key(&key).unwrap();
    // メンバーの秘密鍵は戻らないので、同期フォルダは使えない状態。開き直す（設定を片付けて、復元キーで開く）
    let st = b2.office_status().unwrap();
    assert_eq!(st.state, "unavailable");
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_KEY_MISSING"));
    b2.office_leave_setting().unwrap();
    b2.sync_open(&w.sync, "自宅のノート", &key, true, &[])
        .unwrap();
    assert_eq!(n_of(&b2.open(&h.id).unwrap().body), 3);
}

#[test]
fn an_interrupted_key_alignment_finishes_on_the_next_start() {
    for step in 1..=4u8 {
        let w = World::new();
        let (pa, pb) = (w.pc("a"), w.pc("b"));
        let (a, b) = (pa.store(), pb.store());
        a.status().unwrap();
        let h = create(&a, 4);
        let key = first_pc(&w, &a);
        // 2台目は、前から PC の中に世帯を持っていた
        b.status().unwrap();
        let mine = create(&b, 40);
        // 鍵をそろえる途中（step 段目の後）で落ちた
        b.set_rekey_stop_for_test(step);
        b.sync_open(&w.sync, "自宅のノート", &key, true, &[])
            .unwrap();
        drop(b);
        // 次の起動で続きから終える。PC の中の世帯も同期フォルダの世帯も開ける
        let b2 = pb.store();
        assert_eq!(
            b2.status().unwrap().state,
            household_store::StatusState::Ready,
            "step {step}"
        );
        assert_eq!(b2.recovery_key().unwrap().to_string(), key, "step {step}");
        assert!(pb
            .secrets
            .get(&format!("{}.next", pb.office_id()))
            .unwrap()
            .is_none());
        assert_eq!(n_of(&b2.open(&h.id).unwrap().body), 4, "step {step}");
        assert_eq!(b2.office_status().unwrap().local_households, 1);
        assert_eq!(b2.office_move_local().unwrap(), 1, "step {step}");
        assert_eq!(n_of(&b2.open(&mine.id).unwrap().body), 40, "step {step}");
    }
}

#[test]
fn simultaneous_edits_on_two_pcs_fork_and_show_presence() {
    let w = World::new();
    let (pa, pb) = (w.pc("a"), w.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    a.open(&h.id).unwrap();
    // 開いている印: もう1台の PC が開いていると出る（PC の呼び名で）
    let o = b.open(&h.id).unwrap();
    assert_eq!(o.others_open.len(), 1);
    assert_eq!(o.others_open[0].name, "事務所のPC");
    let row = a
        .list()
        .unwrap()
        .into_iter()
        .find(|e| e.id == h.id)
        .unwrap();
    assert_eq!(row.open_by[0].name, "自宅のノート");
    // 2台で同時に直した: 後から保存したほうは上書きせず、分岐として選ばせる
    b.save(&h.id, &body(20), "本人").unwrap();
    assert_eq!(
        a.save(&h.id, &body(10), "本人").unwrap_err(),
        StoreError::CONFLICT
    );
    let info = a.fork_info(&h.id).unwrap();
    assert!(info.saved_conflict && info.personal);
    assert_eq!(info.theirs_by.as_deref(), Some("自宅のノート"));
    let r = a.resolve_fork(&h.id, ForkChoice::Ours).unwrap();
    assert_eq!(n_of(&r.body), 10);
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 10);
    // 開いている印は5分で無効になる
    w.clock.advance(office::PRESENCE_TTL_SECS + 1);
    assert!(b
        .list()
        .unwrap()
        .iter()
        .all(|e| e.open_by.is_empty() || e.id != h.id));
    // 同期サービスの衝突の写し: 一覧と知らせに出て、写しを今の内容にできる
    let dir = w.office_root().join("households");
    let prev = std::fs::read(dir.join(format!("{}.lphf.prev", h.id))).unwrap();
    std::fs::write(
        dir.join(format!("{} (自宅のノートの衝突コピー).lphf", h.id)),
        &prev,
    )
    .unwrap();
    assert!(kinds(&b).contains(&"syncCopies".to_owned()));
    assert_eq!(b.fork_info(&h.id).unwrap().sync_copies, 1);
    b.resolve_sync_copies(&h.id, true).unwrap();
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 20);
    assert!(!kinds(&b).contains(&"syncCopies".to_owned()));
}

#[test]
fn back_to_this_pc_from_one_of_two_pcs() {
    let w = World::new();
    let (pa, pb) = (w.pc("a"), w.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    let h2 = create(&b, 2);
    // もう1台の PC で世帯を開いている間は戻さない（保存が届く前に消さない）
    b.open(&h.id).unwrap();
    assert_eq!(
        a.sync_end("事務所のPC").unwrap_err(),
        StoreError::SYNC_OTHER_PC_OPEN
    );
    // 事務所での共有の「やめる」は、ほかの PC がいる間はできないまま
    assert_eq!(
        a.office_end("事務所のPC").unwrap_err(),
        StoreError::OFFICE_OTHERS_REMAIN
    );
    b.leave_all();
    let st = a.sync_end("事務所のPC").unwrap();
    assert_eq!(st.state, "off");
    assert_eq!(a.list().unwrap().len(), 2);
    assert_eq!(n_of(&a.open(&h2.id).unwrap().body), 2);
    // もう1台の PC は「終わっています」になり、この PC の中の事務所に戻れる（世帯は1台目の中にある）
    let st = b.office_status().unwrap();
    assert_eq!(st.state, "unavailable");
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_CLOSED"));
    assert_eq!(st.usage.as_deref(), Some("personal"));
    assert!(kinds(&b).contains(&"closed".to_owned()));
    assert_eq!(b.list().unwrap_err(), StoreError::OFFICE_CLOSED);
    let st = b.office_leave_setting().unwrap();
    assert_eq!(st.state, "off");
    assert!(b.list().unwrap().is_empty());
    // 終えた同期フォルダは、復元キーでも開けない
    let pc = w.pc("c");
    let c = pc.store();
    c.status().unwrap();
    assert_eq!(
        c.sync_open(&w.sync, "新しいPC", &key, true, &[])
            .unwrap_err(),
        StoreError::OFFICE_CLOSED
    );
}

#[test]
fn removing_a_lost_pc_changes_the_recovery_key_on_every_pc() {
    let w = World::new();
    let (pa, pb, pl) = (w.pc("a"), w.pc("b"), w.pc("lost"));
    let (a, b, lost) = (pa.store(), pb.store(), pl.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    lost.status().unwrap();
    lost.sync_open(&w.sync, "古いノート", &key, true, &[])
        .unwrap();
    let lost_id = lost.current_author().unwrap().member_id;
    // なくした PC を外す（確認は呼び名）: 同期フォルダの鍵と世帯の鍵が入れ替わる
    assert_eq!(
        a.office_remove(&lost_id, "違う名前").unwrap_err(),
        StoreError::OFFICE_CONFIRM
    );
    a.office_remove(&lost_id, "古いノート").unwrap();
    let new_key = a.recovery_key().unwrap().to_string();
    assert_ne!(new_key, key);
    // 新しい復元キーの保管を促す（保管するまで、次に外す操作は止まる）
    assert!(!a.status().unwrap().recovery_acknowledged);
    assert!(kinds(&a).contains(&"recoveryNotKept".to_owned()));
    // もう1台の PC も新しい鍵にそろう（この PC の中の事務所の鍵も）
    b.list().unwrap();
    assert_eq!(b.recovery_key().unwrap().to_string(), new_key);
    a.open(&h.id).unwrap();
    a.save(&h.id, &body(9), "本人").unwrap();
    a.leave_all();
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 9);
    // 外した PC は使えない。古い復元キーでは開けない
    assert_eq!(lost.office_status().unwrap().state, "removed");
    let pn = w.pc("new");
    let n = pn.store();
    n.status().unwrap();
    assert_eq!(
        n.sync_open(&w.sync, "新しいPC", &key, true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    // 新しい復元キーを保管してから戻すと、この PC の中の事務所も新しい鍵のまま（保管済み）
    a.acknowledge_recovery().unwrap();
    b.leave_all();
    a.sync_end("事務所のPC").unwrap();
    assert_eq!(a.recovery_key().unwrap().to_string(), new_key);
    assert!(a.status().unwrap().recovery_acknowledged);
    // アプリを開き直しても、新しい鍵で開ける
    let a2 = pa.store();
    a2.status().unwrap();
    assert_eq!(n_of(&a2.open(&h.id).unwrap().body), 9);
}

#[test]
fn office_folders_and_personal_folders_do_not_mix() {
    let w = World::new();
    let (pa, pb, pc) = (w.pc("a"), w.pc("b"), w.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    // 事務所での共有（複数の FP）のフォルダは、「すでに使っている同期フォルダを開く」では開かない
    a.status().unwrap();
    a.office_start(&w.sync, "担当A", true, &[]).unwrap();
    assert_eq!(a.office_status().unwrap().usage.as_deref(), Some("office"));
    let office_key = a.recovery_key().unwrap().to_string();
    b.status().unwrap();
    assert_eq!(
        b.sync_open(&w.sync, "自宅のノート", &office_key, true, &[])
            .unwrap_err(),
        StoreError::SYNC_IS_OFFICE
    );
    assert_eq!(b.office_status().unwrap().state, "off");
    // 1人の同期フォルダに置かれた参加の申請は、承認できない（知らせには出る）
    let w2 = World::new();
    let (pd, pe) = (w2.pc("d"), w2.pc("e"));
    let (d, e) = (pd.store(), pe.store());
    d.status().unwrap();
    first_pc(&w2, &d);
    e.status().unwrap();
    let st = e.office_join(&w2.sync, "だれか", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let req = d.office_status().unwrap().requests;
    assert_eq!(req.len(), 1);
    let n = d
        .storage_notices()
        .unwrap()
        .into_iter()
        .find(|n| n.kind == "joinRequest")
        .unwrap();
    assert_eq!((n.level.as_str(), n.count), ("alert", Some(1)));
    assert_eq!(
        d.office_approve(&req[0].request_id, &fp).unwrap_err(),
        StoreError::SYNC_PERSONAL
    );
    d.office_reject(&req[0].request_id).unwrap();
    assert!(d.office_status().unwrap().requests.is_empty());
    // 既に何かあるフォルダで同期フォルダを始めない
    c.status().unwrap();
    c.acknowledge_recovery().unwrap();
    assert_eq!(
        c.sync_start(&w.sync, "PC", true, &[]).unwrap_err(),
        StoreError::OFFICE_EXISTS
    );
    // 事務所での共有を始めた PC は、同期フォルダを始められない（今の状態ではできない）
    assert_eq!(
        a.sync_start(&w2.sync, "PC", true, &[]).unwrap_err(),
        StoreError::OFFICE_STATE
    );
    // 同期フォルダで使っている PC で「この PC の中へ戻す」は、事務所での共有には使えない
    assert_eq!(a.sync_end("担当A").unwrap_err(), StoreError::OFFICE_STATE);
}

#[test]
fn daily_backups_stay_in_each_pc() {
    let w = World::new();
    let (pa, pb) = (w.pc("a"), w.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    // 次の日、それぞれの PC で開いて保存する
    w.clock.advance(86_400);
    let a2 = pa.store();
    a2.status().unwrap();
    a2.open(&h.id).unwrap();
    a2.save(&h.id, &body(2), "本人").unwrap();
    a2.leave_all();
    let b2 = pb.store();
    b2.status().unwrap();
    b2.open(&h.id).unwrap();
    b2.save(&h.id, &body(3), "本人").unwrap();
    // 毎日の写しは、それぞれの PC のデータフォルダの中にできる（同期フォルダの世帯ファイルの写しと、世帯の鍵の札の写し）
    for p in [&pa, &pb] {
        let copies: Vec<PathBuf> = files_under(&p.root.join("backups"))
            .into_iter()
            .filter(|f| f.to_string_lossy().ends_with(&format!("{}.lphf", h.id)))
            .collect();
        assert!(!copies.is_empty(), "{:?}", p.root);
        let keys: Vec<PathBuf> = files_under(&p.root.join("keys").join("backups").join("shared"))
            .into_iter()
            .filter(|f| f.to_string_lossy().ends_with(".lphk"))
            .collect();
        assert!(!keys.is_empty(), "{:?}", p.root);
    }
    // 同期フォルダには、バックアップも鍵置き場も置かない
    for f in files_under(&w.sync) {
        let s = f.to_string_lossy();
        assert!(!s.contains("backups"), "{s}");
        assert!(!s.ends_with(".lpkv") && !s.ends_with(".lpod"), "{s}");
    }
}

#[test]
fn an_interrupted_move_can_be_resumed_without_losing_households() {
    let w = World::new();
    let pa = w.pc("a");
    let a = pa.store();
    a.status().unwrap();
    let hs: Vec<_> = (1..=3).map(|n| create(&a, n)).collect();
    a.acknowledge_recovery().unwrap();
    // 1つの世帯ファイルを、移す途中で読めない状態にしておく（壊れた・ほかのプログラムが掴んでいる、の代わり）
    let bad = &hs[1];
    let bad_path = pa.root.join("households").join(format!("{}.lphf", bad.id));
    let saved = std::fs::read(&bad_path).unwrap();
    std::fs::write(&bad_path, b"broken").unwrap();
    assert!(a.sync_start(&w.sync, "事務所のPC", true, &[]).is_err());
    // 移せなかった世帯の PC の中のファイルと鍵は残っている（移せたものだけが同期フォルダにある）
    let st = a.office_status().unwrap();
    assert_eq!(st.state, "member");
    assert!(st.local_households >= 1);
    assert!(kinds(&a).contains(&"localHouseholds".to_owned()));
    std::fs::write(&bad_path, &saved).unwrap();
    // やり直すと残りを移す
    a.office_move_local().unwrap();
    assert_eq!(a.office_status().unwrap().local_households, 0);
    for (i, h) in hs.iter().enumerate() {
        assert_eq!(n_of(&a.open(&h.id).unwrap().body), i as i64 + 1);
    }
}

#[test]
fn screen_values_have_no_paths_or_keys() {
    let w = World::new();
    let (pa, pb) = (w.pc("a"), w.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    let h = create(&a, 1);
    let key = first_pc(&w, &a);
    second_pc(&w, &b, &key);
    b.open(&h.id).unwrap();
    let mut out = String::new();
    for s in [&a, &b] {
        out += &serde_json::to_string(&s.office_status().unwrap()).unwrap();
        out += &serde_json::to_string(&s.storage_notices().unwrap()).unwrap();
        out += &serde_json::to_string(&s.list().unwrap()).unwrap();
        out += &serde_json::to_string(&s.open(&h.id).unwrap()).unwrap();
        out += &serde_json::to_string(&s.fork_info(&h.id).unwrap()).unwrap();
        out += &serde_json::to_string(&s.status().unwrap()).unwrap();
    }
    for p in [&w.sync, &pa.root, &pb.root, &w.base] {
        assert!(!out.contains(&*p.to_string_lossy()), "パスが入っている");
    }
    assert!(!out.contains("lifeplan-office"));
    // 鍵（復元キーの中身・保管庫の値）が入っていない
    let master = recovery::decode(&key).unwrap();
    assert!(!out.contains(&crypto::hex_encode(master.as_ref())));
    assert!(!out.contains(&key));
    for secrets in [&pa.secrets, &pb.secrets] {
        for account in secrets.accounts_for_test() {
            let v = secrets.get(&account).unwrap().unwrap();
            assert!(!out.contains(v.as_str()));
        }
    }
}
