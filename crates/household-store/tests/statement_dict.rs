// 明細の取り込みで覚えた辞書と形（0034 の4・5）: 事務所データに暗号化して持つ・事務所で共有しているときは共有する。
// 2つの PC を「2つのデータフォルダ＋それぞれのメモリの保管庫＋同じ共有フォルダ（テスト用の一時フォルダ）」で模す。OS の保管庫には触れない。
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::statement_dict::{DictionaryEntry, LearnedFormat};
use household_store::{crypto, office, Clock, MemorySecretStore, Store, StoreError};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

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

struct Base {
    dir: PathBuf,
    clock: TestClock,
}

impl Base {
    fn new() -> Base {
        Base {
            dir: std::env::temp_dir().join(format!("hs-stmt-{}", crypto::new_uuid())),
            clock: TestClock(Arc::new(AtomicI64::new(1_792_368_000))),
        }
    }
    fn pc(&self, name: &str) -> Pc {
        Pc {
            root: self.dir.join(format!("pc-{name}")).join("data"),
            secrets: Arc::new(MemorySecretStore::default()),
            clock: self.clock.clone(),
        }
    }
    fn shared(&self) -> PathBuf {
        let p = self.dir.join("共有フォルダ");
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}

impl Drop for Base {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn entry(key: &str, category: &str, at: &str) -> DictionaryEntry {
    DictionaryEntry {
        key: key.into(),
        category: category.into(),
        annual: false,
        at: at.into(),
        by: Some("呼んだ側の値は使わない".into()),
        removed: false,
    }
}

fn format(kind: &str, at: &str) -> LearnedFormat {
    LearnedFormat {
        fingerprint: format!("sha256:{}", "b".repeat(64)),
        kind: kind.into(),
        mapping: serde_json::json!({"headerRow": 0, "columns": {"date": 0, "merchant": 1, "amount": 2}, "sign": "expensePositive"}),
        label: Some("架空のカードの CSV".into()),
        at: at.into(),
        by: None,
    }
}

#[test]
fn one_pc_learns_keeps_encrypted_and_rejects_bad_rows() {
    let base = Base::new();
    let pc = base.pc("a");
    let a = pc.store();
    a.status().unwrap();
    assert!(a.statement_office().unwrap().dictionary.is_empty());
    let got = a
        .statement_learn(
            &[entry("架空ノ謎ノ店", "recreation", "2026-10-21T10:00:00Z")],
            &[format("card", "2026-10-21T10:00:00Z")],
        )
        .unwrap();
    assert_eq!(got.dictionary.len(), 1);
    assert_eq!(got.dictionary[0].by, None, "1人のときは直した人を持たない");
    assert_eq!(got.formats.len(), 1);
    // 形の合わない行が1つでもあれば、何も覚えない
    let e = a
        .statement_learn(
            &[
                entry("架空ノ店", "food", "2026-10-21T11:00:00Z"),
                entry("空白 のある鍵", "food", "2026-10-21T11:00:00Z"),
            ],
            &[],
        )
        .unwrap_err();
    assert_eq!(e, StoreError::STATEMENT_DICT);
    // 新しい行が古い行を置き換える
    a.statement_learn(
        &[entry("架空ノ謎ノ店", "social", "2026-10-22T10:00:00Z")],
        &[],
    )
    .unwrap();
    // 開き直しても残る（事務所データ。平文のファイルに店の名前が出ない）
    drop(a);
    let again = pc.store();
    again.status().unwrap();
    let got = again.statement_office().unwrap();
    assert_eq!(got.dictionary.len(), 1);
    assert_eq!(got.dictionary[0].category, "social");
    for f in walk(&pc.root) {
        let bytes = std::fs::read(&f).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            !text.contains("架空ノ謎ノ店"),
            "{} に店の名前が平文で出ている",
            f.display()
        );
    }
}

fn walk(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

#[test]
fn shared_office_members_see_each_others_learning() {
    let base = Base::new();
    let shared = base.shared();
    let (pa, pb) = (base.pc("a"), base.pc("b"));
    let (a, b) = (pa.store(), pb.store());
    a.status().unwrap();
    a.office_start(&shared, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&shared, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.clone().unwrap();
    let req = a.office_status().unwrap().requests;
    a.office_approve(&req[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    let a_id = a.current_author().unwrap().member_id;
    let b_id = b.current_author().unwrap().member_id;

    a.statement_learn(&[entry("架空ノ店A", "food", "2026-10-21T10:00:00Z")], &[])
        .unwrap();
    b.statement_learn(
        &[entry("架空ノ店B", "recreation", "2026-10-21T10:05:00Z")],
        &[format("bank", "2026-10-21T10:05:00Z")],
    )
    .unwrap();
    let seen_by_a = a.statement_office().unwrap();
    let keys: Vec<(&str, Option<&str>)> = seen_by_a
        .dictionary
        .iter()
        .map(|e| (e.key.as_str(), e.by.as_deref()))
        .collect();
    assert_eq!(
        keys,
        vec![
            ("架空ノ店A", Some(a_id.as_str())),
            ("架空ノ店B", Some(b_id.as_str()))
        ]
    );
    assert_eq!(seen_by_a.formats.len(), 1);
    // B が A の覚えた行を直す → A からも新しい値が見える
    b.statement_learn(&[entry("架空ノ店A", "social", "2026-10-22T09:00:00Z")], &[])
        .unwrap();
    let a_now = a.statement_office().unwrap();
    let row = a_now
        .dictionary
        .iter()
        .find(|e| e.key == "架空ノ店A")
        .unwrap();
    assert_eq!(row.category, "social");
    assert_eq!(row.by.as_deref(), Some(b_id.as_str()));
    // メンバーごとのファイルに、そのメンバーが直した行だけ（暗号化）
    let root = shared.join(office::OFFICE_DIR).join("statement-dict");
    let mut names: Vec<String> = std::fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut want = vec![format!("{a_id}.lpsd"), format!("{b_id}.lpsd")];
    want.sort();
    assert_eq!(names, want);
    for n in &names {
        let bytes = std::fs::read(root.join(n)).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("架空ノ店"));
    }
}
