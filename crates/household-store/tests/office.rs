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

/// A が事務所を始め、事務所の復元キーを保管したと記録する（保管するまで承認・外すは止まる）
fn start(o: &Office, a: &Store) {
    a.status().unwrap();
    a.office_start(&o.shared, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
}

/// A が事務所を始め、B が参加して A が承認する
fn start_and_join(o: &Office, a: &Store, b: &Store) -> String {
    start(o, a);
    b.status().unwrap();
    let st = b.office_join(&o.shared, "担当B", true, &[]).unwrap();
    assert_eq!(st.state, "pending");
    let fp = st.my_fingerprint.clone().unwrap();
    let req = a.office_status().unwrap().requests;
    assert_eq!(req.len(), 1);
    a.office_approve(&req[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    req[0].request_id.clone()
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
    start(&o, &a);
    b.status().unwrap();
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
            extra: Default::default(),
        }],
        removed: vec![],
        previous: vec![],
        recovery: None,
        events: vec![],
        closed: None,
        usage: None,
        categories: None,
        updated_at: "x".into(),
        updated_by: None,
        extra: Default::default(),
    };
    let real_code = a.office_status().unwrap().office_code.unwrap();
    let fake_master = crypto::random_key();
    let bytes = office::encode_roster(&fake, &fake_master).unwrap();
    std::fs::write(o.office_root().join("members.lpmb"), bytes).unwrap();
    let st = b.office_status().unwrap();
    assert_eq!(st.state, "unavailable");
    // 30日より長く開かなかった間の入れ替えと見分けられないので「たどれない」と出し、番号を聞いて入れる道を出す
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_ROSTER_UNVERIFIED"));
    assert_eq!(b.list().unwrap_err(), StoreError::OFFICE_ROSTER_UNVERIFIED);
    // ほかのメンバー（A）から聞いた本当の番号は、偽の名簿の親鍵と合わないので受け入れない
    let before = master_of(&pb, office_id["officeId"].as_str().unwrap());
    assert_eq!(
        b.office_accept_roster(&real_code).unwrap_err(),
        StoreError::OFFICE_CODE_MISMATCH
    );
    assert_eq!(
        *master_of(&pb, office_id["officeId"].as_str().unwrap()),
        *before,
        "手元の親鍵は変えない"
    );
    let st = b.office_status().unwrap();
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_ROSTER_UNVERIFIED"));
    assert!(
        st.office_code.is_none(),
        "受け入れていない名簿の番号は出さない"
    );
    // 番号の形が違う・前の版の8文字・ほかの事務所の復元キーも受け入れない
    assert_eq!(
        b.office_accept_roster("K9ER-W99J").unwrap_err(),
        StoreError::OFFICE_CODE_SHAPE
    );
    assert_eq!(
        b.office_accept_roster(&real_code[..9]).unwrap_err(),
        StoreError::OFFICE_CODE_SHAPE
    );
    assert_eq!(
        b.office_accept_roster(&household_store::recovery::encode(&crypto::random_key()))
            .unwrap_err(),
        StoreError::OFFICE_CODE_MISMATCH
    );
    assert_eq!(b.list().unwrap_err(), StoreError::OFFICE_ROSTER_UNVERIFIED);
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
            !text.contains("担当A") && !shows_customer_no(&text, &h.customer_no),
            "{p:?}"
        );
    }
}

#[test]
fn shared_recovery_key_and_acknowledgement() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    b.status().unwrap();
    a.office_start(&o.shared, "担当A", true, &[]).unwrap();
    assert!(!a.status().unwrap().recovery_acknowledged);
    a.acknowledge_recovery().unwrap();
    b.office_join(&o.shared, "担当B", true, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fingerprint_of(&b)).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    // 事務所の復元キーは共有の事務所の親鍵で、どのメンバーの PC でも同じ
    let ka = a.recovery_key().unwrap();
    assert_eq!(ka.as_str(), b.recovery_key().unwrap().as_str());
    let st = b.office_status().unwrap();
    assert!(st.recovery_acknowledged);
    assert_eq!(st.recovery_acknowledged_by.as_deref(), Some("担当A"));
    assert!(st.recovery_verified_at.is_none());
    assert!(b.status().unwrap().recovery_acknowledged);
    // B が試して確かめると、その記録も名簿に残る（保管した記録は A のまま）
    b.test_recovery_key(&ka).unwrap();
    let st = a.office_status().unwrap();
    assert_eq!(st.recovery_acknowledged_by.as_deref(), Some("担当A"));
    assert!(st.recovery_verified_at.is_some());
    assert!(a.status().unwrap().recovery_verified_at.is_some());
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
        label: Default::default(),
        extra: Default::default(),
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

fn office_id_of(o: &Office) -> String {
    let v: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(o.office_root().join("office.json")).unwrap(),
    )
    .unwrap();
    v["officeId"].as_str().unwrap().to_owned()
}

#[test]
fn sharing_operations_wait_for_the_office_recovery_key() {
    let o = Office::new();
    let (pa, pb, pc, pd) = (o.pc("a"), o.pc("b"), o.pc("c"), o.pc("d"));
    let (a, b, c, d) = (pa.store(), pb.store(), pc.store(), pd.store());
    for s in [&a, &b, &c, &d] {
        s.status().unwrap();
    }
    a.office_start(&o.shared, "担当A", true, &[]).unwrap();
    let st = a.office_status().unwrap();
    assert!(st.recovery_required && !st.recovery_acknowledged);
    b.office_join(&o.shared, "担当B", true, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    // 保管するまで、承認は止まる（申請は残る）
    assert_eq!(
        a.office_approve(&rid, &fingerprint_of(&b)).unwrap_err(),
        StoreError::OFFICE_RECOVERY_REQUIRED
    );
    assert_eq!(a.office_status().unwrap().requests.len(), 1);
    assert_eq!(b.office_status().unwrap().state, "pending");
    // 世帯の閲覧・編集は止めない
    let h = create(&a, 1);
    a.save(&h.id, &body(2), "本人").unwrap();
    assert_eq!(n_of(&a.open(&h.id).unwrap().body), 2);
    // 違う復元キーを試しても保管済みにならない
    let wrong = household_store::recovery::encode(&crypto::random_key());
    assert_eq!(
        a.test_recovery_key(&wrong).unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    assert!(a.office_status().unwrap().recovery_required);
    // 復元キーで実際に開けるかを試して通ったら、保管済みとみなす
    let key1 = a.recovery_key().unwrap();
    a.test_recovery_key(&key1).unwrap();
    let st = a.office_status().unwrap();
    assert!(!st.recovery_required && st.recovery_acknowledged);
    assert!(st.recovery_verified_at.is_some());
    a.office_approve(&rid, &fingerprint_of(&b)).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    c.office_join(&o.shared, "担当C", false, &[]).unwrap();
    let rid_c = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid_c, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    // 外すと復元キーが新しくなり、新しいキーを保管するまで次の共有の操作が止まる（どのメンバーの PC でも）
    let c_id = c.current_author().unwrap().member_id;
    let st = a.office_remove(&c_id, "担当C").unwrap();
    assert!(st.recovery_required);
    let st_b = b.office_status().unwrap();
    assert!(st_b.recovery_required, "ほかのメンバーの PC でも止まる");
    d.office_join(&o.shared, "担当D", false, &[]).unwrap();
    let rid_d = b.office_status().unwrap().requests[0].request_id.clone();
    assert_eq!(
        b.office_approve(&rid_d, &fingerprint_of(&d)).unwrap_err(),
        StoreError::OFFICE_RECOVERY_REQUIRED
    );
    let a_id = a.current_author().unwrap().member_id;
    assert_eq!(
        b.office_remove(&a_id, "担当A").unwrap_err(),
        StoreError::OFFICE_RECOVERY_REQUIRED
    );
    // 古い控え（入れ替えの前のキー）では保管済みにならない
    assert_eq!(
        b.test_recovery_key(&key1).unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    assert!(b.office_status().unwrap().recovery_required);
    // 世帯は開けて直せる
    b.open(&h.id).unwrap();
    b.save(&h.id, &body(3), "本人").unwrap();
    // 新しいキーを「保管した」と記録すると、止まっていた操作ができる
    assert_ne!(b.recovery_key().unwrap().as_str(), key1.as_str());
    b.acknowledge_recovery().unwrap();
    assert!(!a.office_status().unwrap().recovery_required);
    b.office_approve(&rid_d, &fingerprint_of(&d)).unwrap();
    assert_eq!(d.office_status().unwrap().state, "member");
}

#[test]
fn recovery_key_adds_a_new_pc_to_the_roster() {
    let o = Office::new();
    let (pa, pb, pn) = (o.pc("a"), o.pc("b"), o.pc("new"));
    let (a, b, n) = (pa.store(), pb.store(), pn.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 4);
    let key0 = a.recovery_key().unwrap();
    // B を外して鍵を入れ替える（key0 は古い控えになる）
    let b_id = b.current_author().unwrap().member_id;
    a.office_remove(&b_id, "担当B").unwrap();
    let key1 = a.recovery_key().unwrap();
    assert!(a.office_status().unwrap().recovery_required);
    // 全員の PC が使えなくなった: 新しい PC で共有フォルダを選び、事務所の復元キーを入れる
    n.status().unwrap();
    let members_before = std::fs::read(o.office_root().join("members.lpmb")).unwrap();
    let wrong = household_store::recovery::encode(&crypto::random_key());
    assert_eq!(
        n.office_recover_join(&o.shared, "担当N", &wrong, true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_MISMATCH,
        "違うキーでは加われない"
    );
    assert_eq!(
        n.office_recover_join(&o.shared, "担当N", &key0, true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_MISMATCH,
        "入れ替えの前の古い控えでは加われない"
    );
    assert_eq!(
        n.office_recover_join(&o.shared, "担当N", "ABCD-EFGH", true, &[])
            .unwrap_err(),
        StoreError::RECOVERY_TYPO
    );
    assert_eq!(
        n.office_recover_join(&o.shared, "", &key1, true, &[])
            .unwrap_err(),
        StoreError::OFFICE_NAME
    );
    assert_eq!(
        n.office_recover_join(&pn.root, "担当N", &key1, true, &[])
            .unwrap_err(),
        StoreError::OFFICE_FOLDER
    );
    assert_eq!(n.office_status().unwrap().state, "off");
    assert_eq!(
        std::fs::read(o.office_root().join("members.lpmb")).unwrap(),
        members_before,
        "失敗したときは名簿を変えない"
    );
    // 今の復元キーなら、承認なしで名簿に自分を足せる
    let st = n
        .office_recover_join(&o.shared, "担当N", &key1, true, &[])
        .unwrap();
    assert_eq!(st.state, "member");
    let me = st.members.iter().find(|m| m.is_me).unwrap();
    assert_eq!(me.name, "担当N");
    assert!(me.via_recovery && me.approved_by.is_none());
    assert!(st.notices.is_empty(), "自分には知らせを出さない");
    // 復元キーで開けたので、今のキーは保管済み（試して確かめた）とみなす
    assert!(!st.recovery_required);
    assert!(st.recovery_verified_at.is_some());
    // 共有の世帯を開いて直せる
    assert_eq!(n_of(&n.open(&h.id).unwrap().body), 4);
    o.clock.advance(60);
    n.save(&h.id, &body(5), "本人").unwrap();
    // 名簿の履歴に残る
    let roster = office::open_roster_with_master(
        &std::fs::read(o.office_root().join("members.lpmb")).unwrap(),
        &household_store::recovery::decode(&key1).unwrap(),
    )
    .unwrap();
    let ev = roster.events.last().unwrap();
    assert_eq!(ev.kind, office::EVENT_RECOVERY_JOIN);
    assert_eq!(ev.display_name, "担当N");
    assert_eq!(ev.member_id, me.member_id);
    // ほかのメンバーの画面に「復元キーで○○さんが加わりました」の知らせが出る
    let st_a = a.office_status().unwrap();
    assert_eq!(st_a.notices.len(), 1);
    assert_eq!(st_a.notices[0].name, "担当N");
    assert_eq!(st_a.notices[0].kind, "recoveryJoin");
    assert!(st_a
        .members
        .iter()
        .any(|m| m.name == "担当N" && m.via_recovery));
    assert_eq!(n_of(&a.open(&h.id).unwrap().body), 5);
    // 見たら、この PC では次から出さない（アプリを開き直しても）
    assert!(a.office_dismiss_notices().unwrap().notices.is_empty());
    let a2 = pa.store();
    a2.status().unwrap();
    assert!(a2.office_status().unwrap().notices.is_empty());
    // 外された B は、古いキーで加わり直せない（上で確かめた）。画面の値に復元キー・パスは入らない
    let json = serde_json::to_string(&st).unwrap() + &serde_json::to_string(&st_a).unwrap();
    assert!(!json.contains(key1.as_str()) && !json.contains(&*o.shared.to_string_lossy()));
    // 共有フォルダの名簿にも、表示名は平文で出ない
    let text =
        String::from_utf8_lossy(&std::fs::read(o.office_root().join("members.lpmb")).unwrap())
            .into_owned();
    assert!(!text.contains("担当N"));
}

#[test]
fn ending_sharing_brings_households_back_into_the_pc() {
    let o = Office::new();
    let (pa, pb, pn) = (o.pc("a"), o.pc("b"), o.pc("new"));
    let (a, b, n) = (pa.store(), pb.store(), pn.store());
    start_and_join(&o, &a, &b);
    let h1 = create(&a, 1);
    let h2 = create(&b, 2);
    let office_id = office_id_of(&o);
    // ほかのメンバーがいる間はやめられない・確認の表示名が違えばやめない
    assert_eq!(
        a.office_end("担当A").unwrap_err(),
        StoreError::OFFICE_OTHERS_REMAIN
    );
    assert_eq!(
        a.office_end("担当B").unwrap_err(),
        StoreError::OFFICE_CONFIRM
    );
    let b_id = b.current_author().unwrap().member_id;
    a.acknowledge_recovery().unwrap();
    a.office_remove(&b_id, "担当B").unwrap();
    let key = a.recovery_key().unwrap();
    a.open(&h1.id).unwrap();
    // 最後の1人がやめる: 世帯を PC の中へ移し、共有フォルダは使わなくなる
    let st = a.office_end(" 担当A ").unwrap();
    assert_eq!(st.state, "off");
    assert!(a.current_author().is_none());
    let list = a.list().unwrap();
    assert_eq!(list.len(), 2);
    assert!(list
        .iter()
        .all(|e| e.updated_by.is_none() && e.open_by.is_empty()));
    assert!(list.iter().any(|e| e.customer_no == h2.customer_no));
    // 暗号化のまま PC の中にあり、開けて直せる
    for (h, n0) in [(&h1, 1), (&h2, 2)] {
        let p = pa.root.join("households").join(format!("{}.lphf", h.id));
        let raw = std::fs::read(&p).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("架空のメモ"));
        assert!(a.can_open_bytes_with_managed_keys(&h.id, &raw));
        assert_eq!(n_of(&a.open(&h.id).unwrap().body), n0);
    }
    a.save(&h2.id, &body(9), "本人").unwrap();
    assert!(meta_of(&a.open(&h2.id).unwrap().body)
        .get("savedBy")
        .is_none());
    // アプリを開き直しても PC の中の世帯として開ける
    let a2 = pa.store();
    a2.status().unwrap();
    assert_eq!(a2.list().unwrap().len(), 2);
    assert_eq!(n_of(&a2.open(&h2.id).unwrap().body), 9);
    // 共有フォルダの世帯ファイル・鍵の札・世帯の札は消え、名簿には「終えた」印が残る
    let left: Vec<PathBuf> = files_under(&o.office_root())
        .into_iter()
        .filter(|p| {
            let s = p.to_string_lossy();
            s.contains(".lphf")
                || s.ends_with(".lphk")
                || s.ends_with(".lpcd")
                || s.ends_with(".lpop")
        })
        .collect();
    assert!(left.is_empty(), "{left:?}");
    let roster = office::open_roster_with_master(
        &std::fs::read(o.office_root().join("members.lpmb")).unwrap(),
        &household_store::recovery::decode(&key).unwrap(),
    )
    .unwrap();
    assert!(roster.closed.is_some());
    // この PC の保管庫から、共有の事務所の鍵・メンバーの秘密鍵が消えている
    assert!(pa.secrets.get(&office_id).unwrap().is_none());
    assert!(pa
        .secrets
        .get(&format!("{office_id}.member"))
        .unwrap()
        .is_none());
    // 終えた事務所には、復元キーでも加われない
    n.status().unwrap();
    assert_eq!(
        n.office_recover_join(&o.shared, "担当N", &key, false, &[])
            .unwrap_err(),
        StoreError::OFFICE_CLOSED
    );
    // 外された B のアプリは外されたことに気づく
    assert_eq!(b.office_status().unwrap().state, "removed");
}

// ---------------------------------------------------------------- 形式 1.0 の前に決めた読み方（0023 の追記 2026-11-04）

/// 共有の事務所の今の親鍵（PC の保管庫の写しから）
fn master_of(pc: &Pc, office_id: &str) -> crypto::Key {
    crypto::key_from_hex(&pc.secrets.get(office_id).unwrap().unwrap()).unwrap()
}

/// 新しい版のアプリが名簿を書き換えた形にする（試験のため、親鍵で開いて直して書く）
fn rewrite_roster(o: &Office, master: &crypto::Key, f: impl FnOnce(&mut Roster)) {
    let p = office::Paths::new(o.office_root());
    let mut r =
        office::open_roster_with_master(&std::fs::read(p.members()).unwrap(), master).unwrap();
    f(&mut r);
    std::fs::write(p.members(), office::encode_roster(&r, master).unwrap()).unwrap();
}

fn read_roster(o: &Office, master: &crypto::Key) -> Roster {
    let p = office::Paths::new(o.office_root());
    office::open_roster_with_master(&std::fs::read(p.members()).unwrap(), master).unwrap()
}

fn read_card(o: &Office, master: &crypto::Key, id: &str) -> office::Card {
    let p = office::Paths::new(o.office_root());
    office::open_card(&std::fs::read(p.card(id)).unwrap(), id, |_| {
        Some(master.clone())
    })
    .unwrap()
}

#[test]
fn fields_added_by_a_newer_app_are_kept_when_rewritten() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    let office_id = office_id_of(&o);
    let master = master_of(&pa, &office_id);
    // MINOR の新しいアプリが、名簿の本文・メンバー・履歴と世帯の札に、この版の知らない欄を足した
    rewrite_roster(&o, &master, |r| {
        r.extra
            .insert("futureOffice".into(), serde_json::json!({"x": 1}));
        r.members[0]
            .extra
            .insert("futureMember".into(), serde_json::json!("v"));
        r.events.push(office::RosterEvent {
            kind: "futureKind".into(),
            member_id: r.members[0].member_id.clone(),
            display_name: "担当A".into(),
            at: "2026-10-19T09:00:00Z".into(),
            extra: [("futureDetail".to_owned(), serde_json::json!(3))]
                .into_iter()
                .collect(),
        });
    });
    let p = office::Paths::new(o.office_root());
    let mut card = read_card(&o, &master, &h.id);
    card.extra
        .insert("futureCard".into(), serde_json::json!(["x"]));
    let (_, mk) = office::peek_roster(&std::fs::read(p.members()).unwrap()).unwrap();
    std::fs::write(
        p.card(&h.id),
        office::encode_card(&office_id, &mk, &h.id, &card, &master),
    )
    .unwrap();
    // この版のアプリが、名簿（復元キーを試した記録）と世帯の札（保存・番号の付け替え）を書き直す
    let key = a.recovery_key().unwrap();
    b.test_recovery_key(&key).unwrap();
    b.open(&h.id).unwrap();
    b.save(&h.id, &body(2), "本人・配偶者").unwrap();
    b.rename(&h.id, "Q-7").unwrap();
    // 知らない欄は残り、知っている欄は書き直されている
    let r = read_roster(&o, &master);
    assert_eq!(r.extra["futureOffice"], serde_json::json!({"x": 1}));
    assert_eq!(r.members[0].extra["futureMember"], serde_json::json!("v"));
    let ev = r.events.iter().find(|e| e.kind == "futureKind").unwrap();
    assert_eq!(ev.extra["futureDetail"], serde_json::json!(3));
    assert!(r.recovery.unwrap().verified_at.is_some());
    let c = read_card(&o, &master, &h.id);
    assert_eq!(c.extra["futureCard"], serde_json::json!(["x"]));
    assert_eq!(c.summary, "本人・配偶者");
    assert_eq!(c.customer_no, "Q-7");
    // 知らない種類の履歴の行は、知らせに出さない
    assert!(a.office_status().unwrap().notices.is_empty());
}

#[test]
fn a_role_this_version_does_not_know_is_view_only() {
    let o = Office::new();
    let (pa, pb, pc) = (o.pc("a"), o.pc("b"), o.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    start_and_join(&o, &a, &b);
    let h = create(&a, 1);
    let b_id = b.current_author().unwrap().member_id;
    let master = master_of(&pa, &office_id_of(&o));
    // 新しい版のアプリが、B に「閲覧だけ」の役割（この版の知らない値）を付けた
    rewrite_roster(&o, &master, |r| {
        r.members
            .iter_mut()
            .find(|m| m.member_id == b_id)
            .unwrap()
            .role = "viewer".into();
    });
    let st = b.office_status().unwrap();
    assert_eq!(st.state, "member");
    assert!(st.view_only);
    assert!(!a.office_status().unwrap().view_only);
    assert_eq!(
        a.office_status()
            .unwrap()
            .members
            .iter()
            .find(|m| m.member_id == b_id)
            .unwrap()
            .role,
        "viewer"
    );
    // 開けるが閲覧だけ。保存・作成・番号の付け替え・削除・共有の操作はできない
    let op = b.open(&h.id).unwrap();
    assert!(op.read_only && op.view_only);
    assert_eq!(n_of(&op.body), 1);
    assert_eq!(
        b.save(&h.id, &body(2), "本人").unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    assert_eq!(
        b.create(CreateRequest {
            body: body(3),
            summary: "本人".into(),
        })
        .unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    assert_eq!(
        b.rename(&h.id, "Z-1").unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    let no = a.list().unwrap()[0].customer_no.clone();
    assert_eq!(
        b.delete(&h.id, &no).unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", true, &[]).unwrap();
    let rid = b.office_status().unwrap().requests[0].request_id.clone();
    assert_eq!(
        b.office_approve(&rid, &fingerprint_of(&c)).unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    let a_id = a.current_author().unwrap().member_id;
    assert_eq!(
        b.office_remove(&a_id, "担当A").unwrap_err(),
        StoreError::OFFICE_VIEW_ONLY
    );
    // A は今までどおり使え、A が名簿を書き直しても B の役割は残る
    a.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    a.open(&h.id).unwrap();
    a.save(&h.id, &body(4), "本人").unwrap();
    assert!(b.office_status().unwrap().view_only);
    assert_eq!(n_of(&b.open(&h.id).unwrap().body), 4);
}

#[test]
fn files_left_in_an_old_key_epoch_are_moved_before_the_old_key_is_dropped() {
    let o = Office::new();
    let (pa, pb, pc) = (o.pc("a"), o.pc("b"), o.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    start_and_join(&o, &a, &b);
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", true, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    let h = create(&b, 1);
    // B が明細の取り込みで覚えた行（B のファイルは今の親鍵で書かれる）
    b.statement_learn(
        &[household_store::statement_dict::DictionaryEntry {
            key: "架空ノ店".into(),
            category: "food".into(),
            annual: false,
            at: "2026-10-19T09:00:00Z".into(),
            by: None,
            removed: false,
        }],
        &[],
    )
    .unwrap();
    let p = office::Paths::new(o.office_root());
    let old_card = std::fs::read(p.card(&h.id)).unwrap();
    let c_id = c.current_author().unwrap().member_id;
    a.office_remove(&c_id, "担当C").unwrap();
    a.acknowledge_recovery().unwrap();
    // 入れ替えを知らない PC が、古い親鍵のまま世帯の札を書いた（同期の遅れ）。B は30日より長く開かない
    std::fs::write(p.card(&h.id), &old_card).unwrap();
    o.clock.advance(31 * 86_400);
    // A が次に起動すると、前の親鍵を名簿から消す前に、古い時代のままの札と辞書を今の親鍵で書き直す
    let a2 = pa.store();
    a2.status().unwrap();
    let st = a2.office_status().unwrap();
    assert_eq!(st.state, "member");
    let master = master_of(&pa, &office_id_of(&o));
    assert!(
        read_roster(&o, &master).previous.is_empty(),
        "前の親鍵は消えた"
    );
    let list = a2.list().unwrap();
    assert!(
        list.iter().any(|e| e.id == h.id),
        "古い時代の札の世帯も一覧に出る"
    );
    assert!(a2
        .statement_office()
        .unwrap()
        .dictionary
        .iter()
        .any(|e| e.key == "架空ノ店"));
    let (_, mk) = office::peek_roster(&std::fs::read(p.members()).unwrap()).unwrap();
    assert_eq!(
        office::peek_card_master(&std::fs::read(p.card(&h.id)).unwrap()).unwrap(),
        mk
    );
    let b_id = b.current_author().unwrap().member_id;
    assert_eq!(
        office::peek_statement_dict_master(&std::fs::read(p.statement_dict(&b_id)).unwrap())
            .unwrap(),
        mk
    );
}

#[test]
fn a_member_reseals_its_own_statement_dictionary_after_a_rotation() {
    let o = Office::new();
    let (pa, pb, pc) = (o.pc("a"), o.pc("b"), o.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    start_and_join(&o, &a, &b);
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", true, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    b.statement_learn(
        &[household_store::statement_dict::DictionaryEntry {
            key: "架空ノ店".into(),
            category: "food".into(),
            annual: false,
            at: "2026-10-19T09:00:00Z".into(),
            by: None,
            removed: false,
        }],
        &[],
    )
    .unwrap();
    let c_id = c.current_author().unwrap().member_id;
    a.office_remove(&c_id, "担当C").unwrap();
    // B が名簿の入れ替えに気づくと、自分の辞書を今の親鍵で書き直す
    b.office_status().unwrap();
    b.list().unwrap();
    let p = office::Paths::new(o.office_root());
    let (_, mk) = office::peek_roster(&std::fs::read(p.members()).unwrap()).unwrap();
    let b_id = b.current_author().unwrap().member_id;
    assert_eq!(
        office::peek_statement_dict_master(&std::fs::read(p.statement_dict(&b_id)).unwrap())
            .unwrap(),
        mk
    );
}

#[test]
fn ending_sharing_keeps_what_every_pc_learned_from_statements() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    b.statement_learn(
        &[household_store::statement_dict::DictionaryEntry {
            key: "架空ノ店".into(),
            category: "food".into(),
            annual: false,
            at: "2026-10-19T09:00:00Z".into(),
            by: None,
            removed: false,
        }],
        &[],
    )
    .unwrap();
    let b_id = b.current_author().unwrap().member_id;
    a.office_remove(&b_id, "担当B").unwrap();
    a.acknowledge_recovery().unwrap();
    a.office_end("担当A").unwrap();
    // 共有フォルダの辞書のファイルは消え、外した B が覚えた分も事務所の辞書としてこの PC に残る（0023 の追記 2026-11-04）
    let p = office::Paths::new(o.office_root());
    assert!(files_under(&p.statement_dict_dir()).is_empty());
    assert!(a
        .statement_office()
        .unwrap()
        .dictionary
        .iter()
        .any(|e| e.key == "架空ノ店"));
}

/// A・B・C の事務所。C は30日より長くアプリを開かず、その間に A が B を外し、前の親鍵が名簿から消える
fn long_absence(o: &Office) -> (Pc, Pc, Store) {
    let (pa, pb, pc) = (o.pc("a"), o.pc("b"), o.pc("c"));
    let (a, b, c) = (pa.store(), pb.store(), pc.store());
    start_and_join(o, &a, &b);
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", true, &[]).unwrap();
    let rid = a.office_status().unwrap().requests[0].request_id.clone();
    a.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    create(&a, 1);
    drop(c);
    let b_id = b.current_author().unwrap().member_id;
    a.office_remove(&b_id, "担当B").unwrap();
    a.acknowledge_recovery().unwrap();
    create(&a, 2);
    o.clock.advance(31 * 86_400);
    // A が次に起動すると、退いてから30日たった前の親鍵を名簿から消す
    let a2 = pa.store();
    a2.status().unwrap();
    assert_eq!(a2.office_status().unwrap().state, "member");
    let master = master_of(&pa, &office_id_of(o));
    assert!(read_roster(o, &master).previous.is_empty());
    (pa, pc, a2)
}

#[test]
fn a_member_away_for_more_than_30_days_comes_back_with_the_office_code() {
    let o = Office::new();
    let (pa, pc, a) = long_absence(&o);
    // C（の PC）が戻ってくる: 手元の親鍵が名簿の前の親鍵の一覧に無いので、名簿を受け入れられない
    let c = pc.store();
    c.status().unwrap();
    let st = c.office_status().unwrap();
    assert_eq!(st.state, "unavailable");
    assert_eq!(st.problem.as_deref(), Some("E_OFFICE_ROSTER_UNVERIFIED"));
    assert_eq!(c.list().unwrap_err(), StoreError::OFFICE_ROSTER_UNVERIFIED);
    let oid = office_id_of(&o);
    let stale = master_of(&pc, &oid);
    // 違う番号は受け入れない（何も変えない）
    let code = a.office_status().unwrap().office_code.unwrap();
    assert_eq!(code.len(), 19, "16文字を4文字ずつ区切る");
    let mut wrong: Vec<char> = code.chars().collect();
    wrong[0] = if wrong[0] == 'A' { 'B' } else { 'A' };
    let wrong: String = wrong.into_iter().collect();
    assert_eq!(
        c.office_accept_roster(&wrong).unwrap_err(),
        StoreError::OFFICE_CODE_MISMATCH
    );
    assert_eq!(*master_of(&pc, &oid), *stale);
    assert_eq!(
        c.office_status().unwrap().problem.as_deref(),
        Some("E_OFFICE_ROSTER_UNVERIFIED")
    );
    // ほかのメンバー（A）の画面の番号を聞いて入れると受け入れる（小文字・区切りなしでもよい）
    let st = c
        .office_accept_roster(&code.to_lowercase().replace('-', " "))
        .unwrap();
    assert_eq!(st.state, "member");
    assert!(st.problem.is_none());
    assert_eq!(st.office_code.as_deref(), Some(code.as_str()));
    assert_eq!(*master_of(&pc, &oid), *master_of(&pa, &oid));
    // 入れ替えの前に作った世帯も、後に作った世帯も開ける。直して保存できる
    let list = c.list().unwrap();
    assert_eq!(list.len(), 2);
    for e in &list {
        let h = c.open(&e.id).unwrap();
        assert!(n_of(&h.body) >= 1);
    }
    // 受け入れた後は、もう一度入れる必要はない（入れようとしても今の状態ではできない）
    assert_eq!(
        c.office_accept_roster(&code).unwrap_err(),
        StoreError::OFFICE_STATE
    );
    let c2 = pc.store();
    c2.status().unwrap();
    assert_eq!(c2.office_status().unwrap().state, "member");
}

#[test]
fn a_member_away_for_more_than_30_days_can_also_use_the_office_recovery_key() {
    let o = Office::new();
    let (_, pc, a) = long_absence(&o);
    let key = a.recovery_key().unwrap();
    let c = pc.store();
    c.status().unwrap();
    assert_eq!(
        c.office_status().unwrap().problem.as_deref(),
        Some("E_OFFICE_ROSTER_UNVERIFIED")
    );
    // 打ち間違い・ほかのキー（古い控えなど）では受け入れない
    let mut typo = key.to_string();
    typo.replace_range(0..1, if typo.starts_with('A') { "B" } else { "A" });
    assert_eq!(
        c.office_accept_roster(&typo).unwrap_err(),
        StoreError::RECOVERY_TYPO
    );
    assert_eq!(
        c.office_accept_roster(&household_store::recovery::encode(&crypto::random_key()))
            .unwrap_err(),
        StoreError::OFFICE_CODE_MISMATCH
    );
    assert_eq!(c.office_accept_roster(&key).unwrap().state, "member");
    assert_eq!(c.list().unwrap().len(), 2);
}

#[test]
fn a_forged_roster_with_a_different_office_code_is_refused_after_a_long_absence() {
    let o = Office::new();
    let (pa, pc, a) = long_absence(&o);
    let code = a.office_status().unwrap().office_code.unwrap();
    // 共有フォルダに書ける者（外した B など）が、C の公開鍵に向けて自分の親鍵を包んだ偽の名簿に差し替える。
    // 名簿の外の値（事務所ID・メンバーの一覧・表示名）は本物と同じにする
    let oid = office_id_of(&o);
    let real = read_roster(&o, &master_of(&pa, &oid));
    let mut fake = real.clone();
    fake.master_key_id = crypto::new_uuid();
    fake.previous = vec![];
    fake.recovery = None;
    let fake_master = crypto::random_key();
    let p = office::Paths::new(o.office_root());
    std::fs::write(
        p.members(),
        office::encode_roster(&fake, &fake_master).unwrap(),
    )
    .unwrap();
    let c = pc.store();
    c.status().unwrap();
    assert_eq!(
        c.office_status().unwrap().problem.as_deref(),
        Some("E_OFFICE_ROSTER_UNVERIFIED")
    );
    let stale = master_of(&pc, &oid);
    // 本物の番号（A から聞いた）は、偽の名簿の親鍵の番号と合わない
    assert_ne!(member::office_code(&fake_master), code);
    assert_eq!(
        c.office_accept_roster(&code).unwrap_err(),
        StoreError::OFFICE_CODE_MISMATCH
    );
    assert_eq!(*master_of(&pc, &oid), *stale, "手元の親鍵は変えない");
    assert_eq!(c.list().unwrap_err(), StoreError::OFFICE_ROSTER_UNVERIFIED);
    assert_eq!(
        c.storage_notices()
            .unwrap()
            .iter()
            .filter(|n| n.kind == "unavailable")
            .count(),
        1
    );
}

#[test]
fn what_a_removed_member_learned_from_statements_stays_in_the_office() {
    let o = Office::new();
    let (pa, pb) = (o.pc("a"), o.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    start_and_join(&o, &a, &b);
    let learn = |s: &Store, key: &str| {
        s.statement_learn(
            &[household_store::statement_dict::DictionaryEntry {
                key: key.into(),
                category: "food".into(),
                annual: false,
                at: "2026-10-19T09:00:00Z".into(),
                by: None,
                removed: false,
            }],
            &[],
        )
        .unwrap();
    };
    learn(&b, "架空ノ店");
    let p = office::Paths::new(o.office_root());
    let b_id = b.current_author().unwrap().member_id;
    // B が知っている親鍵（外す前の親鍵）
    let oid = office_id_of(&o);
    let b_master = master_of(&pb, &oid);
    let b_mk = office::peek_roster(&std::fs::read(p.members()).unwrap())
        .unwrap()
        .1;
    a.office_remove(&b_id, "担当B").unwrap();
    a.acknowledge_recovery().unwrap();
    let has = |s: &Store, key: &str| {
        s.statement_office()
            .unwrap()
            .dictionary
            .iter()
            .any(|e| e.key == key)
    };
    // 外した後も事務所の辞書に残り、B のファイルは今の親鍵で書き直してある
    assert!(has(&a, "架空ノ店"));
    let (_, mk) = office::peek_roster(&std::fs::read(p.members()).unwrap()).unwrap();
    assert_eq!(
        office::peek_statement_dict_master(&std::fs::read(p.statement_dict(&b_id)).unwrap())
            .unwrap(),
        mk
    );
    // 外した B が、B の知っている古い親鍵で自分のファイルを置き直しても、事務所の辞書には混ざらない
    let kept = std::fs::read(p.statement_dict(&b_id)).unwrap();
    let mut forged = household_store::statement_dict::StatementOffice::default();
    forged
        .dictionary
        .push(household_store::statement_dict::DictionaryEntry {
            key: "混ぜたい店".into(),
            category: "hobby".into(),
            annual: false,
            at: "2026-10-20T09:00:00Z".into(),
            by: Some(b_id.clone()),
            removed: false,
        });
    std::fs::write(
        p.statement_dict(&b_id),
        office::encode_statement_dict(&oid, &b_mk, &b_id, &forged, &b_master),
    )
    .unwrap();
    let c = pa.store();
    c.status().unwrap();
    assert!(!has(&c, "混ぜたい店"));
    std::fs::write(p.statement_dict(&b_id), &kept).unwrap();
    // 30日たって前の親鍵が名簿から消えても残る
    o.clock.advance(31 * 86_400);
    let a2 = pa.store();
    a2.status().unwrap();
    assert!(read_roster(&o, &master_of(&pa, &oid)).previous.is_empty());
    assert!(has(&a2, "架空ノ店"));
    // もう1人外して鍵がまた入れ替わっても残る（前の時代のまま残ったファイルも、前の親鍵を消す前に書き直す）
    let c = o.pc("c").store();
    c.status().unwrap();
    c.office_join(&o.shared, "担当C", true, &[]).unwrap();
    let rid = a2.office_status().unwrap().requests[0].request_id.clone();
    a2.office_approve(&rid, &fingerprint_of(&c)).unwrap();
    assert_eq!(c.office_status().unwrap().state, "member");
    assert!(has(&c, "架空ノ店"), "後から参加した人にも出る");
    let c_id = c.current_author().unwrap().member_id;
    a2.office_remove(&c_id, "担当C").unwrap();
    a2.acknowledge_recovery().unwrap();
    o.clock.advance(31 * 86_400);
    let a3 = pa.store();
    a3.status().unwrap();
    assert!(read_roster(&o, &master_of(&pa, &oid)).previous.is_empty());
    assert!(has(&a3, "架空ノ店"));
}
