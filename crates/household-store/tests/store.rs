// データフォルダ全体の試験（0011・0013 の「テストで確かめること」）。保管庫はメモリの実装を使う（OS の保管庫に触れない）
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::atomic::FailPoint;
use household_store::{
    crypto, recovery, Clock, CreateRequest, MemorySecretStore, SecretStore, StatusState, Store,
    StoreError,
};

/// 進められる時計
#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl TestClock {
    fn new() -> TestClock {
        // 2026-10-18 09:00:00Z
        TestClock(Arc::new(AtomicI64::new(1_792_281_600 + 9 * 3600)))
    }
    fn advance_days(&self, d: i64) {
        self.0.fetch_add(d * 86_400, Ordering::SeqCst);
    }
}

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Env {
    root: PathBuf,
    secrets: Arc<MemorySecretStore>,
    clock: TestClock,
}

impl Env {
    fn new() -> Env {
        let root = std::env::temp_dir().join(format!("hs-store-{}", crypto::new_uuid()));
        Env {
            root,
            secrets: Arc::new(MemorySecretStore::default()),
            clock: TestClock::new(),
        }
    }
    fn store(&self) -> Store {
        Store::new(
            self.root.clone(),
            self.secrets.clone(),
            self.clock.clone(),
            "0.1.0-test",
        )
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn body(n: i64) -> String {
    serde_json::json!({
        "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"members": [{"id": "m1", "kind": "self"}]}}}, "memo": ["架空のメモ"]},
        "proposals": [{"id": "p1", "title": "B案", "n": n}],
        "workspace": {"band": ["p1"], "base": "current", "selected": "p1"},
        "display": {"metrics": ["takeHome"], "atAge": 90},
        "extDefinitions": {"ext.exampleOffice.carCount": {"type": "integer"}},
        "ext": {"ext.exampleOffice.carCount": 2}
    })
    .to_string()
}

fn without_meta(json: &str) -> serde_json::Value {
    let mut v: serde_json::Value = serde_json::from_str(json).unwrap();
    v.as_object_mut().unwrap().remove("meta");
    v
}

fn create(store: &Store, n: i64) -> household_store::Opened {
    store
        .create(CreateRequest {
            body: body(n),
            summary: "本人・配偶者".into(),
        })
        .unwrap()
}

#[test]
fn first_run_creates_the_office_and_a_master_key() {
    let env = Env::new();
    let store = env.store();
    let st = store.status().unwrap();
    assert_eq!(st.state, StatusState::Ready);
    assert!(st.first_run);
    assert!(!st.recovery_acknowledged);
    assert!(store.list().unwrap().is_empty());
    // 2回目の起動は初回ではない
    let st2 = env.store().status().unwrap();
    assert!(!st2.first_run);
}

#[test]
fn ai_connector_is_off_by_default_and_the_setting_is_kept() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    assert!(
        !store.ai_connector_enabled().unwrap(),
        "AI接続口は既定でオフ（0015）"
    );
    assert!(store.set_ai_connector_enabled(true).unwrap());
    // 開き直しても覚えている（事務所データは暗号化して保存）
    let store2 = env.store();
    store2.status().unwrap();
    assert!(store2.ai_connector_enabled().unwrap());
    store2.set_ai_connector_enabled(false).unwrap();
    let store3 = env.store();
    store3.status().unwrap();
    assert!(!store3.ai_connector_enabled().unwrap());
}

#[test]
fn save_and_open_round_trip() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    assert_eq!(o.generation, 1);
    assert_eq!(without_meta(&o.body), without_meta(&body(1)));
    let saved = store.save(&o.id, &body(2), "本人・配偶者・子1人").unwrap();
    assert_eq!(saved.generation, 2);
    // 開き直す（アプリを閉じて開いた代わり）
    let store2 = env.store();
    let st = store2.status().unwrap();
    assert_eq!(
        st.last_opened.as_deref(),
        Some(o.id.as_str()),
        "前回の世帯を覚えている"
    );
    let o2 = store2.open(&o.id).unwrap();
    assert_eq!(o2.generation, 2);
    assert_eq!(
        without_meta(&o2.body),
        without_meta(&body(2)),
        "保存→読み込みで同じ（知らない拡張項目も残る）"
    );
    let meta: serde_json::Value =
        serde_json::from_str::<serde_json::Value>(&o2.body).unwrap()["meta"].clone();
    assert_eq!(meta["format"], "lifeplan.household");
    assert_eq!(meta["formatVersion"], household_store::migrate::CURRENT);
    assert_eq!(meta["customerNo"], o.customer_no.as_str());
    // 誰が直したか（0023 の6）: 共有していないときは、保存した人を書かず、改訂の履歴だけ（メンバーは null）を残す
    assert!(meta.get("savedBy").is_none());
    assert_eq!(
        meta["revisions"].as_array().unwrap().len(),
        1,
        "続けての保存は1行にまとめる"
    );
    assert_eq!(meta["revisions"][0]["memberId"], serde_json::Value::Null);
    assert_eq!(meta["revisions"][0]["fromGeneration"], 1);
    assert_eq!(meta["revisions"][0]["toGeneration"], 2);
    assert_eq!(meta["revisions"][0]["count"], 2);
    assert_eq!(meta["editors"], serde_json::json!({}));
    let list = store2.list().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].summary, "本人・配偶者・子1人");
    // 直前の世代が残る
    let p = store2.household_path_for_test(&o.id);
    assert!(household_store::atomic::prev_path(&p).exists());
}

#[test]
fn the_file_never_contains_plain_values() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let bytes = std::fs::read(store.household_path_for_test(&o.id)).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    // 数字だけの値（顧客番号の 0001・年月の 2026-10）は、平文の見出しの16進の文字列（世帯ID・ノンスなど）にたまたま同じ並びが
    // 出ることがあるので、平文で書いたときの JSON の値の形（引用符で囲む）で探す。欄の名前（customerNo）も探す
    let quoted = |v: &str| format!("\"{v}\"");
    for s in [
        "架空のメモ".to_owned(),
        "baseMonth".to_owned(),
        "B案".to_owned(),
        "customerNo".to_owned(),
        quoted(&o.customer_no),
        quoted("2026-10"),
    ] {
        assert!(!text.contains(&s), "{s} が平文で入っている");
    }
}

#[test]
fn tampering_is_detected() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let p = store.household_path_for_test(&o.id);
    let good = std::fs::read(&p).unwrap();
    // 暗号文の中の1ビット
    let mut bad = good.clone();
    let i = bad.len() - 40;
    bad[i] ^= 0x04;
    std::fs::write(&p, &bad).unwrap();
    assert_eq!(store.open(&o.id).unwrap_err(), StoreError::CORRUPT);
    // 見出しの世代番号の書き換え（長さを変えずに 1 → 9）
    let text = String::from_utf8_lossy(&good).into_owned();
    let pos = text.find("\"generation\":1").unwrap() + "\"generation\":".len();
    let mut bad = good.clone();
    bad[pos] = b'9';
    std::fs::write(&p, &bad).unwrap();
    assert_eq!(store.open(&o.id).unwrap_err(), StoreError::CORRUPT);
    std::fs::write(&p, &good).unwrap();
    assert!(store.open(&o.id).is_ok());
}

#[test]
fn another_households_file_or_key_does_not_open() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let a = create(&store, 1);
    let b = create(&store, 2);
    // b の欄に a のファイルを置く: 見出しの世帯IDが違うので開かない
    let pa = store.household_path_for_test(&a.id);
    let pb = store.household_path_for_test(&b.id);
    std::fs::copy(&pa, &pb).unwrap();
    assert_eq!(store.open(&b.id).unwrap_err(), StoreError::CORRUPT);
    // a のファイルを、b の鍵で開こうとしても開かない（鍵の取り違え）
    let bytes = std::fs::read(&pa).unwrap();
    assert!(!store.can_open_bytes_with_managed_keys(&b.id, &bytes));
    assert!(store.can_open_bytes_with_managed_keys(&a.id, &bytes));
}

#[test]
fn a_different_master_key_cannot_open_and_asks_for_recovery() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let key = store.recovery_key().unwrap().to_string();
    // 保管庫の親鍵を、別の親鍵に入れ替える
    let office: serde_json::Value =
        serde_json::from_slice(&std::fs::read(env.root.join("office.json")).unwrap()).unwrap();
    let office_id = office["officeId"].as_str().unwrap().to_owned();
    env.secrets
        .set(
            &office_id,
            &crypto::hex_encode(crypto::random_key().as_ref()),
        )
        .unwrap();
    let store2 = env.store();
    assert_eq!(store2.status().unwrap().state, StatusState::NeedsRecovery);
    assert_eq!(store2.open(&o.id).unwrap_err(), StoreError::NEEDS_RECOVERY);
    // 復元キーで戻す
    let st = store2.restore_with_recovery_key(&key).unwrap();
    assert_eq!(st.state, StatusState::Ready);
    assert!(store2.open(&o.id).is_ok());
}

#[test]
fn recovery_key_restores_a_lost_master_key() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let key = store.recovery_key().unwrap().to_string();
    assert_eq!(key.chars().count(), recovery::DISPLAY_LEN);
    // 保管庫から親鍵が消えた（OS の入れ直し・PC の交換など）
    let office: serde_json::Value =
        serde_json::from_slice(&std::fs::read(env.root.join("office.json")).unwrap()).unwrap();
    env.secrets
        .delete(office["officeId"].as_str().unwrap())
        .unwrap();
    let store2 = env.store();
    assert_eq!(store2.status().unwrap().state, StatusState::NeedsRecovery);
    // 打ち間違い・別の復元キー
    let mut typo: Vec<char> = key.chars().collect();
    typo[0] = if typo[0] == 'A' { 'B' } else { 'A' };
    assert_eq!(
        store2
            .restore_with_recovery_key(&typo.into_iter().collect::<String>())
            .unwrap_err(),
        StoreError::RECOVERY_TYPO
    );
    let other = recovery::encode(&crypto::random_key()).to_string();
    assert_eq!(
        store2.restore_with_recovery_key(&other).unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    // 小文字・空白区切りでも戻せる
    let st = store2
        .restore_with_recovery_key(&key.to_lowercase().replace('-', " "))
        .unwrap();
    assert_eq!(st.state, StatusState::Ready);
    assert_eq!(
        without_meta(&store2.open(&o.id).unwrap().body),
        without_meta(&body(1))
    );
}

#[test]
fn testing_and_acknowledging_the_recovery_key() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let key = store.recovery_key().unwrap().to_string();
    assert_eq!(
        store.test_recovery_key("ABCD").unwrap_err(),
        StoreError::RECOVERY_TYPO
    );
    let other = recovery::encode(&crypto::random_key()).to_string();
    assert_eq!(
        store.test_recovery_key(&other).unwrap_err(),
        StoreError::RECOVERY_MISMATCH
    );
    let st = store.test_recovery_key(&key).unwrap();
    assert!(st.recovery_verified_at.is_some());
    assert!(!st.recovery_acknowledged);
    let st = store.acknowledge_recovery().unwrap();
    assert!(st.recovery_acknowledged);
    assert!(
        env.store().status().unwrap().recovery_acknowledged,
        "記録が残る"
    );
}

#[test]
fn a_crash_at_any_stage_keeps_a_complete_generation() {
    for fp in [
        FailPoint::DuringTempWrite,
        FailPoint::AfterTempWritten,
        FailPoint::AfterCurrentMoved,
        FailPoint::AfterReplaced,
    ] {
        let env = Env::new();
        let store = env.store();
        store.status().unwrap();
        let o = create(&store, 1);
        store.set_fail_point(fp);
        assert!(store.save(&o.id, &body(2), "").is_err(), "{fp:?}");
        // 強制終了の後に起動し直す
        let store2 = env.store();
        store2.status().unwrap();
        let o2 = store2.open(&o.id).unwrap_or_else(|e| panic!("{fp:?}: {e}"));
        let v = without_meta(&o2.body);
        assert!(
            v == without_meta(&body(1)) || v == without_meta(&body(2)),
            "{fp:?}: 前の世代か新しい世代の完全な形"
        );
        match fp {
            FailPoint::DuringTempWrite | FailPoint::AfterTempWritten => {
                assert_eq!(o2.generation, 1, "{fp:?}")
            }
            _ => assert_eq!(o2.generation, 2, "{fp:?}"),
        }
        // 片付いた後は、ふつうに保存できる
        store2.save(&o.id, &body(3), "").unwrap();
    }
}

#[test]
fn a_branch_is_detected_and_both_versions_are_kept() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    // 別の画面（別のプロセス）が同じ世帯を開いて先に保存した
    let other = env.store();
    other.status().unwrap();
    other.open(&o.id).unwrap();
    other.save(&o.id, &body(10), "").unwrap();
    // こちらの保存は分岐として止まり、上書きしない
    assert_eq!(
        store.save(&o.id, &body(20), "").unwrap_err(),
        StoreError::CONFLICT
    );
    let now = env.store();
    now.status().unwrap();
    assert_eq!(
        without_meta(&now.open(&o.id).unwrap().body),
        without_meta(&body(10))
    );
    // こちらの内容は別のファイルとして残っている
    let kept = std::fs::read_dir(env.root.join("conflicts"))
        .unwrap()
        .count();
    assert_eq!(kept, 1);
}

/// 分岐のあいだに保存を何回試しても、こちらの版の写しは1つ（最後に試した中身）。分岐を選ぶとその写しを使う
#[test]
fn retrying_after_a_branch_keeps_one_copy_of_ours() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let other = env.store();
    other.status().unwrap();
    other.open(&o.id).unwrap();
    other.save(&o.id, &body(10), "").unwrap();
    for n in 0..5 {
        assert_eq!(
            store.save(&o.id, &body(20 + n), "").unwrap_err(),
            StoreError::CONFLICT
        );
    }
    let kept = std::fs::read_dir(env.root.join("conflicts"))
        .unwrap()
        .count();
    assert_eq!(kept, 1, "試すたびに写しが増えない");
    // こちらの版を選ぶと、最後に試した中身になる
    let r = store
        .resolve_fork(&o.id, household_store::ForkChoice::Ours)
        .unwrap();
    assert_eq!(without_meta(&r.body), without_meta(&body(24)));
}

#[test]
fn newer_format_versions() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    // MINOR だけが新しい: 閲覧はでき、保存はできない
    store
        .write_raw_for_test(&o.id, "0.99", &body(5), 7)
        .unwrap();
    let r = store.open(&o.id).unwrap();
    assert!(r.read_only);
    assert_eq!(
        store.save(&o.id, &body(6), "").unwrap_err(),
        StoreError::READ_ONLY
    );
    // MAJOR が新しい: 開かない
    store.write_raw_for_test(&o.id, "1.0", &body(5), 8).unwrap();
    assert_eq!(store.open(&o.id).unwrap_err(), StoreError::FORMAT_TOO_NEW);
}

#[test]
fn complete_deletion() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let a = create(&store, 1);
    let b = create(&store, 2);
    // 次の日に保存して、毎日の写し（世帯ファイル・鍵置き場）を作る
    env.clock.advance_days(1);
    let store = env.store();
    store.status().unwrap();
    store.open(&a.id).unwrap();
    store.save(&a.id, &body(3), "").unwrap();
    let outside_copy = std::fs::read(store.household_path_for_test(&a.id)).unwrap();
    // 確認の顧客番号が違うと消さない
    assert_eq!(
        store.delete(&a.id, "WRONG").unwrap_err(),
        StoreError::CONFIRM
    );
    store.delete(&a.id, &a.customer_no).unwrap();
    // 世帯ファイル・直前の世代・アプリが管理する写しが無い
    let p = store.household_path_for_test(&a.id);
    assert!(!p.exists());
    assert!(!household_store::atomic::prev_path(&p).exists());
    let backups = env.root.join("backups");
    let mut dirs: Vec<_> = std::fs::read_dir(&backups)
        .unwrap()
        .map(|d| d.unwrap().path())
        .collect();
    dirs.sort();
    assert_eq!(dirs.len(), 2);
    for d in &dirs {
        assert!(
            !d.join("households").join(format!("{}.lphf", a.id)).exists(),
            "写しも消える"
        );
    }
    assert!(
        dirs[1]
            .join("households")
            .join(format!("{}.lphf", b.id))
            .exists(),
        "他の世帯の写しは残る"
    );
    assert_eq!(
        store.open(&a.id).unwrap_err(),
        StoreError::UNKNOWN_HOUSEHOLD
    );
    assert!(store.list().unwrap().iter().all(|e| e.id != a.id));
    assert!(store.open(&b.id).is_ok(), "他の世帯は開ける");
    let st = store.status().unwrap();
    assert_eq!(st.deletions_pending, 1);
    // 今の鍵置き場と直前の世代には鍵が無い。日ごとの世代（最大30日）にはまだ残る（0013 の5）
    assert!(
        store.any_managed_vault_has_key(&a.id),
        "30日の間は日ごとの世代に残る"
    );
    assert!(store.can_open_bytes_with_managed_keys(&a.id, &outside_copy));
    // 29日後はまだ残り、30日後（削除の日を1日目として31日目）にはどこにも無い
    env.clock.advance_days(29);
    let store = env.store();
    store.status().unwrap();
    assert!(store.any_managed_vault_has_key(&a.id), "29日後");
    env.clock.advance_days(1);
    let store = env.store();
    let st = store.status().unwrap();
    assert!(
        !store.any_managed_vault_has_key(&a.id),
        "30日後には読める鍵がアプリの中に無い"
    );
    assert!(
        !store.can_open_bytes_with_managed_keys(&a.id, &outside_copy),
        "外に残った写しは開かない"
    );
    assert_eq!(st.deletions_pending, 0);
    assert_eq!(st.deletions_completed, 1);
    assert!(store.open(&b.id).is_ok());
}

#[test]
fn daily_backups_keep_thirty_generations() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    for _ in 0..40 {
        env.clock.advance_days(1);
        let s = env.store();
        s.status().unwrap();
        s.open(&o.id).unwrap();
        s.save(&o.id, &body(2), "").unwrap();
    }
    let dirs: Vec<_> = std::fs::read_dir(env.root.join("backups"))
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(dirs.len(), 30);
    let keys = std::fs::read_dir(env.root.join("keys").join("backups"))
        .unwrap()
        .count();
    assert_eq!(keys, 30);
    // 写しは暗号化のまま
    for d in dirs {
        let f = std::fs::read(d.path().join("households").join(format!("{}.lphf", o.id))).unwrap();
        assert_eq!(&f[..4], b"LPHF");
    }
}

#[test]
fn rename_changes_only_the_display_number() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let a = create(&store, 1);
    let b = create(&store, 2);
    assert_ne!(a.customer_no, b.customer_no);
    assert_eq!(
        store.rename(&a.id, "山田").unwrap_err(),
        StoreError::CUSTOMER_NO
    );
    assert_eq!(
        store.rename(&a.id, "../a").unwrap_err(),
        StoreError::CUSTOMER_NO
    );
    let r = store.rename(&a.id, "A0042").unwrap();
    assert!(!r.duplicate);
    let r = store.rename(&b.id, "A0042").unwrap();
    assert!(r.duplicate, "同じ番号は警告だけ（禁止しない）");
    let o = store.open(&a.id).unwrap();
    assert_eq!(o.customer_no, "A0042");
    assert_eq!(o.id, a.id, "内部IDは変わらない");
}

#[test]
fn bad_inputs_are_refused() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    assert_eq!(
        store
            .create(CreateRequest {
                body: "[1]".into(),
                summary: String::new()
            })
            .unwrap_err(),
        StoreError::BODY
    );
    assert_eq!(
        store
            .create(CreateRequest {
                body: "{".into(),
                summary: String::new()
            })
            .unwrap_err(),
        StoreError::BODY
    );
    assert_eq!(
        store.open("../../etc/passwd").unwrap_err(),
        StoreError::UNKNOWN_HOUSEHOLD
    );
    assert_eq!(
        store.open(&crypto::new_uuid()).unwrap_err(),
        StoreError::UNKNOWN_HOUSEHOLD
    );
    let o = create(&store, 1);
    let fresh = env.store();
    fresh.status().unwrap();
    assert_eq!(
        fresh.save(&o.id, &body(2), "").unwrap_err(),
        StoreError::NOT_OPEN,
        "開いていない世帯は保存しない"
    );
}

/// 0016 の1: 画面に返すものに、データフォルダのパスが入らない
#[test]
fn responses_never_contain_paths() {
    let env = Env::new();
    let store = env.store();
    let root = env.root.to_string_lossy().into_owned();
    let mut texts = vec![serde_json::to_string(&store.status().unwrap()).unwrap()];
    let o = create(&store, 1);
    texts.push(serde_json::to_string(&o).unwrap());
    texts.push(serde_json::to_string(&store.list().unwrap()).unwrap());
    texts.push(serde_json::to_string(&store.save(&o.id, &body(2), "").unwrap()).unwrap());
    texts.push(serde_json::to_string(&store.open(&o.id).unwrap()).unwrap());
    texts.push(serde_json::to_string(&store.rename(&o.id, "A1").unwrap()).unwrap());
    texts.push(serde_json::to_string(&store.acknowledge_recovery().unwrap()).unwrap());
    for t in texts {
        assert!(!t.contains(&root), "{t}");
        assert!(
            !t.contains(".lphf") && !t.contains(".lpkv") && !t.contains("households/"),
            "{t}"
        );
    }
}

/// 0011 の4: 変換の段が meta に書いた記録（合算BS の引き継ぎ `extTransfers` など）は、画面が meta を持たない本文で保存しても残る
#[test]
fn migration_records_in_meta_survive_saves() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/household-format/0.56/body.json");
    let b056 = std::fs::read_to_string(fixture).unwrap();
    store.write_raw_for_test(&o.id, "0.56", &b056, 2).unwrap();
    let s2 = env.store();
    s2.status().unwrap();
    let opened: serde_json::Value = serde_json::from_str(&s2.open(&o.id).unwrap().body).unwrap();
    let transfers = opened["meta"]["extTransfers"].clone();
    assert!(transfers.is_array(), "開いたとき: 変換の記録がある");
    // 画面は meta を書かずに本文を返す（app/src/workspace/store/body.ts の bodyObject）
    let screen = without_meta(&opened.to_string()).to_string();
    s2.save(&o.id, &screen, "").unwrap();
    s2.save(&o.id, &screen, "").unwrap();
    let s3 = env.store();
    s3.status().unwrap();
    let again: serde_json::Value = serde_json::from_str(&s3.open(&o.id).unwrap().body).unwrap();
    assert_eq!(
        again["meta"]["extTransfers"], transfers,
        "保存し直しても、変換の記録が残る: {}",
        again["meta"]
    );
    assert_eq!(
        again["meta"]["formatVersion"],
        household_store::migrate::CURRENT
    );
}

/// 0011 の4 の捨てない決まり: このアプリが知らない meta の欄も、保存し直して失わない。画面が meta を渡したときは、その値を使う
#[test]
fn unknown_meta_fields_are_kept_and_the_screen_can_replace_them() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    let mut b: serde_json::Value = serde_json::from_str(&body(1)).unwrap();
    b["meta"] = serde_json::json!({"laterRecord": [{"at": "2026-11-07"}], "savedAt": "古い値"});
    store
        .write_raw_for_test(&o.id, household_store::migrate::CURRENT, &b.to_string(), 2)
        .unwrap();
    let s2 = env.store();
    s2.status().unwrap();
    s2.open(&o.id).unwrap();
    s2.save(&o.id, &body(2), "").unwrap();
    let s3 = env.store();
    s3.status().unwrap();
    let v: serde_json::Value = serde_json::from_str(&s3.open(&o.id).unwrap().body).unwrap();
    assert_eq!(
        v["meta"]["laterRecord"],
        serde_json::json!([{"at": "2026-11-07"}])
    );
    assert_ne!(v["meta"]["savedAt"], "古い値", "本体が書く欄は本体の値");
    let mut with_meta: serde_json::Value = serde_json::from_str(&body(3)).unwrap();
    with_meta["meta"] = serde_json::json!({"laterRecord": "画面の値"});
    s3.save(&o.id, &with_meta.to_string(), "").unwrap();
    s3.save(&o.id, &body(4), "").unwrap();
    let s4 = env.store();
    s4.status().unwrap();
    let v: serde_json::Value = serde_json::from_str(&s4.open(&o.id).unwrap().body).unwrap();
    assert_eq!(v["meta"]["laterRecord"], "画面の値");
}

/// 0011 の7: 今のファイルが壊れていて（空・途中で切れた・ゼロで埋まった）、直前の世代が開けるときは、どの時点の物かを見せて、
/// 直前の世代で開き直せる。壊れたファイルは捨てずに、この PC の中に別名で残す
#[test]
fn a_broken_file_can_be_reopened_from_the_previous_generation() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    store.save(&o.id, &body(2), "").unwrap();
    env.clock.advance_days(1);
    let saved3 = store.save(&o.id, &body(3), "").unwrap();
    let p = store.household_path_for_test(&o.id);
    let good = std::fs::read(&p).unwrap();
    let prev = std::fs::read(household_store::atomic::prev_path(&p)).unwrap();
    // 今のファイルが開けるときは、直前の世代を勧めない
    assert!(store.previous_generation(&o.id).unwrap().is_none());
    assert_eq!(
        store.open_previous(&o.id).unwrap_err(),
        StoreError::NO_PREVIOUS
    );
    let broken: Vec<(&str, Vec<u8>)> = vec![
        ("空", vec![]),
        ("半分で切れた", good[..good.len() / 2].to_vec()),
        ("最後の1バイトが無い", good[..good.len() - 1].to_vec()),
        ("頭の9バイトだけ", good[..9].to_vec()),
        ("ゼロで埋まった", vec![0u8; good.len()]),
    ];
    for (name, bytes) in broken {
        std::fs::write(&p, &bytes).unwrap();
        std::fs::write(household_store::atomic::prev_path(&p), &prev).unwrap();
        let s2 = env.store();
        s2.status().unwrap();
        assert!(s2.open(&o.id).is_err(), "{name}: 開けない");
        let info = s2
            .previous_generation(&o.id)
            .unwrap()
            .unwrap_or_else(|| panic!("{name}: 直前の世代を勧める"));
        assert_eq!(info.generation, 2, "{name}");
        assert!(
            info.saved_at
                .as_deref()
                .is_some_and(|t| t < saved3.saved_at.as_str()),
            "{name}: 直前の保存の日時 {:?}",
            info.saved_at
        );
        let r = s2.open_previous(&o.id).unwrap();
        assert_eq!(r.generation, 2, "{name}");
        assert_eq!(
            without_meta(&r.body)["proposals"][0]["n"],
            2,
            "{name}: 直前の保存の中身"
        );
        assert_eq!(
            std::fs::read(&p).unwrap(),
            prev,
            "{name}: 今のファイルは直前の世代の写し"
        );
        assert_eq!(
            std::fs::read(household_store::atomic::prev_path(&p)).unwrap(),
            prev,
            "{name}: 直前の世代はそのまま残る"
        );
        let kept: Vec<Vec<u8>> = std::fs::read_dir(env.root.join("conflicts"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".broken-"))
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();
        assert!(kept.contains(&bytes), "{name}: 壊れたファイルは別名で残す");
        // 戻した後はふつうに保存できる
        let s = s2.save(&o.id, &body(4), "").unwrap();
        assert_eq!(s.generation, 3, "{name}");
        let s3 = env.store();
        s3.status().unwrap();
        assert_eq!(
            without_meta(&s3.open(&o.id).unwrap().body)["proposals"][0]["n"],
            4,
            "{name}"
        );
        std::fs::write(&p, &good).unwrap();
    }
    // 直前の世代も壊れていれば勧めない
    std::fs::write(&p, b"").unwrap();
    std::fs::write(household_store::atomic::prev_path(&p), b"").unwrap();
    let s4 = env.store();
    s4.status().unwrap();
    assert!(s4.previous_generation(&o.id).unwrap().is_none());
    assert_eq!(
        s4.open_previous(&o.id).unwrap_err(),
        StoreError::NO_PREVIOUS
    );
    // 直前の世代が無ければ勧めない
    std::fs::remove_file(household_store::atomic::prev_path(&p)).unwrap();
    assert!(s4.previous_generation(&o.id).unwrap().is_none());
}

/// 直前の世代の日時と、戻した結果に、データフォルダのパスが入らない（0016 の1）
#[test]
fn previous_generation_responses_never_contain_paths() {
    let env = Env::new();
    let store = env.store();
    store.status().unwrap();
    let o = create(&store, 1);
    store.save(&o.id, &body(2), "").unwrap();
    let p = store.household_path_for_test(&o.id);
    std::fs::write(&p, b"").unwrap();
    let root = env.root.to_string_lossy().into_owned();
    let info = serde_json::to_string(&store.previous_generation(&o.id).unwrap().unwrap()).unwrap();
    let r = serde_json::to_string(&store.open_previous(&o.id).unwrap()).unwrap();
    for t in [info, r] {
        assert!(
            !t.contains(&root) && !t.contains(".lphf") && !t.contains("conflicts"),
            "{t}"
        );
    }
}
