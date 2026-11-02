use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::json;

use super::*;

/// テストごとの作業フォルダ（OS の一時フォルダの中。テストが終わると片付ける）
fn temp(name: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!(
        "custom-layer-{name}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn entry(id: &str, text: &str, ops: &[Op]) -> serde_json::Value {
    let kind = catalog::kind_of(id);
    let mut v = json!({ "id": id, "kind": kind, "where": format!("{id} の所"), "audience": "fp", "text": text, "vars": [], "hash": fingerprint(text.as_bytes()), "ops": ops });
    if kind == "notice" {
        v["noticeKind"] = json!(if id.contains("MISSING") {
            "missing"
        } else {
            "assumed"
        });
    }
    v
}

fn catalog_of(entries: Vec<serde_json::Value>) -> Catalog {
    Catalog::parse(&json!({ "schema": catalog::CATALOG_SCHEMA, "entries": entries }).to_string())
        .unwrap()
}

const ALL: &[Op] = &[Op::Replace, Op::Append, Op::Hide];
const NO_HIDE: &[Op] = &[Op::Replace, Op::Append];

fn base_catalog() -> Catalog {
    catalog_of(vec![
        entry("field:debt.rate", "借入の金利です", ALL),
        entry("field:living.monthly", "毎月の生活費です", ALL),
        entry("notice:N_MISSING|x", "計算に入れていません", NO_HIDE),
        entry("notice:N_ASSUMED|y", "仮の値で計算しています", ALL),
        entry(
            "estimate:ui.savings.stopAge#retired",
            "推定は退職の年齢です",
            NO_HIDE,
        ),
    ])
}

fn hash(c: &Catalog, id: &str) -> String {
    c.get(id).unwrap().hash.clone()
}

struct Env {
    root: PathBuf,
    custom: PathBuf,
    data: PathBuf,
    key: [u8; 32],
}

impl Env {
    fn new(name: &str) -> Env {
        let root = temp(name);
        let custom = root.join("Documents").join(location::DEFAULT_DIR_NAME);
        let data = root.join("AppData").join("data");
        fs::create_dir_all(&data).unwrap();
        Env {
            root,
            custom,
            data,
            key: [7u8; 32],
        }
    }
    fn ctx<'a>(&'a self, c: &'a Catalog) -> Context<'a> {
        Context {
            store: ledger::Store::new(self.data.join("custom")),
            key: &self.key,
            catalog: c,
            default_dir: self.custom.clone(),
        }
    }
    fn write(&self, v: &serde_json::Value) {
        let p = self.custom.join(texts::TEXTS_PATH);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, serde_json::to_vec_pretty(v).unwrap()).unwrap();
    }
    fn write_raw(&self, s: &str) {
        let p = self.custom.join(texts::TEXTS_PATH);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn file(rows: Vec<serde_json::Value>) -> serde_json::Value {
    json!({ "schema": "texts@1.0", "entries": rows })
}

fn codes(st: &TextsStatus) -> Vec<&'static str> {
    st.errors.iter().map(|e| e.code).collect()
}

#[test]
fn reads_a_valid_file() {
    let c = base_catalog();
    let env = Env::new("read");
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "replace", "text": "金利は契約書で確かめます", "basedOn": hash(&c, "field:debt.rate") }),
        json!({ "id": "notice:N_ASSUMED|y", "do": "hide", "basedOn": hash(&c, "notice:N_ASSUMED|y") }),
        json!({ "id": "field:gone.item", "do": "append", "text": "前の欄", "basedOn": format!("sha256:{}", "0".repeat(64)) }),
    ]));
    let st = env.ctx(&c).status();
    assert_eq!(st.file, FileState::Present);
    assert!(st.errors.is_empty(), "{:?}", st.errors);
    assert_eq!(
        st.unused,
        vec!["field:gone.item".to_owned()],
        "一覧に無い id は誤りにせず、使われていない行に回す"
    );
    assert_eq!(st.state, State::Pending);
    assert!(st.fingerprint.starts_with("sha256:"));
    let diff: Vec<_> = st
        .rows
        .iter()
        .map(|r| (r.id.as_str(), r.changed, r.unused))
        .collect();
    assert!(diff.contains(&("field:debt.rate", true, false)));
    assert!(diff.contains(&("field:gone.item", true, true)));
}

#[test]
fn schema_and_rule_errors_block_approval() {
    let c = base_catalog();
    let h = hash(&c, "field:debt.rate");
    let cases: Vec<(serde_json::Value, &str)> = vec![
        (
            json!({ "schema": "texts@2.0", "entries": [] }),
            "E_TEXTS_SCHEMA",
        ),
        (
            json!({ "schema": "texts@1.9", "entries": [] }),
            "E_TEXTS_SCHEMA",
        ),
        (
            json!({ "schema": "texts@1.0", "entries": [], "extra": 1 }),
            "E_TEXTS_FIELD",
        ),
        (json!({ "schema": "texts@1.0" }), "E_TEXTS_ENTRIES"),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "a", "basedOn": h, "html": "<b>" }),
            ]),
            "E_TEXTS_FIELD",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "bold", "text": "a", "basedOn": h }),
            ]),
            "E_TEXTS_DO",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "basedOn": h }),
            ]),
            "E_TEXTS_TEXT",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "hide", "text": "a", "basedOn": h }),
            ]),
            "E_TEXTS_TEXT",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "a", "basedOn": "abc" }),
            ]),
            "E_TEXTS_BASED_ON",
        ),
        (
            file(vec![
                json!({ "id": "Field debt", "do": "replace", "text": "a", "basedOn": h }),
            ]),
            "E_TEXTS_ID",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "a", "basedOn": h }),
                json!({ "id": "field:debt.rate", "do": "append", "text": "b", "basedOn": h }),
            ]),
            "E_TEXTS_DUPLICATE",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "右から\u{202E}左へ", "basedOn": h }),
            ]),
            "E_TEXTS_CHAR",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "タブ\tです", "basedOn": h }),
            ]),
            "E_TEXTS_CHAR",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "あ".repeat(1001), "basedOn": h }),
            ]),
            "E_TEXTS_LENGTH",
        ),
        (
            file(vec![
                json!({ "id": "notice:N_ASSUMED|y", "do": "replace", "text": "あ".repeat(301), "basedOn": hash(&c, "notice:N_ASSUMED|y") }),
            ]),
            "E_TEXTS_LENGTH",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "月{amount}円", "basedOn": h }),
            ]),
            "E_TEXTS_PLACEHOLDER",
        ),
        (
            file(vec![
                json!({ "id": "field:debt.rate", "do": "replace", "text": "閉じない{", "basedOn": h }),
            ]),
            "E_TEXTS_PLACEHOLDER",
        ),
    ];
    for (v, want) in cases {
        let env = Env::new("schema");
        env.write(&v);
        let ctx = env.ctx(&c);
        let st = ctx.status();
        assert!(
            codes(&st).contains(&want),
            "{want} を期待: {:?} / {v}",
            codes(&st)
        );
        assert_eq!(
            ctx.approve(&st.fingerprint, 1).unwrap_err(),
            code::INVALID,
            "誤りのある中身は承認できない: {v}"
        );
        assert!(ctx.effective().is_empty());
    }
    // JSON として読めない・UTF-8 でない・大きすぎる
    for raw in ["{ not json", "[1,2]"] {
        let env = Env::new("raw");
        env.write_raw(raw);
        let st = env.ctx(&c).status();
        assert_eq!(codes(&st), vec!["E_TEXTS_JSON"]);
    }
    let env = Env::new("big");
    env.write_raw(&" ".repeat(texts::MAX_BYTES + 1));
    assert_eq!(codes(&env.ctx(&c).status()), vec!["E_TEXTS_SIZE"]);
    // 字のまま出す括弧（{{ }}）と改行はよい
    let env = Env::new("ok-braces");
    env.write(&file(vec![json!({ "id": "field:debt.rate", "do": "replace", "text": "{{例}}\n次の段落", "basedOn": h })]));
    assert!(env.ctx(&c).status().errors.is_empty());
}

#[test]
fn notices_and_estimates_that_cannot_be_hidden() {
    let c = base_catalog();
    for id in ["notice:N_MISSING|x", "estimate:ui.savings.stopAge#retired"] {
        let env = Env::new("nohide");
        env.write(&file(vec![
            json!({ "id": id, "do": "hide", "basedOn": hash(&c, id) }),
        ]));
        let ctx = env.ctx(&c);
        let st = ctx.status();
        assert_eq!(codes(&st), vec!["E_TEXTS_NOT_HIDEABLE"], "{id}");
        assert!(ctx.approve(&st.fingerprint, 1).is_err());
        // 言い方は変えられる
        env.write(&file(vec![
            json!({ "id": id, "do": "replace", "text": "事務所の言い方", "basedOn": hash(&c, id) }),
        ]));
        let st = ctx.status();
        assert!(st.errors.is_empty(), "{:?}", st.errors);
        ctx.approve(&st.fingerprint, 1).unwrap();
        assert_eq!(ctx.effective()[0].text.as_deref(), Some("事務所の言い方"));
    }
    // 一覧に無い推定の根拠・確かめの注意も消せない（一覧に無い知らせは、使われていない行）
    let env = Env::new("nohide-unknown");
    env.write(&file(vec![
        json!({ "id": "estimate:other", "do": "hide", "basedOn": format!("sha256:{}", "1".repeat(64)) }),
        json!({ "id": "check:other", "do": "hide", "basedOn": format!("sha256:{}", "1".repeat(64)) }),
        json!({ "id": "notice:N_OTHER", "do": "hide", "basedOn": format!("sha256:{}", "1".repeat(64)) }),
    ]));
    let st = env.ctx(&c).status();
    assert_eq!(
        codes(&st),
        vec!["E_TEXTS_NOT_HIDEABLE", "E_TEXTS_NOT_HIDEABLE"]
    );
    assert_eq!(st.unused, vec!["notice:N_OTHER".to_owned()]);
    // 一覧の側に、消せない知らせの hide が付いていたら一覧を読まない（ビルドの誤り）
    let bad = json!({ "schema": catalog::CATALOG_SCHEMA, "entries": [entry("notice:N_MISSING|z", "入れていません", ALL)] });
    assert!(Catalog::parse(&bad.to_string()).is_err());
}

#[test]
fn not_effective_before_approval_and_effective_after() {
    let c = base_catalog();
    let env = Env::new("approve");
    let ctx = env.ctx(&c);
    assert_eq!(ctx.status().state, State::None);
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "replace", "text": "事務所の説明", "basedOn": hash(&c, "field:debt.rate") }),
        json!({ "id": "field:living.monthly", "do": "append", "text": "足した段落", "basedOn": hash(&c, "field:living.monthly") }),
    ]));
    let st = ctx.status();
    assert_eq!(st.state, State::Pending);
    assert!(
        st.effective.is_empty(),
        "承認するまで効かない（AI がファイルを書いても公式の文のまま）"
    );
    let st = ctx.approve(&st.fingerprint, 1_700_000_000).unwrap();
    assert_eq!(st.state, State::Approved);
    assert_eq!(st.approved.as_ref().unwrap().approved_at, 1_700_000_000);
    let eff = ctx.effective();
    assert_eq!(eff.len(), 2);
    assert_eq!(
        (
            eff[0].id.as_str(),
            eff[0].op,
            eff[0].text.as_deref(),
            eff[0].official.as_str()
        ),
        (
            "field:debt.rate",
            Op::Replace,
            Some("事務所の説明"),
            "借入の金利です"
        )
    );
    assert!(!eff[0].official_changed);
    // 承認した中身は保存庫に（名前は指紋）
    let fp = st.approved.unwrap().fingerprint;
    assert!(env
        .data
        .join("custom")
        .join("approved")
        .join(format!("texts-{}.json", &fp["sha256:".len()..]))
        .is_file());
}

#[test]
fn changed_file_falls_back_to_the_approved_version() {
    let c = base_catalog();
    let env = Env::new("changed");
    let ctx = env.ctx(&c);
    let h = hash(&c, "field:debt.rate");
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "replace", "text": "一つ目", "basedOn": h }),
    ]));
    let first = ctx.status().fingerprint;
    ctx.approve(&first, 1).unwrap();
    // アプリの外で書き換えた（1字でも）: 承認が外れ、承認待ちに戻る。承認するまで前に承認した文のまま
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "replace", "text": "二つ目", "basedOn": h }),
    ]));
    let st = ctx.status();
    assert_eq!(st.state, State::Pending);
    assert_ne!(st.fingerprint, first);
    assert_eq!(st.effective[0].text.as_deref(), Some("一つ目"));
    let row = st.rows.iter().find(|r| r.id == "field:debt.rate").unwrap();
    assert_eq!(
        row.current.as_ref().unwrap().text.as_deref(),
        Some("一つ目")
    );
    assert_eq!(row.next.as_ref().unwrap().text.as_deref(), Some("二つ目"));
    assert_eq!(row.official.as_deref(), Some("借入の金利です"));
    // 見せたときの指紋と違えば承認しない（見ている間に AI が書き換えた）
    assert_eq!(ctx.approve(&first, 2).unwrap_err(), code::CHANGED);
    // 承認しない: 前の文のまま。同じ中身のあいだは承認待ちに出さない
    let st = ctx.decline(&st.fingerprint).unwrap();
    assert_eq!(st.state, State::Declined);
    assert_eq!(st.effective[0].text.as_deref(), Some("一つ目"));
    // あとから承認もできる
    let st = ctx.approve(&st.fingerprint, 3).unwrap();
    assert_eq!(st.effective[0].text.as_deref(), Some("二つ目"));
    // ファイルを消した: 承認待ち（承認すると公式の文に戻る）。承認するまで前の文
    fs::remove_file(env.custom.join(texts::TEXTS_PATH)).unwrap();
    let st = ctx.status();
    assert_eq!(
        (st.state, st.file, st.fingerprint.as_str()),
        (State::Pending, FileState::None, NO_FILE)
    );
    assert_eq!(st.effective.len(), 1);
    let st = ctx.approve(NO_FILE, 4).unwrap();
    assert_eq!(st.state, State::None);
    assert!(st.effective.is_empty());
}

#[test]
fn tampered_ledger_invalidates_approvals() {
    let c = base_catalog();
    let env = Env::new("tamper");
    let ctx = env.ctx(&c);
    env.write(&file(vec![json!({ "id": "field:debt.rate", "do": "replace", "text": "事務所の説明", "basedOn": hash(&c, "field:debt.rate") })]));
    let fp = ctx.status().fingerprint;
    ctx.approve(&fp, 1).unwrap();
    assert_eq!(ctx.effective().len(), 1);
    // 台帳の本文を書き換える（承認の時刻を1つ変えるだけでも）
    let p = env.data.join("custom").join(ledger::LEDGER_FILE);
    let text = fs::read_to_string(&p).unwrap();
    fs::write(
        &p,
        text.replace("\\\"approvedAt\\\":1", "\\\"approvedAt\\\":2"),
    )
    .unwrap();
    assert_ne!(fs::read_to_string(&p).unwrap(), text, "台帳を書き換えた");
    let st = ctx.status();
    assert!(st.ledger_reset);
    assert!(
        st.effective.is_empty(),
        "台帳が確かめられなければ、承認は全部無効"
    );
    assert_eq!(st.state, State::Pending);
    // 別の鍵（事務所の鍵が違う）でも同じ
    fs::write(&p, &text).unwrap();
    assert!(!ctx.status().ledger_reset);
    let other = [9u8; 32];
    let ctx2 = Context {
        key: &other,
        ..env.ctx(&c)
    };
    assert!(ctx2.status().ledger_reset);
    assert!(ctx2.effective().is_empty());
    // 台帳を自分で作っても（鍵を知らなければ）通らない
    let forged = json!({ "body": serde_json::to_string(&json!({ "format": "lifeplan.custom-ledger", "formatVersion": "1.0", "texts": { "fingerprint": fp, "approvedAt": 1 } })).unwrap(), "mac": "00".repeat(32) });
    fs::write(&p, forged.to_string()).unwrap();
    assert!(ctx.status().ledger_reset);
    assert!(ctx.effective().is_empty());
    // もう一度承認すると、台帳を作り直して効く
    let st = ctx.approve(&fp, 5).unwrap();
    assert!(!st.ledger_reset);
    assert_eq!(st.effective.len(), 1);
}

#[test]
fn tampered_approved_copy_is_not_used() {
    let c = base_catalog();
    let env = Env::new("vault");
    let ctx = env.ctx(&c);
    env.write(&file(vec![json!({ "id": "field:debt.rate", "do": "replace", "text": "事務所の説明", "basedOn": hash(&c, "field:debt.rate") })]));
    let fp = ctx.status().fingerprint;
    ctx.approve(&fp, 1).unwrap();
    let p = env
        .data
        .join("custom")
        .join("approved")
        .join(format!("texts-{}.json", &fp["sha256:".len()..]));
    fs::write(
        &p,
        fs::read_to_string(&p)
            .unwrap()
            .replace("事務所の説明", "書き換えた説明"),
    )
    .unwrap();
    let st = ctx.status();
    assert!(st.approved_missing);
    assert!(
        st.effective.is_empty(),
        "保存庫の中身の指紋が合わなければ使わない"
    );
}

#[test]
fn official_text_changed_by_an_update() {
    let old = base_catalog();
    let env = Env::new("update");
    let h_old = hash(&old, "field:debt.rate");
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "replace", "text": "事務所の説明", "basedOn": h_old }),
        json!({ "id": "field:living.monthly", "do": "append", "text": "足した段落", "basedOn": hash(&old, "field:living.monthly") }),
        json!({ "id": "notice:N_ASSUMED|y", "do": "replace", "text": "仮の値です（事務所）", "basedOn": hash(&old, "notice:N_ASSUMED|y") }),
    ]));
    let fp = env.ctx(&old).status().fingerprint;
    env.ctx(&old).approve(&fp, 1).unwrap();
    // 更新した版: 金利の説明が直った（意味はそのまま）・生活費の説明は意味が変わった・知らせの id が移った
    let mut changed = entry(
        "field:living.monthly",
        "毎月の生活費（住居費を除く）です",
        ALL,
    );
    changed["meaningChanged"] = json!(true);
    let mut moved = entry("notice:N_ASSUMED|y2", "仮の値で計算しています", ALL);
    moved["formerIds"] = json!(["notice:N_ASSUMED|y"]);
    let new = catalog_of(vec![
        entry("field:debt.rate", "借入の金利（年）です", ALL),
        changed,
        moved,
        entry("notice:N_MISSING|x", "計算に入れていません", NO_HIDE),
    ]);
    let ctx = env.ctx(&new);
    let st = ctx.status();
    assert_eq!(
        st.state,
        State::Approved,
        "ファイルは変わっていないので承認待ちではない"
    );
    let up: Vec<_> = st
        .updates
        .iter()
        .map(|u| (u.id.as_str(), u.stopped, u.reason))
        .collect();
    assert_eq!(
        up,
        vec![
            ("field:debt.rate", false, None),
            ("field:living.monthly", true, Some("meaning")),
            ("notice:N_ASSUMED|y", false, None)
        ]
    );
    let rate = st
        .updates
        .iter()
        .find(|u| u.id == "field:debt.rate")
        .unwrap();
    assert_eq!(
        (rate.before.as_deref(), rate.official.as_str()),
        (Some("借入の金利です"), "借入の金利（年）です")
    );
    // ふつうは使い続け（札つき）、意味が変わった行は止めて公式の文
    let eff: Vec<_> = st
        .effective
        .iter()
        .map(|e| (e.id.as_str(), e.official_changed))
        .collect();
    assert_eq!(
        eff,
        vec![("field:debt.rate", true), ("notice:N_ASSUMED|y2", true)]
    );
    // 「このまま使う」: basedOn を今の指紋に（移った行は新しい id に）。アプリの操作なので、そのまま承認
    let st = ctx
        .keep_rows(&["field:debt.rate".into(), "notice:N_ASSUMED|y".into()], 2)
        .unwrap();
    assert_eq!(st.state, State::Approved);
    assert_eq!(
        st.updates.iter().map(|u| u.id.as_str()).collect::<Vec<_>>(),
        vec!["field:living.monthly"]
    );
    let written: TextsFile =
        serde_json::from_slice(&fs::read(env.custom.join(texts::TEXTS_PATH)).unwrap()).unwrap();
    assert!(written
        .entries
        .iter()
        .any(|r| r.id == "notice:N_ASSUMED|y2" && r.based_on == hash(&new, "notice:N_ASSUMED|y2")));
    // 「公式の文に戻す」: 行を外す
    let st = ctx.drop_rows(&["field:living.monthly".into()], 3).unwrap();
    assert!(st.updates.is_empty());
    assert_eq!(st.effective.len(), 2);
    // 承認待ちの変更があるときは、行の直しを断る（AI の書いた中身を黙って承認しない）
    env.write(&file(vec![]));
    assert_eq!(
        ctx.keep_rows(&["field:debt.rate".into()], 4).unwrap_err(),
        code::PENDING
    );
}

#[test]
fn removed_placeholder_stops_the_row() {
    let mut with_var = entry("estimate:ui.x", "月{amount}円を使いました", NO_HIDE);
    with_var["vars"] = json!(["amount"]);
    let old = catalog_of(vec![with_var]);
    let env = Env::new("vars");
    env.write(&file(vec![json!({ "id": "estimate:ui.x", "do": "replace", "text": "{amount}円（事務所）", "basedOn": hash(&old, "estimate:ui.x") })]));
    let ctx = env.ctx(&old);
    let fp = ctx.status().fingerprint;
    ctx.approve(&fp, 1).unwrap();
    assert_eq!(ctx.effective().len(), 1);
    let new = catalog_of(vec![entry(
        "estimate:ui.x",
        "統計の平均を使いました",
        NO_HIDE,
    )]);
    let st = env.ctx(&new).status();
    assert_eq!(st.updates[0].reason, Some("vars"));
    assert!(st.effective.is_empty(), "印を字のまま見せない");
}

#[test]
fn revert_to_official_texts() {
    let c = base_catalog();
    let env = Env::new("revert");
    let ctx = env.ctx(&c);
    env.write(&file(vec![
        json!({ "id": "field:debt.rate", "do": "hide", "basedOn": hash(&c, "field:debt.rate") }),
    ]));
    let fp = ctx.status().fingerprint;
    ctx.approve(&fp, 1).unwrap();
    assert_eq!(ctx.effective()[0].op, Op::Hide);
    let st = ctx.revert().unwrap();
    assert!(st.effective.is_empty());
    assert_eq!(
        st.state,
        State::Declined,
        "ファイルは消さず、承認しない中身として残す"
    );
    assert!(env.custom.join(texts::TEXTS_PATH).is_file());
}

#[test]
fn location_must_not_overlap_the_data_folder() {
    let c = base_catalog();
    let env = Env::new("place");
    let ctx = env.ctx(&c);
    let protected = vec![env.data.clone()];
    // データフォルダの中・データフォルダを含む場所は選べない
    assert_eq!(
        ctx.set_dir(Some(&env.data.join("custom-here")), &protected)
            .unwrap_err(),
        "E_CUSTOM_PLACE_OVERLAP"
    );
    assert_eq!(
        ctx.set_dir(Some(env.data.parent().unwrap()), &protected)
            .unwrap_err(),
        "E_CUSTOM_PLACE_OVERLAP"
    );
    assert_eq!(
        ctx.set_dir(
            Some(&env.data.join("..").join("data").join("x")),
            &protected
        )
        .unwrap_err(),
        "E_CUSTOM_PLACE_OVERLAP",
        "..で回り込んでも止まる"
    );
    assert_eq!(
        ctx.set_dir(Some(Path::new("relative/dir")), &protected)
            .unwrap_err(),
        "E_CUSTOM_PLACE"
    );
    // 別の場所は選べ、既定に戻せる
    let other = env.custom.parent().unwrap().join("事務所のカスタム");
    let st = ctx.set_dir(Some(&other), &protected).unwrap();
    assert!(!st.is_default_dir);
    assert_eq!(ctx.dir(), location::normalized(&other));
    let st = ctx.create_folder(&protected).unwrap();
    assert!(st.folder_exists);
    assert!(other.join("settings").is_dir());
    let st = ctx.set_dir(None, &protected).unwrap();
    assert!(st.is_default_dir);
    assert_eq!(ctx.dir(), env.custom);
}

#[test]
fn placeholders_are_parsed() {
    assert_eq!(
        texts::placeholders("月{amount}円・{name}さん").unwrap(),
        vec!["amount", "name"]
    );
    assert_eq!(
        texts::placeholders("{{字}}のまま").unwrap(),
        Vec::<String>::new()
    );
    assert!(texts::placeholders("{1x}").is_err());
    assert!(texts::placeholders("a}b").is_err());
    assert!(texts::placeholders("{a b}").is_err());
}

/// JSON Schema（正本）と、本体の決まりがそろっている
#[test]
fn schema_file_matches_the_rules() {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../app/schemas/settings.texts.json");
    let s: serde_json::Value = serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap();
    assert_eq!(s["properties"]["schema"]["pattern"], json!("^texts@1\\.0$"));
    assert_eq!(s["additionalProperties"], json!(false));
    assert_eq!(
        s["properties"]["entries"]["maxItems"],
        json!(texts::MAX_ENTRIES)
    );
    let row = &s["$defs"]["row"];
    assert_eq!(row["additionalProperties"], json!(false));
    assert_eq!(row["required"], json!(["id", "do", "basedOn"]));
    assert_eq!(
        row["properties"]["do"]["enum"],
        json!(["replace", "append", "hide"])
    );
    assert_eq!(
        row["properties"]["id"]["maxLength"],
        json!(texts::ID_MAX_CHARS)
    );
    assert_eq!(
        row["properties"]["basedOn"]["pattern"],
        json!("^sha256:[0-9a-f]{64}$")
    );
    assert_eq!(row["properties"]["text"]["maxLength"], json!(1000));
    // 受け付けない字の範囲が Schema の pattern と同じ
    let pat = row["properties"]["text"]["pattern"].as_str().unwrap();
    for (c, bad) in [
        ('\t', true),
        ('\u{202A}', true),
        ('\u{202E}', true),
        ('\u{2066}', true),
        ('\u{2069}', true),
        ('\n', false),
        ('あ', false),
    ] {
        assert_eq!(texts::forbidden_char(c), bad, "{c:?}");
    }
    assert!(
        pat.contains("\\u202A-\\u202E") && pat.contains("\\u2066-\\u2069"),
        "{pat}"
    );
}
