// 見本番号をなくした保存の形・移行・一覧の作り直しの境目の試験（0247 の1・8 と「守るもの」の本体の節）。
// 保管庫はメモリの実装を使う（OS の保管庫に触れない）。前の版のアプリが書いた事務所データ・世帯ファイル・一覧の欄のファイルは、試験用の道具で
// 前の形の JSON を書いて作る
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::{
    crypto, migrate, recovery, Clock, CreateOptions, CreateRequest, MemorySecretStore,
    SampleOrigin, SampleRequest, SecretStore, StatusState, Store, StoreError,
};
use serde_json::{json, Value};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}

struct Env {
    base: PathBuf,
    secrets: Arc<MemorySecretStore>,
    clock: TestClock,
}

impl Env {
    fn new() -> Env {
        Env {
            base: std::env::temp_dir().join(format!("hs-samples-{}", crypto::new_uuid())),
            secrets: Arc::new(MemorySecretStore::default()),
            clock: TestClock(Arc::new(AtomicI64::new(1_792_368_000))),
        }
    }
    fn store(&self, name: &str) -> Store {
        Store::new(
            self.base.join(name),
            self.secrets.clone(),
            self.clock.clone(),
            "0.1.0-test",
        )
    }
    /// 別の PC（保管庫も別）
    fn other_pc(&self, name: &str) -> Store {
        Store::new(
            self.base.join(name),
            Arc::new(MemorySecretStore::default()),
            self.clock.clone(),
            "0.1.0-test",
        )
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

fn body() -> String {
    json!({
        "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"members": [{"id": "m1", "kind": "self"}]}}}},
        "proposals": [{"id": "p1", "title": "B案"}],
        "workspace": {"band": [], "base": "current", "selected": "current"},
        "display": {},
        "extDefinitions": {},
        "ext": {}
    })
    .to_string()
}

fn req() -> CreateRequest {
    CreateRequest {
        body: body(),
        summary: "本人".into(),
    }
}

fn sample(family: u8, age: u8, name: &str) -> SampleRequest {
    SampleRequest {
        family,
        age,
        name: name.into(),
        traits: vec!["会社員".into()],
        origin: None,
    }
}

fn make(store: &Store, r: SampleRequest) -> household_store::Opened {
    store
        .create_with(
            req(),
            CreateOptions {
                sample: Some(r),
                ..Default::default()
            },
        )
        .unwrap()
}

/// 見本の棚の (内部ID → (名前, 家族の形, 年代, 表示の番号))
fn shelf(store: &Store) -> BTreeMap<String, (String, u8, u8, String)> {
    store
        .list_samples()
        .unwrap()
        .into_iter()
        .map(|e| {
            let i = e.label.sample.unwrap();
            (e.id, (i.name, i.family, i.age, e.customer_no))
        })
        .collect()
}

fn customer_ids(store: &Store) -> Vec<String> {
    let mut v: Vec<String> = store.list().unwrap().into_iter().map(|e| e.id).collect();
    v.sort();
    v
}

/// 事務所データの一覧の見本の行を、前の版（0.2 まで）の形に戻す: 家族の形・年代の代わりに見本番号 `no`、表示の番号も見本番号
fn to_legacy_entry(entry: &mut Value, no: &str) {
    let s = entry["sample"].as_object_mut().unwrap();
    s.remove("family");
    s.remove("age");
    s.insert("no".into(), no.into());
    entry["customerNo"] = no.into();
}

/// 世帯ファイルのバイト列（指紋を比べる）
fn file_digest(store: &Store, id: &str) -> String {
    crypto::digest(&std::fs::read(store.household_path_for_test(id)).unwrap())
}

/// (a)(b)(h): 番号つきの事務所データを開くと1回だけ移行する。家族の形・年代を番号から読み、表示の番号を空にし、名前の重なりに
/// 「（2）」を付ける。直した名前は最初の状態の答えにだけ出る。2回目は何も変わらない。世帯ファイルには触れない。
/// 顧客の世帯は見本にならない（前の見本番号の形の自由な顧客番号も）
#[test]
fn numbered_office_data_is_migrated_once() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let a = make(&s, sample(3, 4, "研修用"));
    let b = make(&s, sample(1, 2, "単身の研修"));
    let c = make(&s, sample(2, 6, "研修用・別"));
    let customer = s.create(req()).unwrap();
    s.rename(&customer.id, "3-4-11").unwrap();
    let digests: Vec<String> = [&a.id, &b.id, &c.id, &customer.id]
        .iter()
        .map(|id| file_digest(&s, id))
        .collect();
    // 前の版の事務所データ: 見本番号つき。c は a と同じ名前（前の版では名前の重なりを止めていなかった）
    let mut office = s.office_json_for_test().unwrap();
    let hh = office["households"].as_object_mut().unwrap();
    to_legacy_entry(&mut hh[&a.id], "3-4-10");
    to_legacy_entry(&mut hh[&b.id], "1-2-10");
    to_legacy_entry(&mut hh[&c.id], "2-6-10");
    hh[&c.id]["sample"]["name"] = "研修用".into();
    s.write_office_json_for_test(&office, "0.2").unwrap();
    // 開き直す（更新した後のアプリで初めて開いた）
    let s = env.store("pc");
    let st = s.status().unwrap();
    assert_eq!(st.state, StatusState::Ready);
    assert!(!st.office_too_new);
    // 重なった名前は内部ID の順で2つ目に「（2）」
    let (first, second) = if a.id < c.id { (&a, &c) } else { (&c, &a) };
    assert_eq!(st.sample_renames.len(), 1);
    assert_eq!(st.sample_renames[0].from, "研修用");
    assert_eq!(st.sample_renames[0].to, "研修用（2）");
    let got = shelf(&s);
    assert_eq!(got[&first.id].0, "研修用");
    assert_eq!(got[&second.id].0, "研修用（2）");
    assert_eq!((got[&a.id].1, got[&a.id].2), (3, 4));
    assert_eq!((got[&b.id].1, got[&b.id].2), (1, 2));
    assert_eq!((got[&c.id].1, got[&c.id].2), (2, 6));
    assert!(got.values().all(|v| v.3.is_empty()), "表示の番号は空");
    // 顧客の世帯は顧客のまま（前の見本番号の形の自由な番号でも）
    assert_eq!(customer_ids(&s), std::slice::from_ref(&customer.id));
    assert_eq!(s.list().unwrap()[0].customer_no, "3-4-11");
    // 事務所データは新しい形で書いた（番号が無い・版が 0.3）
    let office = s.office_json_for_test().unwrap();
    for id in [&a.id, &b.id, &c.id] {
        let e = &office["households"][id];
        assert!(e["sample"].get("no").is_none(), "番号を書かない");
        assert_eq!(e["customerNo"], "");
        assert!(e["sample"]["family"].is_u64());
    }
    // 2回目: 何も変わらない・知らせは出ない
    let s2 = env.store("pc");
    let st2 = s2.status().unwrap();
    assert!(st2.sample_renames.is_empty());
    assert_eq!(shelf(&s2), got);
    assert_eq!(s2.office_json_for_test().unwrap(), office);
    // 直した名前は、この起動の間はお知らせ（参考）に出る（状態を何度読んでも消えない）。次の起動では出ない
    assert_eq!(s.status().unwrap().sample_renames.len(), 1);
    let n = s.storage_notices().unwrap();
    let r = n
        .iter()
        .find(|x| x.kind == "sampleRenames")
        .expect("名前を直した知らせ");
    assert_eq!(r.level, "info");
    assert_eq!(r.count, Some(1));
    assert_eq!(r.name.as_deref(), Some("「研修用」→「研修用（2）」"));
    assert!(s2
        .storage_notices()
        .unwrap()
        .iter()
        .all(|x| x.kind != "sampleRenames"));
    // 移行の前の事務所データは、別名で残っている（番号つきの前の形・版 0.2）
    let (before, version) = s2
        .office_before_migration_for_test()
        .unwrap()
        .expect("移行の前の写し");
    assert_eq!(version, "0.2");
    assert_eq!(before["households"][&a.id]["sample"]["no"], "3-4-10");
    // 世帯ファイルには触れていない
    let after: Vec<String> = [&a.id, &b.id, &c.id, &customer.id]
        .iter()
        .map(|id| file_digest(&s2, id))
        .collect();
    assert_eq!(after, digests);
    // 直した名前で完全削除の確かめができる
    assert_eq!(
        s2.delete(&second.id, "研修用").err(),
        Some(StoreError::CONFIRM)
    );
    s2.delete(&second.id, "研修用（2）").unwrap();
}

/// (h): このアプリより新しい版の事務所データは、移行しても書かない（読んで使うだけ）
#[test]
fn newer_office_data_is_not_written_by_the_migration() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let a = make(&s, sample(3, 4, "研修用"));
    let mut office = s.office_json_for_test().unwrap();
    to_legacy_entry(&mut office["households"][&a.id], "3-4-10");
    s.write_office_json_for_test(&office, "0.9").unwrap();
    let path = env.base.join("pc").join("office.lpod");
    let before = std::fs::read(&path).unwrap();
    let s = env.store("pc");
    let st = s.status().unwrap();
    assert!(st.office_too_new);
    let got = shelf(&s);
    assert_eq!(got[&a.id], ("研修用".to_owned(), 3, 4, String::new()));
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "事務所データは変わらない"
    );
}

/// (c)(d)(e): 事務所データが古い世代に戻って一覧を世帯ファイルから作り直すとき、見本は meta.sample から名前・項目・家族の形・年代・
/// 出どころごと戻る。0.87 の顧客の世帯は、前の見本番号の形の顧客番号でも顧客のまま。0.86 の番号つきの見本のファイルは見本として戻り、
/// 重なった仮の名前に「（2）」が付く
#[test]
fn the_catalog_is_rebuilt_from_household_files_without_swapping_samples_and_customers() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let own = make(&s, sample(3, 4, "研修用"));
    s.update_sample(&own.id, "研修用・直した", &["賃貸".into()], 2, 5, &[])
        .unwrap();
    let edited = s
        .create_with(
            req(),
            CreateOptions {
                sample: Some(SampleRequest {
                    origin: Some(SampleOrigin {
                        set: "official.basic".into(),
                        id: "sampleSeniorRental".into(),
                        rev: 1,
                    }),
                    ..sample(3, 6, "退職前後の夫婦・60代")
                }),
                ..Default::default()
            },
        )
        .unwrap();
    // 顧客の世帯: 自由な番号 3-4-10（保存して世帯ファイルの meta にも書く）
    let customer = s.create(req()).unwrap();
    s.rename(&customer.id, "3-4-10").unwrap();
    let o = s.open(&customer.id).unwrap();
    s.save(&customer.id, &o.body, "本人").unwrap();
    // 見本に登録した世帯（登録の後に保存していない）
    let registered = s.create(req()).unwrap();
    s.make_sample(&registered.id, &sample(1, 3, "登録した見本"), &[])
        .unwrap();
    // 0.86 の番号つきの見本のファイル2つ（前の版のアプリが保存したまま）
    let old1 = s.create(req()).unwrap();
    let old2 = s.create(req()).unwrap();
    for (id, no) in [(&old1.id, "3-4-10"), (&old2.id, "3-4-11")] {
        let mut b: Value = serde_json::from_str(&body()).unwrap();
        b["meta"] = json!({"format": "lifeplan.household", "formatVersion": "0.86", "customerNo": no, "savedAt": "2026-10-01T00:00:00Z"});
        s.write_raw_for_test(id, "0.86", &b.to_string(), 5).unwrap();
    }
    // 事務所データが古い世代に戻った: 一覧に何も無い
    let mut office = s.office_json_for_test().unwrap();
    office["households"] = json!({});
    s.write_office_json_for_test(&office, household_store::OFFICE_FORMAT_VERSION)
        .unwrap();
    let s = env.store("pc");
    s.status().unwrap();
    assert_eq!(
        customer_ids(&s),
        std::slice::from_ref(&customer.id),
        "顧客は顧客だけ"
    );
    assert_eq!(s.list().unwrap()[0].customer_no, "3-4-10");
    let got = shelf(&s);
    assert_eq!(got.len(), 5);
    assert_eq!(
        got[&own.id],
        ("研修用・直した".to_owned(), 2, 5, String::new())
    );
    assert_eq!(got[&registered.id].0, "登録した見本");
    assert_eq!(got[&edited.id].0, "退職前後の夫婦・60代");
    let names: Vec<&str> = [&old1.id, &old2.id]
        .iter()
        .map(|id| got[*id].0.as_str())
        .collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        ["見本（夫婦と子・40代）", "見本（夫婦と子・40代）（2）"]
    );
    let listed = s.list_samples().unwrap();
    let e = listed.iter().find(|e| e.id == own.id).unwrap();
    assert_eq!(e.label.sample.as_ref().unwrap().traits, ["賃貸"]);
    let o = listed.iter().find(|e| e.id == edited.id).unwrap();
    let origin = o.label.sample.as_ref().unwrap().origin.as_ref().unwrap();
    assert_eq!(
        (origin.set.as_str(), origin.id.as_str(), origin.rev),
        ("official.basic", "sampleSeniorRental", 1)
    );
    assert!(o.label.sample.as_ref().unwrap().changed);
    // 作り直した一覧は書いた（もう一度開いても同じ）
    let again = env.store("pc");
    again.status().unwrap();
    assert_eq!(shelf(&again), got);
    assert_eq!(customer_ids(&again), std::slice::from_ref(&customer.id));
}

/// 世帯ファイルの meta: 見本は meta.sample を持ち meta.customerNo を持たない。顧客の世帯は meta.customerNo を持ち meta.sample を持たない。
/// 開いた答えの本文も同じ。画面が meta に書いた値は使わない
#[test]
fn household_files_carry_the_sample_in_meta() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let x = make(&s, sample(3, 4, "研修用"));
    let meta = s.raw_body_for_test(&x.id).unwrap()["meta"].clone();
    assert!(meta.get("customerNo").is_none());
    assert_eq!(
        meta["sample"],
        json!({"name": "研修用", "traits": ["会社員"], "family": 3, "age": 4})
    );
    let o = s.open(&x.id).unwrap();
    let opened: Value = serde_json::from_str(&o.body).unwrap();
    assert!(opened["meta"].get("customerNo").is_none());
    assert_eq!(opened["meta"]["sample"]["name"], "研修用");
    // 画面が meta に顧客番号を書いても、見本では書かない
    let mut b = opened.clone();
    b["meta"]["customerNo"] = "C0001".into();
    s.save(&x.id, &b.to_string(), "本人").unwrap();
    let meta = s.raw_body_for_test(&x.id).unwrap()["meta"].clone();
    assert!(meta.get("customerNo").is_none());
    // 顧客の世帯は顧客番号を書き、画面が meta.sample を書いても書かない
    let c = s.create(req()).unwrap();
    let o = s.open(&c.id).unwrap();
    let mut b: Value = serde_json::from_str(&o.body).unwrap();
    b["meta"]["sample"] = json!({"name": "x", "family": 3, "age": 4});
    s.save(&c.id, &b.to_string(), "本人").unwrap();
    let meta = s.raw_body_for_test(&c.id).unwrap()["meta"].clone();
    assert!(meta.get("sample").is_none());
    assert_eq!(meta["customerNo"], c.customer_no);
    // 見本に登録すると、保存しなくても世帯ファイルの meta が見本になる。開いたままの世帯は、次の保存も分岐にならない
    let r = s.create(req()).unwrap();
    s.make_sample(&r.id, &sample(1, 3, "登録"), &[]).unwrap();
    let meta = s.raw_body_for_test(&r.id).unwrap()["meta"].clone();
    assert!(meta.get("customerNo").is_none());
    assert_eq!(meta["sample"]["name"], "登録");
    s.save(&r.id, &body(), "本人").unwrap();
    // 名前を直しても meta が追いつく
    s.update_sample(&r.id, "登録・直した", &[], 1, 4, &[])
        .unwrap();
    let meta = s.raw_body_for_test(&r.id).unwrap()["meta"].clone();
    assert_eq!(meta["sample"]["name"], "登録・直した");
    assert_eq!(meta["sample"]["age"], 4);
    s.save(&r.id, &body(), "本人").unwrap();
    assert_eq!(
        s.raw_body_for_test(&r.id).unwrap()["meta"]["formatVersion"],
        migrate::CURRENT
    );
}

/// (g): 本体が持つ区画 sampleInitial は、画面に渡さず、画面が渡さなくても・違う物を渡しても、保存で開いたファイルの物が残る
#[test]
fn sample_initial_is_carried_by_the_store() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let x = make(&s, sample(3, 4, "研修用"));
    let initial = json!({
        "at": "2026-12-01T10:00:00+09:00", "appVersion": "0.9.0", "formatVersion": "0.87",
        "sections": {"household": {"memo": ["最初の中身"]}, "proposals": []}
    });
    // 画面から届いた区画は作るときも使わない
    let mut b: Value = serde_json::from_str(&body()).unwrap();
    b["sampleInitial"] = json!({"sections": {"forged": true}});
    let y = s
        .create_with(
            CreateRequest {
                body: b.to_string(),
                summary: "本人".into(),
            },
            CreateOptions {
                sample: Some(sample(3, 4, "別の見本")),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(s
        .raw_body_for_test(&y.id)
        .unwrap()
        .get("sampleInitial")
        .is_none());
    assert!(serde_json::from_str::<Value>(&y.body)
        .unwrap()
        .get("sampleInitial")
        .is_none());
    // 区画を持つファイル（最初の状態を書く版のアプリが保存した物の代わり）
    let mut raw = s.raw_body_for_test(&x.id).unwrap();
    raw["sampleInitial"] = initial.clone();
    s.write_raw_for_test(&x.id, migrate::CURRENT, &raw.to_string(), 2)
        .unwrap();
    let o = s.open(&x.id).unwrap();
    let opened: Value = serde_json::from_str(&o.body).unwrap();
    assert!(opened.get("sampleInitial").is_none(), "画面に渡さない");
    // 画面は区画を知らずに保存する（2回）・違う物を渡す
    s.save(&x.id, &o.body, "本人").unwrap();
    s.save(&x.id, &body(), "本人").unwrap();
    assert_eq!(
        s.raw_body_for_test(&x.id).unwrap()["sampleInitial"],
        initial
    );
    let mut forged: Value = serde_json::from_str(&body()).unwrap();
    forged["sampleInitial"] = json!({"sections": {"forged": true}});
    s.save(&x.id, &forged.to_string(), "本人").unwrap();
    assert_eq!(
        s.raw_body_for_test(&x.id).unwrap()["sampleInitial"],
        initial
    );
    // 開き直しても残る
    let s = env.store("pc");
    s.status().unwrap();
    let o = s.open(&x.id).unwrap();
    s.save(&x.id, &o.body, "本人").unwrap();
    assert_eq!(
        s.raw_body_for_test(&x.id).unwrap()["sampleInitial"],
        initial
    );
}

/// セットの見本を直した版（出どころあり）: 元の見本と同じ名前で作れる（使えない名前の一覧にあっても）。同じ出どころは2つ作れない。
/// 名前・家族の形を直せない。見本に登録では付けられない
#[test]
fn edited_set_samples_have_an_origin() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let reserved = vec!["退職前後の夫婦・60代".to_owned()];
    let with_origin = |id: &str| SampleRequest {
        origin: Some(SampleOrigin {
            set: "official.basic".into(),
            id: id.into(),
            rev: 1,
        }),
        ..sample(3, 6, "退職前後の夫婦・60代")
    };
    let create = |r: SampleRequest| {
        s.create_with(
            req(),
            CreateOptions {
                sample: Some(r),
                reserved_names: reserved.clone(),
                ..Default::default()
            },
        )
    };
    let e = create(with_origin("sampleSeniorRental")).unwrap();
    assert!(e.label.sample.as_ref().unwrap().changed);
    assert_eq!(
        create(with_origin("sampleSeniorRental")).err(),
        Some(StoreError::SAMPLE_EXISTS)
    );
    // 出どころの無い見本は、使えない名前と重なれば作れない
    assert_eq!(
        create(sample(3, 6, "退職前後の夫婦・60代")).err(),
        Some(StoreError::SAMPLE_NAME)
    );
    assert_eq!(
        s.update_sample(&e.id, "別の名前", &[], 3, 6, &[]).err(),
        Some(StoreError::SAMPLE)
    );
    let c = s.create(req()).unwrap();
    assert_eq!(
        s.make_sample(&c.id, &with_origin("sampleOther"), &[]).err(),
        Some(StoreError::SAMPLE)
    );
    // 完全削除の確かめは名前
    s.delete(&e.id, "退職前後の夫婦・60代").unwrap();
    create(with_origin("sampleSeniorRental")).unwrap();
}

/// (i): 復元キーで復元した後も、見本は見本（事務所データの一覧から）
#[test]
fn samples_stay_samples_after_recovery() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let x = make(&s, sample(4, 3, "ひとり親の研修"));
    let c = s.create(req()).unwrap();
    let key = s.recovery_key().unwrap().to_string();
    let office: Value =
        serde_json::from_slice(&std::fs::read(env.base.join("pc").join("office.json")).unwrap())
            .unwrap();
    env.secrets
        .delete(office["officeId"].as_str().unwrap())
        .unwrap();
    let s2 = env.store("pc");
    assert_eq!(s2.status().unwrap().state, StatusState::NeedsRecovery);
    assert_eq!(
        s2.restore_with_recovery_key(&key).unwrap().state,
        StatusState::Ready
    );
    assert_eq!(
        shelf(&s2)[&x.id],
        ("ひとり親の研修".to_owned(), 4, 3, String::new())
    );
    assert_eq!(customer_ids(&s2), std::slice::from_ref(&c.id));
    let _ = recovery::DISPLAY_LEN;
    // 事務所データも無くして復元キーで戻すと、一覧は世帯ファイルから作り直され、見本は見本のまま
    let office_id = office["officeId"].as_str().unwrap().to_owned();
    env.secrets.delete(&office_id).unwrap();
    std::fs::remove_file(env.base.join("pc").join("office.lpod")).unwrap();
    let _ = std::fs::remove_file(env.base.join("pc").join("office.lpod.prev"));
    let s3 = env.store("pc");
    assert_eq!(s3.status().unwrap().state, StatusState::NeedsRecovery);
    s3.restore_with_recovery_key(&key).unwrap();
    let s3 = env.store("pc");
    s3.status().unwrap();
    assert_eq!(shelf(&s3)[&x.id].0, "ひとり親の研修");
    assert_eq!(customer_ids(&s3), std::slice::from_ref(&c.id));
}

/// (f): 共有フォルダの前の形（0.1）の見本の一覧の欄のファイルは、読むときにメモリの中で新しい形に直す（どの PC でも同じ名前）。開いただけでは一覧の欄のファイルを
/// 書き換えず、保存・名前を直すで一覧の欄のファイルを書き直すと新しい形になる。一覧の欄のファイルが無い世帯は世帯ファイルの meta から戻す
#[test]
fn old_sample_cards_in_the_shared_folder() {
    let env = Env::new();
    let folder = env.base.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = env.other_pc("a");
    let b = env.other_pc("b");
    a.status().unwrap();
    a.office_start(&folder, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&folder, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let rq = a.office_status().unwrap().requests;
    a.office_approve(&rq[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    let kept = make(&a, sample(3, 4, "研修用"));
    let old1 = make(&a, sample(2, 6, "古い見本1"));
    let old2 = make(&a, sample(1, 2, "古い見本2"));
    let customer = a.create(req()).unwrap();
    // 前の版のアプリが書いた一覧の欄のファイル: 見本番号つき。old1 は新しい形の見本と同じ名前
    for (id, no, name) in [
        (&old1.id, "2-6-10", "研修用"),
        (&old2.id, "1-2-10", "古い見本2"),
    ] {
        let mut c = a.card_json_for_test(id).unwrap();
        let sm = c["sample"].as_object_mut().unwrap();
        sm.remove("family");
        sm.remove("age");
        sm.insert("no".into(), no.into());
        sm.insert("name".into(), name.into());
        c["customerNo"] = no.into();
        a.write_card_json_for_test(id, &c).unwrap();
    }
    let raw_before = a.card_json_for_test(&old1.id).unwrap();
    for pc in [&a, &b] {
        let got = shelf(pc);
        assert_eq!(got[&kept.id].0, "研修用");
        assert_eq!(
            got[&old1.id],
            ("研修用（2）".to_owned(), 2, 6, String::new())
        );
        assert_eq!(got[&old2.id], ("古い見本2".to_owned(), 1, 2, String::new()));
        assert_eq!(customer_ids(pc), std::slice::from_ref(&customer.id));
        // 開いても見本のまま（顧客番号を書かない）
        let o = pc.open(&old1.id).unwrap();
        assert_eq!(o.customer_no, "");
        assert_eq!(o.label.sample.as_ref().unwrap().name, "研修用（2）");
    }
    assert_eq!(
        a.card_json_for_test(&old1.id).unwrap(),
        raw_before,
        "読んだだけでは一覧の欄のファイルを書き換えない"
    );
    // 完全削除の確かめは直した名前
    assert_eq!(
        b.delete(&old1.id, "研修用").err(),
        Some(StoreError::CONFIRM)
    );
    // 保存すると一覧の欄のファイルが新しい形になる（名前は直した名前のまま）
    let o = b.open(&old1.id).unwrap();
    b.save(&old1.id, &o.body, "本人").unwrap();
    let card = a.card_json_for_test(&old1.id).unwrap();
    assert!(card["sample"].get("no").is_none());
    assert_eq!(card["customerNo"], "");
    assert_eq!(card["sample"]["name"], "研修用（2）");
    assert_eq!(card["sample"]["family"], 2);
    assert_eq!(shelf(&a)[&old1.id].0, "研修用（2）");
    // 名前を直しても新しい形
    a.update_sample(&old2.id, "古い見本2・直した", &[], 1, 3, &[])
        .unwrap();
    let card = b.card_json_for_test(&old2.id).unwrap();
    assert!(card["sample"].get("no").is_none());
    assert_eq!(
        shelf(&b)[&old2.id],
        ("古い見本2・直した".to_owned(), 1, 3, String::new())
    );
}

/// 共有フォルダから PC の中へ戻すとき（共有をやめる）も、見本は見本の中身ごと戻る
#[test]
fn samples_come_back_from_the_shared_folder() {
    let env = Env::new();
    let folder = env.base.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = env.other_pc("a");
    a.status().unwrap();
    a.acknowledge_recovery().unwrap();
    // 前から PC の中にある見本も同期フォルダへ移る
    let before = make(&a, sample(2, 3, "前からの見本"));
    let st = a.sync_start(&folder, "事務所のPC", true, &[]).unwrap();
    assert_eq!(st.state, "member");
    let x = make(&a, sample(5, 7, "シニアの研修"));
    let c = a.create(req()).unwrap();
    assert_eq!(shelf(&a).len(), 2);
    let st = a.sync_end("事務所のPC").unwrap();
    assert_eq!(st.state, "off");
    let got = shelf(&a);
    assert_eq!(got[&before.id].0, "前からの見本");
    assert_eq!(got[&x.id], ("シニアの研修".to_owned(), 5, 7, String::new()));
    assert_eq!(customer_ids(&a), std::slice::from_ref(&c.id));
}

/// 事務所の共有で2台（A が始め、B が加わる）
fn office_pair(env: &Env) -> (Store, Store) {
    let folder = env.base.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = env.other_pc("a");
    let b = env.other_pc("b");
    a.status().unwrap();
    a.office_start(&folder, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&folder, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let rq = a.office_status().unwrap().requests;
    a.office_approve(&rq[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    (a, b)
}

/// 点検の1: 移行の後に世帯を開いて事務所データを何度か書いても、移行の前の形の事務所データが別名で残る（前の版へ戻せる）。
/// 写しは1回だけ書き、後から書き換えない
#[test]
fn the_office_data_before_the_migration_is_kept() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let a = make(&s, sample(3, 4, "研修用"));
    let c = s.create(req()).unwrap();
    let mut office = s.office_json_for_test().unwrap();
    to_legacy_entry(&mut office["households"][&a.id], "3-4-10");
    s.write_office_json_for_test(&office, "0.2").unwrap();
    let path = env
        .base
        .join("pc")
        .join(household_store::OFFICE_BEFORE_SAMPLE_MIGRATION);
    assert!(!path.exists());
    let s = env.store("pc");
    s.status().unwrap();
    let kept = std::fs::read(&path).expect("移行の前の写し");
    // 世帯を開く（最後に開いた世帯を書く）・保存する・見本を作る: どれも事務所データを書くが、写しは変わらない
    s.open(&c.id).unwrap();
    s.save(&c.id, &body(), "本人").unwrap();
    s.open(&a.id).unwrap();
    make(&s, sample(1, 2, "新しい見本"));
    let s = env.store("pc");
    s.status().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), kept, "写しは書き換えない");
    let (before, version) = s.office_before_migration_for_test().unwrap().unwrap();
    assert_eq!(version, "0.2");
    assert_eq!(before["households"][&a.id]["customerNo"], "3-4-10");
    // 移行の無い事務所データでは写しを作らない
    let other = env.store("pc2");
    other.status().unwrap();
    make(&other, sample(1, 2, "x"));
    let other = env.store("pc2");
    other.status().unwrap();
    assert!(other.office_before_migration_for_test().unwrap().is_none());
}

/// 点検の4: 見本に登録・名前を直すの途中で世帯ファイルを書けなかったら、何も変わらない（一覧も世帯ファイルも前のまま）
#[test]
fn a_failed_registration_or_rename_changes_nothing() {
    use household_store::atomic::FailPoint;
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let c = s.create(req()).unwrap();
    s.set_fail_point(FailPoint::AfterTempWritten);
    assert!(s.make_sample(&c.id, &sample(1, 3, "登録"), &[]).is_err());
    s.set_fail_point(FailPoint::None);
    assert_eq!(customer_ids(&s), std::slice::from_ref(&c.id), "顧客のまま");
    assert!(s.list_samples().unwrap().is_empty());
    let meta = s.raw_body_for_test(&c.id).unwrap()["meta"].clone();
    assert!(meta.get("sample").is_none());
    assert_eq!(meta["customerNo"], c.customer_no);
    // もう一度登録できる。開いたままの保存も分岐にならない
    s.make_sample(&c.id, &sample(1, 3, "登録"), &[]).unwrap();
    s.save(&c.id, &body(), "本人").unwrap();
    assert_eq!(
        s.raw_body_for_test(&c.id).unwrap()["meta"]["sample"]["name"],
        "登録"
    );
    // 名前を直すの途中の失敗
    let x = make(&s, sample(3, 4, "直す前"));
    s.set_fail_point(FailPoint::AfterTempWritten);
    assert!(s.update_sample(&x.id, "直した後", &[], 2, 5, &[]).is_err());
    s.set_fail_point(FailPoint::None);
    assert_eq!(shelf(&s)[&x.id], ("直す前".to_owned(), 3, 4, String::new()));
    assert_eq!(
        s.raw_body_for_test(&x.id).unwrap()["meta"]["sample"]["name"],
        "直す前"
    );
}

/// 点検の5: 事務所の共有で、ほかのメンバーが開いている世帯を見本に登録・名前を直しても、相手の次の保存が分岐にならない
/// （世帯ファイルの meta は相手の次の保存で追いつく。共有では一覧の欄のファイルが正）
#[test]
fn renaming_a_sample_another_member_has_open_does_not_fork_their_save() {
    let env = Env::new();
    let (a, b) = office_pair(&env);
    let x = make(&a, sample(3, 4, "共有の見本"));
    let o = b.open(&x.id).unwrap();
    a.update_sample(&x.id, "共有の見本・直した", &[], 3, 4, &[])
        .unwrap();
    b.save(&x.id, &o.body, "本人").unwrap();
    assert_eq!(shelf(&a)[&x.id].0, "共有の見本・直した");
    assert_eq!(
        a.raw_body_for_test(&x.id).unwrap()["meta"]["sample"]["name"],
        "共有の見本・直した",
        "相手の保存で追いつく"
    );
    let c = a.create(req()).unwrap();
    let o = b.open(&c.id).unwrap();
    a.make_sample(&c.id, &sample(1, 3, "登録"), &[]).unwrap();
    b.save(&c.id, &o.body, "本人").unwrap();
    assert_eq!(
        a.raw_body_for_test(&c.id).unwrap()["meta"]["sample"]["name"],
        "登録"
    );
    // 誰も開いていなければ、その場で世帯ファイルも書き直す
    b.leave_all();
    a.update_sample(&c.id, "登録・直した", &[], 1, 3, &[])
        .unwrap();
    assert_eq!(
        a.raw_body_for_test(&c.id).unwrap()["meta"]["sample"]["name"],
        "登録・直した"
    );
}

/// 点検の7: PC の中の見本を、同じ名前の見本がある共有フォルダへ移すと、移す見本の名前の後ろに「（2）」が付く（同じ名前が2件並ばない）。
/// 見えない文字の入った名前は作れない
#[test]
fn moving_samples_into_the_shared_folder_keeps_names_unique() {
    let env = Env::new();
    let folder = env.base.join("同期フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = env.other_pc("a");
    a.status().unwrap();
    a.acknowledge_recovery().unwrap();
    a.sync_start(&folder, "PC1", true, &[]).unwrap();
    make(&a, sample(3, 4, "同じ名前"));
    let key = a.recovery_key().unwrap().to_string();
    let b = env.other_pc("b");
    b.status().unwrap();
    b.acknowledge_recovery().unwrap();
    let y = make(&b, sample(2, 5, "同じ名前"));
    b.sync_open(&folder, "PC2", &key, true, &[]).unwrap();
    b.office_move_local().unwrap();
    let names: Vec<String> = shelf(&b).into_values().map(|v| v.0).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, ["同じ名前", "同じ名前（2）"]);
    assert_eq!(shelf(&b)[&y.id].0, "同じ名前（2）");
    b.update_sample(&y.id, "同じ名前（2）", &["賃貸".into()], 2, 5, &[])
        .unwrap();
    for bad in ["研修\u{200b}用", "\u{feff}研修", "研修\u{202e}用"] {
        assert_eq!(
            b.create_with(
                req(),
                CreateOptions {
                    sample: Some(sample(1, 2, bad)),
                    ..Default::default()
                }
            )
            .err(),
            Some(StoreError::SAMPLE),
            "{bad:?}"
        );
    }
}

/// 点検の8・9: 前の形の一覧の欄のファイルが、鍵の入れ替え（メンバーを外す）で書き直されるときも、表示の番号を空にした新しい形で書く。
/// 同じ名前の前の形の一覧の欄のファイル2枚は、保存の順番を入れ替えても名前が重ならない
#[test]
fn old_sample_cards_are_rewritten_whole_and_keep_distinct_names() {
    let env = Env::new();
    let (a, b) = office_pair(&env);
    let x = make(&a, sample(2, 6, "古い見本・一つ目"));
    let y = make(&a, sample(2, 6, "古い見本・二つ目"));
    for (id, no) in [(&x.id, "2-6-10"), (&y.id, "2-6-11")] {
        let mut c = a.card_json_for_test(id).unwrap();
        let sm = c["sample"].as_object_mut().unwrap();
        sm.remove("family");
        sm.remove("age");
        sm.insert("no".into(), no.into());
        sm.insert("name".into(), "古い見本".into());
        c["customerNo"] = no.into();
        a.write_card_json_for_test(id, &c).unwrap();
    }
    let (first, second) = if x.id < y.id { (&x, &y) } else { (&y, &x) };
    assert_eq!(shelf(&b)[&first.id].0, "古い見本");
    assert_eq!(shelf(&b)[&second.id].0, "古い見本（2）");
    // 前の形の一覧の欄のファイルが残っている間は、お知らせ（参考）に出る
    assert!(b
        .storage_notices()
        .unwrap()
        .iter()
        .any(|n| n.kind == "sampleRenames"));
    // 2つ目から先に保存し、次に1つ目を保存しても、名前は重ならない
    let o = b.open(&second.id).unwrap();
    b.save(&second.id, &o.body, "本人").unwrap();
    let o = b.open(&first.id).unwrap();
    b.save(&first.id, &o.body, "本人").unwrap();
    let names: Vec<String> = shelf(&a).into_values().map(|v| v.0).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, ["古い見本", "古い見本（2）"]);
    assert!(
        a.storage_notices()
            .unwrap()
            .iter()
            .all(|n| n.kind != "sampleRenames"),
        "書き直した後は出ない"
    );
    // 鍵の入れ替え（B を外す）で一覧の欄のファイルがすべて新しい形で書き直される
    let z = make(&a, sample(1, 2, "三つ目"));
    let mut c = a.card_json_for_test(&z.id).unwrap();
    let sm = c["sample"].as_object_mut().unwrap();
    sm.remove("family");
    sm.remove("age");
    sm.insert("no".into(), "1-2-10".into());
    c["customerNo"] = "1-2-10".into();
    a.write_card_json_for_test(&z.id, &c).unwrap();
    let member_b = a
        .office_status()
        .unwrap()
        .members
        .into_iter()
        .find(|m| m.name == "担当B")
        .unwrap();
    a.office_remove(&member_b.member_id, "担当B").unwrap();
    let card = a.card_json_for_test(&z.id).unwrap();
    assert_eq!(card["customerNo"], "");
    assert!(card["sample"].get("no").is_none());
    assert_eq!(card["sample"]["family"], 1);
}

/// 点検の9: 一覧は顧客なのに世帯ファイルが見本の中身（meta.sample）を持つとき（事務所データが見本に登録する前の世代に戻った）は、
/// 開いたときに見本に倒し、一覧も直す。次の保存でも meta.sample が消えない
#[test]
fn a_household_file_with_meta_sample_opens_as_a_sample() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let c = s.create(req()).unwrap();
    let before = s.office_json_for_test().unwrap();
    s.make_sample(&c.id, &sample(1, 3, "登録した見本"), &[])
        .unwrap();
    s.write_office_json_for_test(&before, household_store::OFFICE_FORMAT_VERSION)
        .unwrap();
    let s = env.store("pc");
    s.status().unwrap();
    assert_eq!(
        customer_ids(&s),
        std::slice::from_ref(&c.id),
        "開く前は一覧のまま"
    );
    let o = s.open(&c.id).unwrap();
    assert_eq!(o.customer_no, "");
    assert_eq!(o.label.sample.as_ref().unwrap().name, "登録した見本");
    assert!(customer_ids(&s).is_empty());
    assert_eq!(shelf(&s)[&c.id].0, "登録した見本");
    s.save(&c.id, &o.body, "本人").unwrap();
    let meta = s.raw_body_for_test(&c.id).unwrap()["meta"].clone();
    assert_eq!(meta["sample"]["name"], "登録した見本");
    assert!(meta.get("customerNo").is_none());
}

/// 点検の3（(a) の直し方）: 前の版で「見本に登録」した見本（世帯ファイルの meta.customerNo は登録前の顧客番号のまま）と、前の見本番号の形の
/// 顧客番号を持つ顧客（0.86）は、新しい版で初めて開いたとき（一覧が正しいと分かっている時）に世帯ファイルの meta を書き直す。
/// その後に事務所データが無くなって一覧を作り直しても、見本は見本・顧客は顧客のまま。0.87 からのファイルには触れない
#[test]
fn first_open_rewrites_meta_of_files_that_would_swap_on_rebuild() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let registered = s.create(req()).unwrap();
    let customer = s.create(req()).unwrap();
    let numbered = make(&s, sample(3, 4, "研修用"));
    let fresh = make(&s, sample(2, 3, "新しい版の見本"));
    let fresh_digest = file_digest(&s, &fresh.id);
    for (id, no) in [
        (&registered.id, registered.customer_no.as_str()),
        (&customer.id, "3-4-12"),
        (&numbered.id, "3-4-10"),
    ] {
        let mut b: Value = serde_json::from_str(&body()).unwrap();
        b["meta"] = json!({"format": "lifeplan.household", "formatVersion": "0.86", "customerNo": no, "savedAt": "2026-10-01T00:00:00Z"});
        s.write_raw_for_test(id, "0.86", &b.to_string(), 3).unwrap();
    }
    let mut office = s.office_json_for_test().unwrap();
    let hh = office["households"].as_object_mut().unwrap();
    hh[&registered.id]["sample"] = json!({"name": "登録した見本", "traits": []});
    to_legacy_entry(&mut hh[&registered.id], "1-3-10");
    hh[&customer.id]["customerNo"] = "3-4-12".into();
    hh[&customer.id].as_object_mut().unwrap().remove("serial");
    to_legacy_entry(&mut hh[&numbered.id], "3-4-10");
    s.write_office_json_for_test(&office, "0.2").unwrap();
    // 新しい版で初めて開く
    let s = env.store("pc");
    s.status().unwrap();
    let meta = |id: &str| s.raw_body_for_test(id).unwrap()["meta"].clone();
    assert_eq!(meta(&registered.id)["sample"]["name"], "登録した見本");
    assert!(meta(&registered.id).get("customerNo").is_none());
    assert_eq!(meta(&customer.id)["customerNo"], "3-4-12");
    assert_eq!(meta(&customer.id)["formatVersion"], migrate::CURRENT);
    assert_eq!(meta(&numbered.id)["sample"]["name"], "研修用");
    assert_eq!(
        file_digest(&s, &fresh.id),
        fresh_digest,
        "0.87 のファイルには触れない"
    );
    // もう一度開いても書き直さない
    let d = file_digest(&s, &customer.id);
    let s = env.store("pc");
    s.status().unwrap();
    assert_eq!(file_digest(&s, &customer.id), d);
    // 事務所データが無くなって一覧を作り直す
    let mut office = s.office_json_for_test().unwrap();
    office["households"] = json!({});
    s.write_office_json_for_test(&office, household_store::OFFICE_FORMAT_VERSION)
        .unwrap();
    let s = env.store("pc");
    s.status().unwrap();
    assert_eq!(
        customer_ids(&s),
        std::slice::from_ref(&customer.id),
        "顧客は顧客のまま"
    );
    assert_eq!(s.list().unwrap()[0].customer_no, "3-4-12");
    let got = shelf(&s);
    assert_eq!(got[&registered.id].0, "登録した見本");
    assert_eq!(got[&numbered.id].0, "研修用");
    assert_eq!(got[&fresh.id].0, "新しい版の見本");
}

/// セットの見本を直した版を作る指定（出どころつき。名前は元の見本と同じ）
fn edited(id: &str, name: &str) -> SampleRequest {
    SampleRequest {
        origin: Some(SampleOrigin {
            set: "official.basic".into(),
            id: id.into(),
            rev: 1,
        }),
        ..sample(3, 4, name)
    }
}

/// 見本の棚の出どころつきの見本の (内部ID, 見本の ID)
fn edited_ids(store: &Store) -> Vec<(String, String)> {
    store
        .list_samples()
        .unwrap()
        .into_iter()
        .filter_map(|e| {
            let o = e.label.sample?.origin?;
            Some((e.id, o.id))
        })
        .collect()
}

/// 0247 の6（PR の4段目）: セットの見本を最初の状態に戻すと、直した版を完全削除と同じ消し方で消す（世帯ファイル・直前の世代・毎日の写し・鍵。
/// 削除の記録が残る）。消すのは出どころのある見本だけで、顧客の世帯と自分で作った見本は消えない。戻した後は同じ見本をまた直せる
#[test]
fn resetting_an_edited_set_sample_removes_only_that_version() {
    let env = Env::new();
    let s = env.store("pc");
    s.status().unwrap();
    let name = "共働き・子2人・40代（資産運用）";
    let e = make(&s, edited("sampleDualAssetsInvest", name));
    let own = make(&s, sample(3, 4, "自分で作った見本"));
    let customer = s.create(req()).unwrap();
    // 次の日に開いて保存し、毎日の写しと直前の世代を作る
    env.clock.0.fetch_add(86_400, Ordering::SeqCst);
    let s = env.store("pc");
    s.status().unwrap();
    let o = s.open(&e.id).unwrap();
    s.save(&e.id, &o.body, "本人").unwrap();
    let p = s.household_path_for_test(&e.id);
    assert!(household_store::atomic::prev_path(&p).exists());
    let backups: Vec<PathBuf> = std::fs::read_dir(env.base.join("pc").join("backups"))
        .unwrap()
        .map(|d| d.unwrap().path())
        .collect();
    assert!(backups
        .iter()
        .any(|d| d.join("households").join(format!("{}.lphf", e.id)).exists()));
    let before = s.status().unwrap().deletions_pending;
    // 顧客の世帯・自分で作った見本は戻せない（消えない）
    assert_eq!(s.sample_reset(&customer.id).err(), Some(StoreError::SAMPLE));
    assert_eq!(
        s.sample_reset(&own.id).err(),
        Some(StoreError::SAMPLE_NOT_CHANGED)
    );
    assert_eq!(
        s.sample_reset("not-a-uuid").err(),
        Some(StoreError::UNKNOWN_HOUSEHOLD)
    );
    assert_eq!(
        s.sample_reset(&crypto::new_uuid()).err(),
        Some(StoreError::UNKNOWN_HOUSEHOLD)
    );
    assert!(s.open(&customer.id).is_ok() && s.open(&own.id).is_ok());
    // 直した版を戻す
    assert_eq!(
        s.sample_reset(&e.id).unwrap(),
        household_store::SampleReset::Removed
    );
    assert!(!p.exists());
    assert!(!household_store::atomic::prev_path(&p).exists());
    for d in &backups {
        assert!(
            !d.join("households").join(format!("{}.lphf", e.id)).exists(),
            "毎日の写しも消える"
        );
    }
    assert_eq!(s.open(&e.id).unwrap_err(), StoreError::UNKNOWN_HOUSEHOLD);
    assert!(edited_ids(&s).is_empty());
    assert_eq!(s.status().unwrap().deletions_pending, before + 1);
    assert!(
        s.any_managed_vault_has_key(&e.id),
        "鍵の日ごとの世代は30日まで残る（完全削除と同じ）"
    );
    // 顧客の世帯と自分で作った見本は残る
    assert_eq!(customer_ids(&s), std::slice::from_ref(&customer.id));
    assert_eq!(shelf(&s)[&own.id].0, "自分で作った見本");
    assert!(s.open(&own.id).is_ok());
    // 2回目は見つからない。また直せる（同じ出どころで作れる）
    assert_eq!(
        s.sample_reset(&e.id).err(),
        Some(StoreError::UNKNOWN_HOUSEHOLD)
    );
    let again = make(&s, edited("sampleDualAssetsInvest", name));
    assert_eq!(
        edited_ids(&s),
        vec![(again.id.clone(), "sampleDualAssetsInvest".to_owned())]
    );
}

/// 事務所の共有: セットの見本を直した版は棚に1つで、全員に出る。ほかの PC が先に直していれば作れない（一覧を読み直してから確かめる）。
/// だれでも最初の状態に戻せ、戻すと全員の棚から消える（閲覧だけの役割の人は tests/office.rs）
#[test]
fn edited_set_samples_are_shared_by_the_office() {
    let env = Env::new();
    let (a, b) = office_pair(&env);
    let name = "住宅を買う前の共働き・30代（子なし）";
    let e = make(&a, edited("sampleCoupleNoKids", name));
    assert_eq!(
        edited_ids(&b),
        vec![(e.id.clone(), "sampleCoupleNoKids".to_owned())]
    );
    let shown = b.list_samples().unwrap();
    let info = shown[0].label.sample.as_ref().unwrap();
    assert_eq!(info.name, name);
    assert!(info.changed);
    assert_eq!(shown[0].customer_no, "");
    // B はまだ一覧を読んでいなくても、作る前に読み直して断る
    assert_eq!(
        b.create_with(
            req(),
            CreateOptions {
                sample: Some(edited("sampleCoupleNoKids", name)),
                ..Default::default()
            }
        )
        .err(),
        Some(StoreError::SAMPLE_EXISTS)
    );
    // B が戻すと、A の棚からも消える
    assert_eq!(
        b.sample_reset(&e.id).unwrap(),
        household_store::SampleReset::Removed
    );
    assert!(edited_ids(&a).is_empty());
    assert_eq!(a.open(&e.id).err(), Some(StoreError::UNKNOWN_HOUSEHOLD));
    make(&b, edited("sampleCoupleNoKids", name));
    assert_eq!(edited_ids(&a).len(), 1);
    assert_eq!(edited_ids(&a).len(), 1);
}

/// PC の中と同期フォルダの間で移しても、直した版は出どころごと移る（戻せる・同じ出どころは作れない）
#[test]
fn edited_set_samples_move_with_the_shared_folder() {
    let env = Env::new();
    let folder = env.base.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = env.other_pc("a");
    a.status().unwrap();
    a.acknowledge_recovery().unwrap();
    let e = make(&a, edited("sampleSingleParent", "ひとり親と子2人・30代"));
    a.sync_start(&folder, "事務所のPC", true, &[]).unwrap();
    assert_eq!(
        edited_ids(&a),
        vec![(e.id.clone(), "sampleSingleParent".to_owned())]
    );
    assert!(
        a.list_samples().unwrap()[0]
            .label
            .sample
            .as_ref()
            .unwrap()
            .changed
    );
    assert_eq!(
        a.create_with(
            req(),
            CreateOptions {
                sample: Some(edited("sampleSingleParent", "ひとり親と子2人・30代")),
                ..Default::default()
            }
        )
        .err(),
        Some(StoreError::SAMPLE_EXISTS)
    );
    a.sync_end("事務所のPC").unwrap();
    assert_eq!(
        edited_ids(&a),
        vec![(e.id.clone(), "sampleSingleParent".to_owned())]
    );
    assert_eq!(
        a.sample_reset(&e.id).unwrap(),
        household_store::SampleReset::Removed
    );
    assert!(edited_ids(&a).is_empty());
}
