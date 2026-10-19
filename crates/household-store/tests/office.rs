// 事務所での共有の試験（0023 の「テストで確かめること」）。
// 2つの PC を「2つのデータフォルダ＋それぞれのメモリの保管庫＋同じ共有フォルダ（テスト用の一時フォルダ）」で模す。
// OS の保管庫には触れない。
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::office::{self, Roster};
use household_store::{
    container, crypto, member, Clock, CreateRequest, ForkChoice, MemorySecretStore, SecretStore,
    Store, StoreError,
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
}

/// 事務所（共有フォルダ）と、何台かの PC
struct Office {
    base: PathBuf,
    shared: PathBuf,
    clock: TestClock,
}

impl Office {
    fn new() -> Office {
        let base = std::env::temp_dir().join(format!("hs-office-{}", crypto::new_uuid()));
        let shared = base.join("共有フォルダ");
        std::fs::create_dir_all(&shared).unwrap();
        Office {
            base,
            shared,
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
        self.shared.join(office::OFFICE_DIR)
    }
}

impl Drop for Office {
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

fn meta_of(body: &str) -> serde_json::Value {
    serde_json::from_str::<serde_json::Value>(body).unwrap()["meta"].clone()
}

fn create(store: &Store, n: i64) -> household_store::Opened {
    store
        .create(CreateRequest {
            body: body(n),
            summary: "本人".into(),
        })
        .unwrap()
}

/// 申請した PC の指紋（申請した人の画面に出る値）
fn fingerprint_of(store: &Store) -> String {
    store.office_status().unwrap().my_fingerprint.unwrap()
}

/// A が事務所を始め、B が参加して A が承認する
fn start_and_join(o: &Office, a: &Store, b: &Store) -> String {
    a.status().unwrap();
    b.status().unwrap();
    a.office_start(&o.shared, "担当A", true, &[]).unwrap();
    let st = b.office_join(&o.shared, "担当B", true, &[]).unwrap();
    assert_eq!(st.state, "pending");
    let fp = st.my_fingerprint.clone().unwrap();
    let req = a.office_status().unwrap().requests;
    assert_eq!(req.len(), 1);
    a.office_approve(&req[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    req[0].request_id.clone()
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

#[test]
fn two_members_open_and_edit_the_same_household() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    // 共有を始める前に作った世帯は、共有フォルダへ移る
    let h = create(&a, 1);
    start_and_join(&o, &a, &b);
    assert!(
        !pa.root
            .join("households")
            .join(format!("{}.lphf", h.id))
            .exists(),
        "PCの中の世帯ファイルは移した後に消える"
    );
    assert!(o
        .office_root()
        .join("households")
        .join(format!("{}.lphf", h.id))
        .exists());
    // B から見える・開ける
    let lb = b.list().unwrap();
    assert_eq!(lb.len(), 1);
    assert_eq!(lb[0].customer_no, h.customer_no);
    let ob = b.open(&h.id).unwrap();
    assert_eq!(n_of(&ob.body), 1);
    // B が直す → 誰が直したかが残る
    o.clock.advance(60);
    b.save(&h.id, &body(2), "本人・配偶者").unwrap();
    let la = a.list().unwrap();
    assert_eq!(la[0].updated_by.as_deref(), Some("担当B"));
    assert_eq!(la[0].summary, "本人・配偶者");
    let oa = a.open(&h.id).unwrap();
    assert_eq!(n_of(&oa.body), 2);
    assert_eq!(oa.saved_by.as_deref(), Some("担当B"));
    let meta = meta_of(&oa.body);
    let b_id = b.current_author().unwrap().member_id;
    assert_eq!(meta["savedBy"]["name"], "担当B");
    assert_eq!(meta["editors"][&b_id]["name"], "担当B");
    let revs = meta["revisions"].as_array().unwrap();
    assert_eq!(revs.last().unwrap()["memberId"], b_id.as_str());
    // A が直すと、改訂の履歴に A の行が足される（続けて保存した B の行とは別）
    a.save(&h.id, &body(3), "本人・配偶者").unwrap();
    let ob2 = b.open(&h.id).unwrap();
    let revs2 = meta_of(&ob2.body)["revisions"].as_array().unwrap().clone();
    assert_eq!(revs2.len(), revs.len() + 1);
    assert_eq!(
        revs2.last().unwrap()["memberId"],
        a.current_author().unwrap().member_id.as_str()
    );
    // B が新しく作った世帯も A から開ける
    let h2 = create(&b, 5);
    assert_eq!(n_of(&a.open(&h2.id).unwrap().body), 5);
    assert_ne!(h2.customer_no, h.customer_no);
    // 名簿の一覧（表示名・指紋・参加日）
    let st = a.office_status().unwrap();
    assert_eq!(st.members.len(), 2);
    assert!(st
        .members
        .iter()
        .any(|m| m.name == "担当B" && m.approved_by.as_deref() == Some("担当A")));
    assert_eq!(
        st.office_code,
        b.office_status().unwrap().office_code,
        "事務所の確かめ用の番号は同じ"
    );
}

#[test]
fn approval_requires_the_fingerprint() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    b.status().unwrap();
    a.office_start(&o.shared, "担当A", false, &[]).unwrap();
    b.office_join(&o.shared, "担当B", false, &[]).unwrap();
    let fp_b = fingerprint_of(&b);
    let req = a.office_status().unwrap().requests;
    let rid = req[0].request_id.clone();
    // 承認する人の画面（状態）には、申請の指紋を出さない
    let json = serde_json::to_string(&a.office_status().unwrap()).unwrap();
    assert!(!json.contains(&fp_b), "{json}");
    // 指紋を入れない・違う指紋・自分の指紋では承認できない
    for bad in ["", "ABCD", "0000-0000-0000-0000", &fingerprint_of(&a)] {
        assert_eq!(
            a.office_approve(&rid, bad).unwrap_err(),
            StoreError::OFFICE_FINGERPRINT,
            "{bad}"
        );
    }
    assert_eq!(b.office_status().unwrap().state, "pending");
    // 共有フォルダに書ける第三者が、B が指紋を伝えた後に申請を自分の公開鍵に差し替えても、承認できない
    let req_path = o.office_root().join("requests").join(format!("{rid}.json"));
    let mut forged: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&req_path).unwrap()).unwrap();
    let attacker = member::MemberKeys::generate();
    forged["publicKey"] = attacker.public_hex().into();
    std::fs::write(&req_path, serde_json::to_vec(&forged).unwrap()).unwrap();
    assert_eq!(
        a.office_approve(&rid, &fp_b).unwrap_err(),
        StoreError::OFFICE_FINGERPRINT
    );
    // 元に戻した申請は、聞いた指紋（小文字・区切りなしでもよい）で承認できる
    forged["publicKey"] = serde_json::Value::Null;
    std::fs::remove_file(&req_path).unwrap();
    b.office_leave_setting().unwrap();
    b.office_join(&o.shared, "担当B", false, &[]).unwrap();
    let fp_b = fingerprint_of(&b);
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fp_b.to_lowercase().replace('-', ""))
        .unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
}

#[test]
fn removed_member_cannot_open_new_revisions() {
    let o = Office::new();
    let (pa, pb, pc) = (o.pc("a"), o.pc("b"), o.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    start_and_join(&o, &a, &b);
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", false, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    let h = create(&a, 1);
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 1);
    // B の手元にある古い親鍵（外す前に B の PC にあったもの）を取っておく
    let office_id = std::fs::read_to_string(o.office_root().join("office.json")).unwrap();
    let office_id: serde_json::Value = serde_json::from_str(&office_id).unwrap();
    let office_id = office_id["officeId"].as_str().unwrap().to_owned();
    let old_master = crypto::key_from_hex(&pb.secrets.get(&office_id).unwrap().unwrap()).unwrap();
    // 外す: 確認の表示名が違う・自分自身は外せない
    let b_id = b.current_author().unwrap().member_id;
    assert_eq!(
        a.office_remove(&b_id, "担当X").unwrap_err(),
        StoreError::OFFICE_CONFIRM
    );
    let a_id = a.current_author().unwrap().member_id;
    assert_eq!(
        a.office_remove(&a_id, "担当A").unwrap_err(),
        StoreError::OFFICE_SELF
    );
    let st = a.office_remove(&b_id, "担当B").unwrap();
    assert_eq!(st.members.len(), 2);
    assert_eq!(st.removed.len(), 1);
    assert!(
        !st.recovery_acknowledged,
        "入れ替えの後は、新しい復元キーの保管が要る"
    );
    // 外した後に A が保存した改訂
    o.clock.advance(60);
    a.open(&h.id).unwrap();
    a.save(&h.id, &body(2), "本人").unwrap();
    // C は開ける
    assert_eq!(n_of(&c.open(&h.id).unwrap().body), 2);
    // B のアプリは外されたことに気づき、共有の世帯を開かない
    assert_eq!(b.open(&h.id).unwrap_err(), StoreError::OFFICE_REMOVED);
    assert_eq!(b.office_status().unwrap().state, "removed");
    // B の手元の古い親鍵で、共有フォルダに残るどの世帯の鍵の札を開いても、新しい改訂は開けない
    let file = std::fs::read(
        o.office_root()
            .join("households")
            .join(format!("{}.lphf", h.id)),
    )
    .unwrap();
    let header = container::read_household_header(&file).unwrap();
    let mut tried = 0;
    for p in files_under(&o.office_root().join("keys")) {
        if !p.to_string_lossy().ends_with(".lphk") {
            continue;
        }
        let Ok(k) = office::open_keys(&std::fs::read(&p).unwrap(), &h.id, &old_master) else {
            continue;
        };
        tried += 1;
        assert!(
            k.find(&header.key_id).is_none(),
            "古い札に新しい世帯の鍵は無い"
        );
        assert!(container::open_household(&file, &k.current).is_err());
        for (_, pk) in &k.previous {
            assert!(container::open_household(&file, pk).is_err());
        }
    }
    assert!(
        tried >= 1,
        "古い時代の札は古い親鍵で開ける（外した人が前から読めた範囲）"
    );
    // 古い親鍵では今の名簿も開けない
    let roster = std::fs::read(o.office_root().join("members.lpmb")).unwrap();
    assert_eq!(
        office::open_roster_with_master(&roster, &old_master).err(),
        Some(StoreError::WRONG_MASTER)
    );
}

#[test]
fn forged_roster_is_rejected() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    // 共有フォルダに書ける第三者が、B の公開鍵に向けて自分の親鍵を包んだ偽の名簿に差し替える
    let st = b.office_status().unwrap();
    let me = st.members.iter().find(|m| m.is_me).unwrap();
    let office_id: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(o.office_root().join("office.json")).unwrap(),
    )
    .unwrap();
    // B の公開鍵は、B の申請や同期の写しなどから知られうる。ここでは B の保管庫の秘密鍵から計算する
    let secret = pb
        .secrets
        .get(&format!(
            "{}.member",
            office_id["officeId"].as_str().unwrap()
        ))
        .unwrap()
        .unwrap();
    let b_keys = member::MemberKeys::from_hex(&secret).unwrap();
    let fake = Roster {
        office_id: office_id["officeId"].as_str().unwrap().into(),
        master_key_id: crypto::new_uuid(),
        members: vec![office::Member {
            member_id: me.member_id.clone(),
            display_name: "担当B".into(),
            public_key: b_keys.public_hex(),
            fingerprint: me.fingerprint.clone(),
            joined_at: "x".into(),
            approved_by: None,
            role: office::ROLE_MEMBER.into(),
        }],
        removed: vec![],
        previous: vec![],
        recovery: None,
        updated_at: "x".into(),
        updated_by: None,
    };
    let bytes = office::encode_roster(&fake, &crypto::random_key()).unwrap();
    std::fs::write(o.office_root().join("members.lpmb"), bytes).unwrap();
    let st = b.office_status().unwrap();
    assert_eq!(st.state, "unavailable");
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_FORGED"));
    assert_eq!(b.list().unwrap_err(), StoreError::OFFICE_FORGED);
}

#[test]
fn presence_marks_and_their_expiry() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    let h2 = create(&a, 2);
    a.open(&h.id).unwrap();
    // B が一覧を見る・同じ世帯を開くと、A が開いていることが分かる
    let lb = b.list().unwrap();
    let row = lb.iter().find(|e| e.id == h.id).unwrap();
    assert_eq!(row.open_by.len(), 1);
    assert_eq!(row.open_by[0].name, "担当A");
    let ob = b.open(&h.id).unwrap();
    assert_eq!(ob.others_open.len(), 1);
    // A が別の世帯に移ると、前の世帯の印は消える
    a.open(&h2.id).unwrap();
    let lb = b.list().unwrap();
    assert!(lb.iter().find(|e| e.id == h.id).unwrap().open_by.is_empty());
    assert_eq!(lb.iter().find(|e| e.id == h2.id).unwrap().open_by.len(), 1);
    // 4分後に定期的に新しくしていれば有効
    o.clock.advance(240);
    a.heartbeat();
    o.clock.advance(240);
    assert_eq!(
        b.list()
            .unwrap()
            .iter()
            .find(|e| e.id == h2.id)
            .unwrap()
            .open_by
            .len(),
        1
    );
    // 5分を超えて新しくならない印（アプリが落ちた）は無効になり、片付けられる
    o.clock.advance(301);
    assert!(b.list().unwrap().iter().all(|e| e.open_by.is_empty()));
    let presence = files_under(&o.office_root().join("presence"));
    assert!(
        presence.iter().all(|p| !p
            .to_string_lossy()
            .contains(&a.current_author().unwrap().member_id)),
        "{presence:?}"
    );
    // アプリを閉じると自分の印を消す
    let _ = b.open(&h.id).unwrap();
    b.leave_all();
    assert!(a.list().unwrap().iter().all(|e| e.open_by.is_empty()));
}

#[test]
fn forks_are_detected_and_chosen() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    a.open(&h.id).unwrap();
    b.open(&h.id).unwrap();
    // 同じ親から2つの保存: 先に B、後から A
    b.save(&h.id, &body(20), "本人").unwrap();
    assert_eq!(
        a.save(&h.id, &body(10), "本人").unwrap_err(),
        StoreError::CONFLICT
    );
    let info = a.fork_info(&h.id).unwrap();
    assert!(info.saved_conflict);
    assert_eq!(info.theirs_by.as_deref(), Some("担当B"));
    // こちらの内容で上書きする: 相手の改訂も PC の中の conflicts/ に残る
    let r = a.resolve_fork(&h.id, ForkChoice::Ours).unwrap();
    assert_eq!(n_of(&r.body), 10);
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 10);
    let kept: Vec<String> = std::fs::read_dir(pa.root.join("conflicts"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(kept.iter().any(|n| n.contains("-theirs-")), "{kept:?}");
    assert!(kept.iter().any(|n| n.contains("-ours-")), "{kept:?}");
    // 相手の内容を残す
    a.open(&h.id).unwrap();
    b.save(&h.id, &body(30), "本人").unwrap();
    assert_eq!(
        a.save(&h.id, &body(11), "本人").unwrap_err(),
        StoreError::CONFLICT
    );
    let r = a.resolve_fork(&h.id, ForkChoice::Theirs).unwrap();
    assert_eq!(n_of(&r.body), 30);
    a.save(&h.id, &body(31), "本人").unwrap();
    // 分岐が無いのに上書きを選ぶことはできない
    assert_eq!(
        a.resolve_fork(&h.id, ForkChoice::Ours).unwrap_err(),
        StoreError::NO_FORK
    );
}

#[test]
fn sync_service_conflict_copies() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    a.save(&h.id, &body(2), "本人").unwrap();
    // 同期サービスが、片方の PC の保存を別名のファイルとして残した（中身は1つ前の改訂）
    let dir = o.office_root().join("households");
    let prev = std::fs::read(dir.join(format!("{}.lphf.prev", h.id))).unwrap();
    std::fs::write(
        dir.join(format!("{} (担当B のコンフリクトコピー).lphf", h.id)),
        &prev,
    )
    .unwrap();
    // 別の世帯の見出しのファイルを同じ名前の形で置いても、分岐とは扱わない
    let h2 = create(&a, 3);
    let other = std::fs::read(dir.join(format!("{}.lphf", h2.id))).unwrap();
    std::fs::write(dir.join(format!("{} copy.lphf", h.id)), &other).unwrap();
    let row = b
        .list()
        .unwrap()
        .into_iter()
        .find(|e| e.id == h.id)
        .unwrap();
    assert_eq!(row.forks, 1);
    assert_eq!(b.fork_info(&h.id).unwrap().sync_copies, 1);
    // 写しを今の内容にする（今の内容は conflicts/ に残る）
    b.resolve_sync_copies(&h.id, true).unwrap();
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 1);
    assert_eq!(
        b.list()
            .unwrap()
            .into_iter()
            .find(|e| e.id == h.id)
            .unwrap()
            .forks,
        0
    );
    assert!(
        std::fs::read_dir(pb.root.join("conflicts"))
            .unwrap()
            .count()
            >= 2
    );
}

#[test]
fn format_0_1_files_are_migrated_one_way() {
    let o = Office::new();
    let pa = o.pc("a");
    let a = pa.store();
    a.status().unwrap();
    let h = create(&a, 1);
    a.write_raw_for_test(&h.id, "0.1", &body(4), 5).unwrap();
    let r = a.open(&h.id).unwrap();
    assert!(!r.read_only);
    let meta = meta_of(&r.body);
    assert_eq!(meta["revisions"], serde_json::json!([]));
    assert_eq!(meta["editors"], serde_json::json!({}));
    a.save(&h.id, &body(5), "本人").unwrap();
    let file = std::fs::read(a.household_path_for_test(&h.id)).unwrap();
    assert_eq!(
        container::read_household_header(&file)
            .unwrap()
            .format_version,
        household_store::migrate::CURRENT
    );
    assert_eq!(
        meta_of(&a.open(&h.id).unwrap().body)["revisions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn sharing_off_behaves_as_before() {
    let o = Office::new();
    let pa = o.pc("a");
    let a = pa.store();
    a.status().unwrap();
    let st = a.office_status().unwrap();
    assert_eq!(st.state, "off");
    assert!(st.members.is_empty() && st.my_fingerprint.is_none() && st.office_code.is_none());
    assert!(a.current_author().is_none());
    let h = create(&a, 1);
    a.save(&h.id, &body(2), "本人").unwrap();
    let l = a.list().unwrap();
    assert!(l[0].updated_by.is_none() && l[0].open_by.is_empty() && l[0].forks == 0);
    assert!(meta_of(&a.open(&h.id).unwrap().body)
        .get("savedBy")
        .is_none());
    // 共有フォルダには何も作らない・保管庫の項目は親鍵の1つだけ
    assert!(!o.office_root().exists());
    assert!(std::fs::read_dir(&o.shared).unwrap().next().is_none());
    // 承認待ちでない PC は承認・外す操作ができない
    assert_eq!(
        a.office_approve(&crypto::new_uuid(), "x").unwrap_err(),
        StoreError::OFFICE_STATE
    );
    assert_eq!(a.office_move_local().unwrap_err(), StoreError::OFFICE_STATE);
}

#[test]
fn forbidden_and_missing_folders() {
    let o = Office::new();
    let pa = o.pc("a");
    let a = pa.store();
    a.status().unwrap();
    // データフォルダの中・データフォルダを含む場所
    assert_eq!(
        a.office_start(&pa.root, "担当A", false, &[]).unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    assert_eq!(
        a.office_start(pa.root.parent().unwrap(), "担当A", false, &[])
            .unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    // カスタム層（AIの作業フォルダ）の中・それを含む場所
    let custom = o.base.join("custom");
    std::fs::create_dir_all(custom.join("sdk")).unwrap();
    assert_eq!(
        a.office_start(
            &custom.join("sdk"),
            "担当A",
            false,
            std::slice::from_ref(&custom)
        )
        .unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    assert_eq!(
        a.office_start(&o.base, "担当A", false, std::slice::from_ref(&custom))
            .unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    // 無い場所・事務所の無い場所への参加・表示名
    assert_eq!(
        a.office_start(&o.base.join("none"), "担当A", false, &[])
            .unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    assert_eq!(
        a.office_join(&o.shared, "担当A", false, &[]).unwrap_err(),
        StoreError::OFFICE_NOT_FOUND
    );
    assert_eq!(
        a.office_start(&o.shared, "", false, &[]).unwrap_err(),
        StoreError::OFFICE_NAME
    );
    // 始めた後に同じ場所でもう一度始めることはできない（参加する）
    a.office_start(&o.shared, "担当A", false, &[]).unwrap();
    let pb = o.pc("b");
    let b = pb.store();
    b.status().unwrap();
    assert_eq!(
        b.office_start(&o.shared, "担当B", false, &[]).unwrap_err(),
        StoreError::OFFICE_EXISTS
    );
    // lifeplan-office そのものを選んでも参加できる
    b.office_join(&o.office_root(), "担当B", false, &[])
        .unwrap();
    // 共有フォルダが見つからなくなったら、黙って PC の中の世帯を見せない
    std::fs::rename(&o.shared, o.base.join("moved")).unwrap();
    let a2 = pa.store();
    a2.status().unwrap();
    assert_eq!(a2.list().unwrap_err(), StoreError::OFFICE_UNAVAILABLE);
    assert_eq!(a2.office_status().unwrap().state, "unavailable");
}

#[test]
fn screen_values_have_no_paths_or_keys() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    b.open(&h.id).unwrap();
    let mut out = String::new();
    out += &serde_json::to_string(&a.office_status().unwrap()).unwrap();
    out += &serde_json::to_string(&a.list().unwrap()).unwrap();
    out += &serde_json::to_string(&a.open(&h.id).unwrap()).unwrap();
    out += &serde_json::to_string(&a.fork_info(&h.id).unwrap()).unwrap();
    out += &serde_json::to_string(&a.status().unwrap()).unwrap();
    for p in [&o.shared, &pa.root, &pb.root, &o.base] {
        assert!(!out.contains(&*p.to_string_lossy()), "パスが入っている");
    }
    assert!(!out.contains("lifeplan-office"));
    // 保管庫の値（親鍵・メンバーの秘密鍵）が入っていない
    for secrets in [&pa.secrets, &pb.secrets] {
        let office_id: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(o.office_root().join("office.json")).unwrap(),
        )
        .unwrap();
        let id = office_id["officeId"].as_str().unwrap();
        for account in [id.to_owned(), format!("{id}.member")] {
            let v = secrets.get(&account).unwrap().unwrap();
            assert!(!out.contains(v.as_str()));
        }
    }
    // 共有フォルダのファイルにも、鍵や表示名・顧客番号が平文で出ない
    let master = pa
        .secrets
        .get(
            serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(o.office_root().join("office.json")).unwrap(),
            )
            .unwrap()["officeId"]
                .as_str()
                .unwrap(),
        )
        .unwrap()
        .unwrap();
    for p in files_under(&o.office_root()) {
        if p.extension().is_some_and(|e| e == "json") {
            continue; // office.json・参加の申請は平文（公開鍵と表示名だけ）
        }
        let text = String::from_utf8_lossy(&std::fs::read(&p).unwrap()).into_owned();
        assert!(!text.contains(master.as_str()), "{p:?}");
        assert!(
            !text.contains("担当A") && !text.contains(&h.customer_no),
            "{p:?}"
        );
    }
}

#[test]
fn shared_recovery_key_and_acknowledgement() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    // 事務所の復元キーは共有の事務所の親鍵で、どのメンバーの PC でも同じ
    let ka = a.recovery_key().unwrap();
    assert_eq!(ka.as_str(), b.recovery_key().unwrap().as_str());
    b.test_recovery_key(&ka).unwrap();
    assert!(!a.status().unwrap().recovery_acknowledged);
    a.acknowledge_recovery().unwrap();
    let st = b.office_status().unwrap();
    assert!(st.recovery_acknowledged);
    assert_eq!(st.recovery_acknowledged_by.as_deref(), Some("担当A"));
    assert!(b.status().unwrap().recovery_acknowledged);
}

#[test]
fn stray_keys_written_by_a_lagging_pc_are_adopted_with_a_new_key() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let office_id: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(o.office_root().join("office.json")).unwrap(),
    )
    .unwrap();
    let office_id = office_id["officeId"].as_str().unwrap().to_owned();
    let old_master = crypto::key_from_hex(&pa.secrets.get(&office_id).unwrap().unwrap()).unwrap();
    let (_, old_mk) =
        office::peek_roster(&std::fs::read(o.office_root().join("members.lpmb")).unwrap()).unwrap();
    let b_id = b.current_author().unwrap().member_id;
    a.office_remove(&b_id, "担当B").unwrap();
    // 入れ替えをまだ知らない PC が、古い時代のフォルダに世帯を作った（迷子の札）
    o.clock.advance(60);
    let id = crypto::new_uuid();
    let hk = office::HouseholdKeys::new();
    let root = office::Paths::new(o.office_root());
    std::fs::write(
        root.key_file(&old_mk, &id),
        office::encode_keys(&office_id, &old_mk, &id, &hk, &old_master),
    )
    .unwrap();
    let header = container::HouseholdHeader {
        cipher: String::new(),
        compression: "none".into(),
        device_id: crypto::new_uuid(),
        format: household_store::HOUSEHOLD_FORMAT.into(),
        format_version: household_store::migrate::CURRENT.into(),
        generation: 1,
        household_id: id.clone(),
        key_id: hk.current_id.clone(),
        nonce: String::new(),
        parent_revision: None,
    };
    std::fs::write(
        root.households_dir().join(format!("{id}.lphf")),
        container::seal_household(header, &hk.current, body(7).as_bytes()),
    )
    .unwrap();
    let card = office::Card {
        customer_no: "Z0001".into(),
        summary: "本人".into(),
        created_at: "2026-10-19T09:01:00Z".into(),
        updated_at: "2026-10-19T09:01:00Z".into(),
        updated_by: None,
        generation: 1,
    };
    std::fs::write(
        root.card(&id),
        office::encode_card(&office_id, &old_mk, &id, &card, &old_master),
    )
    .unwrap();
    // 今のメンバーは一覧に出し、開ける（前の親鍵で読む）
    assert!(a.list().unwrap().iter().any(|e| e.id == id));
    assert_eq!(n_of(&a.open(&id).unwrap().body), 7);
    // 保存すると、世帯の鍵を新しくして今の時代へ引き取る。古い親鍵で読める鍵では、新しい改訂を開けない
    a.save(&id, &body(8), "本人").unwrap();
    let file = std::fs::read(root.households_dir().join(format!("{id}.lphf"))).unwrap();
    assert!(container::open_household(&file, &hk.current).is_err());
    assert_eq!(n_of(&a.open(&id).unwrap().body), 8);
}
