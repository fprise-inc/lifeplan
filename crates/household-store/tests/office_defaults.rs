// 事務所の既定値（0073）: 事務所データに暗号化して持つ・開き直しても残る・形の合わない値は受けない。
// PC を「データフォルダ＋メモリの保管庫」で模す。OS の保管庫には触れない。
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::{crypto, Clock, MemorySecretStore, Store, StoreError};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn defaults_are_kept_encrypted_and_reopen() {
    let dir = Dir(std::env::temp_dir().join(format!("hs-defaults-{}", crypto::new_uuid())));
    let root = dir.0.join("data");
    let secrets = Arc::new(MemorySecretStore::default());
    let clock = TestClock(Arc::new(AtomicI64::new(1_792_368_000)));
    let s = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s.status().unwrap();
    assert_eq!(s.office_defaults().unwrap(), serde_json::json!({}));
    let v = serde_json::json!({"version": 1, "care": {"selfAndSpouse": "fill"}, "assumptions": {"inflation": "0.015"}, "changedOn": "2026-10-27"});
    s.set_office_defaults(v.clone()).unwrap();
    assert_eq!(s.office_defaults().unwrap(), v);
    // 事務所データは暗号化して保存する（平文の値がファイルに無い）
    for e in std::fs::read_dir(&root).unwrap() {
        let p = e.unwrap().path();
        if p.is_file() {
            let bytes = std::fs::read(&p).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains("selfAndSpouse"),
                "{}",
                p.display()
            );
        }
    }
    // 開き直しても残る
    drop(s);
    let s2 = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s2.status().unwrap();
    assert_eq!(s2.office_defaults().unwrap(), v);
    // オブジェクトでない・大きすぎる値は受けず、前の値のまま
    assert_eq!(
        s2.set_office_defaults(serde_json::json!([1, 2]))
            .unwrap_err(),
        StoreError::OFFICE_DEFAULTS
    );
    let big = serde_json::json!({"memo": "x".repeat(40 * 1024)});
    assert_eq!(
        s2.set_office_defaults(big).unwrap_err(),
        StoreError::OFFICE_DEFAULTS
    );
    assert_eq!(s2.office_defaults().unwrap(), v);
    // 空のオブジェクトで外す
    s2.set_office_defaults(serde_json::json!({})).unwrap();
    assert_eq!(s2.office_defaults().unwrap(), serde_json::json!({}));
}
