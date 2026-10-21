// 顧客番号の区分と通し番号・見本の棚の試験（0033 の「テストで確かめること」）。
// 保管庫はメモリの実装を使う（OS の保管庫に触れない）。事務所での共有は、2つのデータフォルダと同じ共有フォルダで模す
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::{
    crypto, CategoryEdit, Clock, CreateOptions, CreateRequest, MemorySecretStore, SampleRequest,
    Store, StoreError,
};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}

struct Base(PathBuf);

impl Base {
    fn new() -> Base {
        Base(std::env::temp_dir().join(format!("hs-numbering-{}", crypto::new_uuid())))
    }
    fn store(&self, name: &str) -> Store {
        Store::new(
            self.0.join(name),
            Arc::new(MemorySecretStore::default()),
            TestClock(Arc::new(AtomicI64::new(1_792_368_000))),
            "0.1.0-test",
        )
    }
}

impl Drop for Base {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn body() -> String {
    serde_json::json!({
        "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"members": [{"id": "m1", "kind": "self"}]}}}},
        "proposals": [],
        "workspace": {"band": [], "base": "current", "selected": "current"},
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

fn with(store: &Store, category: Option<&str>) -> household_store::Opened {
    store
        .create_with(
            req(),
            CreateOptions {
                category: category.map(str::to_owned),
                sample: None,
            },
        )
        .unwrap()
}

fn sample(family: u8, age: u8, name: &str) -> SampleRequest {
    SampleRequest {
        family,
        age,
        name: name.into(),
        traits: vec!["共働き".into(), "会社員".into()],
    }
}

fn nos(store: &Store) -> Vec<String> {
    let mut v: Vec<String> = store
        .list()
        .unwrap()
        .into_iter()
        .map(|e| e.customer_no)
        .collect();
    v.sort();
    v
}

#[test]
fn category_and_serial() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    // 既定の区分（M 顧問契約・T 単発相談・P 見込み客）。新しい世帯の既定は見込み客
    let cats = s.categories().unwrap();
    assert_eq!(
        cats.iter()
            .map(|c| (c.code.as_str(), c.name.as_str()))
            .collect::<Vec<_>>(),
        [("M", "顧問契約"), ("T", "単発相談"), ("P", "見込み客")]
    );
    let a = s.create(req()).unwrap();
    assert_eq!(a.customer_no, "P0001");
    assert_eq!(a.label.category.as_deref(), Some("P"));
    assert_eq!(a.label.serial, Some(1));
    let b = with(&s, Some("M"));
    assert_eq!(b.customer_no, "M0002", "通し番号は区分をまたいで1本");
    assert_eq!(
        s.create_with(
            req(),
            CreateOptions {
                category: Some("Z".into()),
                sample: None
            }
        )
        .err(),
        Some(StoreError::CATEGORY)
    );
    // 区分を変えると記号だけが変わる（P0001 → M0001）。通し番号はそのまま
    let r = s.set_category(&a.id, "M").unwrap();
    assert_eq!(r.customer_no, "M0001");
    assert_eq!(s.open(&a.id).unwrap().customer_no, "M0001");
    // 枝番（関係する世帯）と -C（法人と家計を並べる用途）
    let c = with(&s, None);
    assert_eq!(c.customer_no, "P0003");
    assert_eq!(s.rename(&c.id, "M1-1").unwrap().customer_no, "M0001-1");
    let r = s.set_category(&c.id, "T").unwrap();
    assert_eq!(r.customer_no, "T0001-1", "枝番も通し番号もそのまま");
    assert_eq!(s.rename(&c.id, "M0001-C").unwrap().customer_no, "M0001-C");
    // 同じ通し番号と枝番は重なりとして知らせる（止めない）
    let d = with(&s, None);
    let r = s.rename(&d.id, "T0001-C").unwrap();
    assert!(r.duplicate);
    // 一度振った通し番号は使い回さない（消しても次は先の番号）
    s.delete(&d.id, "T0001-C").unwrap();
    assert_eq!(with(&s, None).customer_no, "P0005");
    // FP が先の通し番号を入れたら、次はその先から
    let e = with(&s, None);
    assert_eq!(s.rename(&e.id, "P0042").unwrap().customer_no, "P0042");
    assert_eq!(with(&s, None).customer_no, "P0043");
    // 閉じて開き直しても残る
    s.forget_session();
    s.status().unwrap();
    let l = s.list().unwrap();
    let got = l.iter().find(|x| x.id == a.id).unwrap();
    assert_eq!(got.customer_no, "M0001");
    assert_eq!(got.label.serial, Some(1));
    assert_eq!(with(&s, Some("T")).customer_no, "T0044");
}

#[test]
fn free_numbers_are_kept() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    let a = with(&s, Some("M"));
    // 自分の番号体系の番号（区分の記号の形でない）は自由な番号として持つ。区分は残る
    let r = s.rename(&a.id, "K-2019-07").unwrap();
    assert_eq!(r.customer_no, "K-2019-07");
    let e = s
        .list()
        .unwrap()
        .into_iter()
        .find(|x| x.id == a.id)
        .unwrap();
    assert_eq!(e.label.category.as_deref(), Some("M"));
    assert_eq!(e.label.serial, None);
    // 自由な番号は区分を変えても付け替えない
    assert_eq!(s.set_category(&a.id, "T").unwrap().customer_no, "K-2019-07");
    // 今までの「PCの接頭辞＋連番」の番号（区分に無い記号）も自由な番号
    assert_eq!(s.rename(&a.id, "A0001").unwrap().customer_no, "A0001");
    // 一方向の移行: 区分の記号＋新しい通し番号を付ける
    let r = s.assign_serial(&a.id).unwrap();
    assert_eq!(r.customer_no, "T0002");
    // 既に体系の番号なら何もしない
    assert_eq!(s.assign_serial(&a.id).unwrap().customer_no, "T0002");
    // 書式の検査は今までどおり（お名前を入れない）
    assert_eq!(s.rename(&a.id, "山田").err(), Some(StoreError::CUSTOMER_NO));
}

#[test]
fn category_settings() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    let a = with(&s, Some("P"));
    let b = with(&s, Some("M"));
    let edit = |from: Option<&str>, code: &str, name: &str| CategoryEdit {
        from: from.map(str::to_owned),
        code: code.into(),
        name: name.into(),
    };
    // 使っている区分は消せない
    assert_eq!(
        s.set_categories(&[edit(Some("M"), "M", "顧問契約")]).err(),
        Some(StoreError::CATEGORY_IN_USE)
    );
    // 記号を変える（P → MI）と、その区分の世帯の番号の記号も付け替える。使っていない T は消す。新しい区分を足す
    let cats = s
        .set_categories(&[
            edit(Some("M"), "M", "顧問契約"),
            edit(Some("P"), "MI", "見込み客"),
            edit(None, "S", "セミナー参加"),
        ])
        .unwrap();
    assert_eq!(cats.len(), 3);
    assert_eq!(s.open(&a.id).unwrap().customer_no, "MI0001");
    assert_eq!(s.open(&b.id).unwrap().customer_no, "M0002");
    // 見込み客の区分（P）が無くなったら、新しい世帯の既定は最初の区分
    assert_eq!(s.create(req()).unwrap().customer_no, "M0003");
    assert_eq!(with(&s, Some("S")).customer_no, "S0004");
    s.forget_session();
    s.status().unwrap();
    assert_eq!(s.categories().unwrap(), cats);
}

#[test]
fn sample_shelf() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    let customer = s.create(req()).unwrap();
    // FP が作る見本は 10 から。顧客の一覧には混ぜない
    let mk = |r: SampleRequest| {
        s.create_with(
            req(),
            CreateOptions {
                category: None,
                sample: Some(r),
            },
        )
        .unwrap()
    };
    let x = mk(sample(3, 4, "夫婦と子・研修用"));
    assert_eq!(x.customer_no, "3-4-10");
    assert_eq!(x.label.serial, None);
    assert_eq!(x.label.sample.as_ref().unwrap().name, "夫婦と子・研修用");
    assert_eq!(mk(sample(3, 4, "二つ目")).customer_no, "3-4-11");
    assert_eq!(mk(sample(1, 2, "単身")).customer_no, "1-2-10");
    assert_eq!(nos(&s), ["P0001"]);
    let shelf: Vec<String> = s
        .list_samples()
        .unwrap()
        .into_iter()
        .map(|e| e.customer_no)
        .collect();
    assert_eq!(shelf, ["1-2-10", "3-4-10", "3-4-11"]);
    // 見本の番号・区分は変えない
    assert_eq!(s.rename(&x.id, "M0001").err(), Some(StoreError::SAMPLE));
    assert_eq!(s.set_category(&x.id, "M").err(), Some(StoreError::SAMPLE));
    assert_eq!(s.assign_serial(&x.id).err(), Some(StoreError::SAMPLE));
    // 名前と絞り込みの項目は直せる
    s.update_sample(&x.id, "夫婦と子・片働き", &["片働き".to_owned()])
        .unwrap();
    let e = s
        .list_samples()
        .unwrap()
        .into_iter()
        .find(|e| e.id == x.id)
        .unwrap();
    assert_eq!(e.label.sample.unwrap().traits, ["片働き"]);
    assert_eq!(
        s.update_sample(&customer.id, "x", &[]).err(),
        Some(StoreError::SAMPLE)
    );
    // 自分の世帯を見本に登録する: 顧客番号が外れ、空き番号が付く。外れた通し番号は使い回さない
    let r = s
        .make_sample(&customer.id, &sample(3, 4, "研修の世帯"))
        .unwrap();
    assert_eq!(r.customer_no, "3-4-12");
    assert!(nos(&s).is_empty());
    assert_eq!(s.create(req()).unwrap().customer_no, "P0002");
    assert_eq!(
        s.make_sample(&customer.id, &sample(3, 4, "二度目")).err(),
        Some(StoreError::SAMPLE)
    );
    // 見本の指定の検査
    for bad in [sample(6, 4, "x"), sample(3, 1, "x"), sample(3, 4, "")] {
        assert_eq!(
            s.create_with(
                req(),
                CreateOptions {
                    category: None,
                    sample: Some(bad)
                }
            )
            .err(),
            Some(StoreError::SAMPLE)
        );
    }
    // 消すときの確認は見本番号
    assert_eq!(s.delete(&x.id, "3-4-11").err(), Some(StoreError::CONFIRM));
    s.delete(&x.id, "3-4-10").unwrap();
    // 空いた番号は次の見本で使う（見本番号は通し番号ではない）
    assert_eq!(mk(sample(3, 4, "三つ目")).customer_no, "3-4-10");
}

#[test]
fn office_wide_serials_categories_and_samples() {
    let base = Base::new();
    let folder = base.0.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = base.store("a");
    let b = base.store("b");
    a.status().unwrap();
    // 共有を始める前の世帯（番号の中身つき）は、共有フォルダへ移っても番号の中身を持ち越す
    let before = with(&a, Some("M"));
    assert_eq!(before.customer_no, "M0001");
    a.office_start(&folder, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&folder, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let rq = a.office_status().unwrap().requests;
    a.office_approve(&rq[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    let moved = a.list().unwrap();
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].label.category.as_deref(), Some("M"));
    // 通し番号は事務所全体で1本（B の PC の次の番号は 1 だが、共有フォルダの番号の先から振る）
    let x = b.create(req()).unwrap();
    assert_eq!(x.customer_no, "P0002");
    let y = a.create(req()).unwrap();
    assert_eq!(y.customer_no, "P0003");
    // 区分の設定は名簿に書き、事務所の全員が同じ区分を使う
    let edit = |from: Option<&str>, code: &str, name: &str| CategoryEdit {
        from: from.map(str::to_owned),
        code: code.into(),
        name: name.into(),
    };
    a.set_categories(&[
        edit(Some("M"), "K", "顧問契約"),
        edit(Some("T"), "T", "単発相談"),
        edit(Some("P"), "P", "見込み客"),
    ])
    .unwrap();
    assert_eq!(b.categories().unwrap()[0].code, "K");
    let l = b.list().unwrap();
    assert_eq!(
        l.iter().find(|e| e.id == before.id).unwrap().customer_no,
        "K0001"
    );
    assert_eq!(b.set_category(&x.id, "K").unwrap().customer_no, "K0002");
    // 見本の棚も事務所で1つ（番号も事務所全体で空きを探す）
    let s1 = a
        .create_with(
            req(),
            CreateOptions {
                category: None,
                sample: Some(sample(2, 3, "夫婦のみ")),
            },
        )
        .unwrap();
    assert_eq!(s1.customer_no, "2-3-10");
    let s2 = b
        .create_with(
            req(),
            CreateOptions {
                category: None,
                sample: Some(sample(2, 3, "夫婦のみ・二つ目")),
            },
        )
        .unwrap();
    assert_eq!(s2.customer_no, "2-3-11");
    assert_eq!(a.list_samples().unwrap().len(), 2);
    assert!(b.list().unwrap().iter().all(|e| e.label.sample.is_none()));
}
