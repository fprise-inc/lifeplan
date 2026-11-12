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
                ..Default::default()
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

fn edit(from: Option<&str>, code: &str, name: &str) -> CategoryEdit {
    CategoryEdit {
        from: from.map(str::to_owned),
        code: code.into(),
        name: name.into(),
    }
}

/// 「区分を使いますか？」に「使う」と答える（既定の A 顧問契約・B 単発相談・C 見込み客）
fn use_categories(store: &Store) {
    let r = store
        .set_categories(&[
            edit(None, "A", "顧問契約"),
            edit(None, "B", "単発相談"),
            edit(None, "C", "見込み客"),
        ])
        .unwrap();
    assert!(r.decided);
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
fn first_choice_and_categories() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    // 区分は最初から入れない。まだ決めていない（画面が初めて世帯の一覧を使うときに1回だけ聞く）
    let st = s.categories().unwrap();
    assert!(st.categories.is_empty());
    assert!(!st.decided);
    // 「使う」: 既定の A・B・C。新しい世帯の既定は見込み客（C）
    use_categories(&s);
    let st = s.categories().unwrap();
    assert!(st.decided);
    assert_eq!(
        st.categories
            .iter()
            .map(|c| (c.code.as_str(), c.name.as_str()))
            .collect::<Vec<_>>(),
        [("A", "顧問契約"), ("B", "単発相談"), ("C", "見込み客")]
    );
    // 閉じて開き直しても聞き直さない
    s.forget_session();
    s.status().unwrap();
    assert!(s.categories().unwrap().decided);
}

#[test]
fn category_and_serial() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    use_categories(&s);
    let a = s.create(req()).unwrap();
    assert_eq!(a.customer_no, "C0001");
    assert_eq!(a.label.category.as_deref(), Some("C"));
    assert_eq!(a.label.serial, Some(1));
    let b = with(&s, Some("A"));
    assert_eq!(b.customer_no, "A0002", "通し番号は区分をまたいで1本");
    assert_eq!(
        s.create_with(
            req(),
            CreateOptions {
                category: Some("Z".into()),
                sample: None,
                ..Default::default()
            }
        )
        .err(),
        Some(StoreError::CATEGORY)
    );
    // 区分を変えると記号だけが変わる（C0001 → A0001）。通し番号はそのまま
    let r = s.set_category(&a.id, "A").unwrap();
    assert_eq!(r.customer_no, "A0001");
    assert_eq!(s.open(&a.id).unwrap().customer_no, "A0001");
    // 枝番（関係する世帯）と -C（法人と家計を並べる用途）
    let c = with(&s, None);
    assert_eq!(c.customer_no, "C0003");
    assert_eq!(s.rename(&c.id, "A1-1").unwrap().customer_no, "A0001-1");
    let r = s.set_category(&c.id, "B").unwrap();
    assert_eq!(r.customer_no, "B0001-1", "枝番も通し番号もそのまま");
    assert_eq!(s.rename(&c.id, "A0001-C").unwrap().customer_no, "A0001-C");
    // 同じ通し番号と枝番は重なりとして知らせる（止めない）
    let d = with(&s, None);
    let r = s.rename(&d.id, "B0001-C").unwrap();
    assert!(r.duplicate);
    // 一度振った通し番号は使い回さない（消しても次は先の番号）
    s.delete(&d.id, "B0001-C").unwrap();
    assert_eq!(with(&s, None).customer_no, "C0005");
    // FP が先の通し番号を入れたら、次はその先から
    let e = with(&s, None);
    assert_eq!(s.rename(&e.id, "C0042").unwrap().customer_no, "C0042");
    assert_eq!(with(&s, None).customer_no, "C0043");
    // 閉じて開き直しても残る
    s.forget_session();
    s.status().unwrap();
    let l = s.list().unwrap();
    let got = l.iter().find(|x| x.id == a.id).unwrap();
    assert_eq!(got.customer_no, "A0001");
    assert_eq!(got.label.serial, Some(1));
    assert_eq!(with(&s, Some("B")).customer_no, "B0044");
}

#[test]
fn without_categories() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    // 「使わない」: 区分なし。番号は通し番号だけ
    let r = s.set_categories(&[]).unwrap();
    assert!(r.decided);
    assert!(r.categories.is_empty());
    let a = s.create(req()).unwrap();
    assert_eq!(a.customer_no, "0001");
    assert_eq!(a.label.category, None);
    assert_eq!(a.label.serial, Some(1));
    let b = s.create(req()).unwrap();
    assert_eq!(b.customer_no, "0002");
    // 区分の指定はできない
    assert_eq!(with_err(&s, "C"), Some(StoreError::CATEGORY));
    // 数字だけの番号は区分なしの通し番号として読む（先の番号を入れたらその先から）。使い回さない
    assert_eq!(s.rename(&b.id, "42").unwrap().customer_no, "0042");
    s.delete(&b.id, "0042").unwrap();
    assert_eq!(s.create(req()).unwrap().customer_no, "0043");
    // 記号つき（今までの PC の接頭辞の番号）は自由な番号
    let c = s.create(req()).unwrap();
    assert_eq!(s.rename(&c.id, "A0001").unwrap().customer_no, "A0001");
    let e = s
        .list()
        .unwrap()
        .into_iter()
        .find(|x| x.id == c.id)
        .unwrap();
    assert_eq!(e.label.serial, None);
    // あとから「使う」にしても、それまでの番号は区分なしのまま（通し番号も変わらない）。1件ずつ区分を付けられる
    use_categories(&s);
    assert_eq!(s.open(&a.id).unwrap().customer_no, "0001");
    assert_eq!(s.set_category(&a.id, "A").unwrap().customer_no, "A0001");
    // 今までの番号の A0001（自由な番号）と区分 A の 1 番は、表示が同じでも別のもの（重なりとして知らせるだけ）
    let l = s.list().unwrap();
    assert_eq!(l.iter().find(|x| x.id == c.id).unwrap().label.serial, None);
    assert_eq!(with(&s, None).customer_no, "C0045");
    // 使っている区分があるうちは「使わない」に戻せない
    assert_eq!(
        s.set_categories(&[]).err(),
        Some(StoreError::CATEGORY_IN_USE)
    );
}

fn with_err(store: &Store, category: &str) -> Option<StoreError> {
    store
        .create_with(
            req(),
            CreateOptions {
                category: Some(category.into()),
                sample: None,
                ..Default::default()
            },
        )
        .err()
}

#[test]
fn free_numbers_are_kept() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    use_categories(&s);
    let a = with(&s, Some("A"));
    // 自分の番号体系の番号（区分の記号の形でない）は自由な番号として持つ。区分は残る
    let r = s.rename(&a.id, "K-2019-07").unwrap();
    assert_eq!(r.customer_no, "K-2019-07");
    let e = s
        .list()
        .unwrap()
        .into_iter()
        .find(|x| x.id == a.id)
        .unwrap();
    assert_eq!(e.label.category.as_deref(), Some("A"));
    assert_eq!(e.label.serial, None);
    // 自由な番号は区分を変えても付け替えない
    assert_eq!(s.set_category(&a.id, "B").unwrap().customer_no, "K-2019-07");
    // 今までの「PCの接頭辞＋連番」の番号（区分に無い記号）も自由な番号
    assert_eq!(s.rename(&a.id, "Z0001").unwrap().customer_no, "Z0001");
    // 一方向の移行: 区分の記号＋新しい通し番号を付ける
    let r = s.assign_serial(&a.id).unwrap();
    assert_eq!(r.customer_no, "B0002");
    // 既に体系の番号なら何もしない
    assert_eq!(s.assign_serial(&a.id).unwrap().customer_no, "B0002");
    // 書式の検査は今までどおり（お名前を入れない）
    assert_eq!(s.rename(&a.id, "山田").err(), Some(StoreError::CUSTOMER_NO));
}

#[test]
fn old_prefix_numbers_are_not_read_as_categories() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    // 今までの「PCの接頭辞＋連番」の番号 A0007 を持つ世帯を作る（区分に A が無いときに入れた番号＝自由な番号）
    s.set_categories(&[edit(None, "K", "顧問契約")]).unwrap();
    let old = with(&s, None);
    assert_eq!(s.rename(&old.id, "A0007").unwrap().customer_no, "A0007");
    // 区分に A が入っても、古い番号は区分 A の 7 番にはならない
    s.set_categories(&[
        edit(Some("K"), "K", "顧問契約"),
        edit(None, "A", "顧問契約2"),
        edit(None, "C", "見込み客"),
    ])
    .unwrap();
    let e = |s: &Store| {
        s.list()
            .unwrap()
            .into_iter()
            .find(|x| x.id == old.id)
            .unwrap()
    };
    assert_eq!(e(&s).customer_no, "A0007");
    assert_eq!(e(&s).label.serial, None);
    assert_eq!(e(&s).label.category.as_deref(), Some("K"));
    // 番号を変える欄で同じ番号をそのまま入れても、体系の番号に読み替えない
    let r = s.rename(&old.id, "A0007").unwrap();
    assert_eq!(r.customer_no, "A0007");
    assert_eq!(e(&s).label.serial, None);
    assert_eq!(e(&s).label.category.as_deref(), Some("K"));
    // 開き直しても自由な番号のまま
    s.forget_session();
    s.status().unwrap();
    assert_eq!(e(&s).label.serial, None);
    // 区分 A の新しい世帯は、古い番号と同じ表示の番号を飛ばす（通し番号は区分をまたいで1本）
    let n = with(&s, Some("A"));
    assert_eq!(n.customer_no, "A0002");
}

#[test]
fn category_settings() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    use_categories(&s);
    let a = with(&s, Some("C"));
    let b = with(&s, Some("A"));
    // 使っている区分は消せない
    assert_eq!(
        s.set_categories(&[edit(Some("A"), "A", "顧問契約")]).err(),
        Some(StoreError::CATEGORY_IN_USE)
    );
    // 記号を変える（C → MI）と、その区分の世帯の番号の記号も付け替える。使っていない B は消す。新しい区分を足す
    let cats = s
        .set_categories(&[
            edit(Some("A"), "A", "顧問契約"),
            edit(Some("C"), "MI", "見込み客"),
            edit(None, "S", "セミナー参加"),
        ])
        .unwrap();
    assert_eq!(cats.categories.len(), 3);
    assert_eq!(s.open(&a.id).unwrap().customer_no, "MI0001");
    assert_eq!(s.open(&b.id).unwrap().customer_no, "A0002");
    // 見込み客の区分（C）が無くなったら、新しい世帯の既定は最初の区分
    assert_eq!(s.create(req()).unwrap().customer_no, "A0003");
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
    use_categories(&s);
    let customer = s.create(req()).unwrap();
    // FP が作る見本は 10 から。顧客の一覧には混ぜない
    let mk = |r: SampleRequest| {
        s.create_with(
            req(),
            CreateOptions {
                category: None,
                sample: Some(r),
                ..Default::default()
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
    assert_eq!(nos(&s), ["C0001"]);
    let shelf: Vec<String> = s
        .list_samples()
        .unwrap()
        .into_iter()
        .map(|e| e.customer_no)
        .collect();
    assert_eq!(shelf, ["1-2-10", "3-4-10", "3-4-11"]);
    // 見本の番号・区分は変えない
    assert_eq!(s.rename(&x.id, "A0001").err(), Some(StoreError::SAMPLE));
    assert_eq!(s.set_category(&x.id, "A").err(), Some(StoreError::SAMPLE));
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
    assert_eq!(s.create(req()).unwrap().customer_no, "C0002");
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
                    sample: Some(bad),
                    ..Default::default()
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
    use_categories(&a);
    // 共有を始める前の世帯（番号の中身つき）は、共有フォルダへ移っても番号の中身を持ち越す
    let before = with(&a, Some("A"));
    assert_eq!(before.customer_no, "A0001");
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
    assert_eq!(moved[0].label.category.as_deref(), Some("A"));
    // 事務所の名簿に区分があるので、加わった PC には聞かない
    assert!(b.categories().unwrap().decided);
    // 通し番号は事務所全体で1本（B の PC の次の番号は 1 だが、共有フォルダの番号の先から振る）
    let x = b.create(req()).unwrap();
    assert_eq!(x.customer_no, "C0002");
    let y = a.create(req()).unwrap();
    assert_eq!(y.customer_no, "C0003");
    // 区分の設定は名簿に書き、事務所の全員が同じ区分を使う
    a.set_categories(&[
        edit(Some("A"), "K", "顧問契約"),
        edit(Some("B"), "B", "単発相談"),
        edit(Some("C"), "C", "見込み客"),
    ])
    .unwrap();
    assert_eq!(b.categories().unwrap().categories[0].code, "K");
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
                ..Default::default()
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
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(s2.customer_no, "2-3-11");
    assert_eq!(a.list_samples().unwrap().len(), 2);
    assert!(b.list().unwrap().iter().all(|e| e.label.sample.is_none()));
}

#[test]
fn office_decides_once() {
    let base = Base::new();
    let folder = base.0.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = base.store("a");
    let b = base.store("b");
    a.status().unwrap();
    // まだ決めていない PC が共有を始めると、名簿に区分を書かない（事務所で1回決める）
    a.office_start(&folder, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&folder, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let rq = a.office_status().unwrap().requests;
    a.office_approve(&rq[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    assert!(!a.categories().unwrap().decided);
    assert!(!b.categories().unwrap().decided);
    // B が「使わない」と答えると、事務所の全員が区分なし（A には聞かない）
    b.set_categories(&[]).unwrap();
    let st = a.categories().unwrap();
    assert!(st.decided);
    assert!(st.categories.is_empty());
    assert_eq!(a.create(req()).unwrap().customer_no, "0001");
    assert_eq!(b.create(req()).unwrap().customer_no, "0002");
}

/// 架空の世帯の印: アプリ本体が作るときだけ付き、一覧と開いた世帯に出る。番号を変えても残り、外すのは一方向（お客さまの世帯にする）だけ。
/// 見本に登録すると印は外れる（見本は今までどおり）。事務所で共有しているときも、世帯の札に載る
#[test]
fn fictional_mark_is_set_by_the_app_and_only_removed() {
    let base = Base::new();
    let s = base.store("pc");
    s.status().unwrap();
    use_categories(&s);
    let f = s
        .create_with(
            req(),
            CreateOptions {
                fictional: true,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(f.label.fictional);
    assert_eq!(f.customer_no, "C0001", "番号の付け方はお客さまの世帯と同じ");
    let c = s.create(req()).unwrap();
    assert!(!c.label.fictional);
    let listed = |id: &str| s.list().unwrap().into_iter().find(|e| e.id == id).unwrap();
    assert!(listed(&f.id).label.fictional);
    assert!(!listed(&c.id).label.fictional);
    // 一覧の欄に出る（画面に返す形）。印の無い世帯には欄が無い
    let json = serde_json::to_value(listed(&f.id)).unwrap();
    assert_eq!(json["fictional"], true);
    assert!(serde_json::to_value(listed(&c.id))
        .unwrap()
        .get("fictional")
        .is_none());
    assert!(s.open(&f.id).unwrap().label.fictional, "開いた世帯にも出る");
    // 番号を変える・区分を変える・自由な番号に通し番号を付けても印は残る
    s.rename(&f.id, "A0042").unwrap();
    assert!(listed(&f.id).label.fictional);
    s.rename(&f.id, "seminar-1").unwrap();
    assert!(listed(&f.id).label.fictional);
    s.assign_serial(&f.id).unwrap();
    assert!(listed(&f.id).label.fictional);
    s.set_category(&f.id, "B").unwrap();
    assert!(listed(&f.id).label.fictional);
    // 閉じて開き直しても残る（事務所データに書いてある）
    s.forget_session();
    s.status().unwrap();
    assert!(listed(&f.id).label.fictional);
    // お客さまの世帯にする（一方向）。印の無い世帯では何もしない
    assert!(!s.make_client(&c.id).unwrap());
    assert!(s.make_client(&f.id).unwrap());
    assert!(!listed(&f.id).label.fictional);
    assert!(!s.make_client(&f.id).unwrap());
    // 見本に登録すると印は外れる
    let g = s
        .create_with(
            req(),
            CreateOptions {
                fictional: true,
                ..Default::default()
            },
        )
        .unwrap();
    s.make_sample(&g.id, &sample(1, 3, "単身")).unwrap();
    let shelf = s.list_samples().unwrap();
    assert!(shelf.iter().all(|e| !e.label.fictional));
    // 見本として作るときは付けない
    let h = s
        .create_with(
            req(),
            CreateOptions {
                sample: Some(sample(1, 3, "単身・二つ目")),
                fictional: true,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!h.label.fictional);
}

/// 事務所で共有しているとき、架空の印は世帯の札に載り、ほかの PC の一覧にも出る
#[test]
fn fictional_mark_travels_on_the_shared_card() {
    let base = Base::new();
    let folder = base.0.join("共有フォルダ");
    std::fs::create_dir_all(&folder).unwrap();
    let a = base.store("a");
    let b = base.store("b");
    a.status().unwrap();
    use_categories(&a);
    a.office_start(&folder, "担当A", true, &[]).unwrap();
    a.acknowledge_recovery().unwrap();
    b.status().unwrap();
    let st = b.office_join(&folder, "担当B", true, &[]).unwrap();
    let fp = st.my_fingerprint.unwrap();
    let rq = a.office_status().unwrap().requests;
    a.office_approve(&rq[0].request_id, &fp).unwrap();
    assert_eq!(b.office_status().unwrap().state, "member");
    let f = a
        .create_with(
            req(),
            CreateOptions {
                fictional: true,
                ..Default::default()
            },
        )
        .unwrap();
    let on_b = |id: &str| b.list().unwrap().into_iter().find(|e| e.id == id).unwrap();
    assert!(on_b(&f.id).label.fictional);
    assert!(b.make_client(&f.id).unwrap());
    assert!(!a.list().unwrap().iter().any(|e| e.label.fictional));
}
