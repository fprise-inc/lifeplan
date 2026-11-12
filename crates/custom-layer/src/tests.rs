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
        self.ctx_of(Kind::Texts, c)
    }
    fn ctx_of<'a>(&'a self, kind: Kind, c: &'a Catalog) -> Context<'a> {
        Context {
            kind,
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

// ---- 名前の差し替え（settings/terms.json）と、欄の隠す・並べ替え（settings/fields.json）。2026-11-02 の追記 ----

fn name_entry(id: &str, name: &str, vars: &[&str]) -> serde_json::Value {
    json!({ "id": id, "kind": catalog::kind_of(id), "where": format!("{id} の名前"), "audience": if id.starts_with("row:") { "customer" } else { "fp" }, "text": name, "vars": vars, "hash": fingerprint(name.as_bytes()), "ops": ["replace"] })
}

fn terms_catalog() -> Catalog {
    Catalog::parse(
        &json!({ "schema": catalog::TERMS_CATALOG_SCHEMA, "entries": [
            name_entry("field:livingExpense.monthly", "基本生活費（月額）", &[]),
            name_entry("row:living", "基本生活費", &[]),
            name_entry("row:salary", "{person}の給与", &["person"]),
        ] })
        .to_string(),
    )
    .unwrap()
}

fn field_entry(id: &str, label: &str) -> serde_json::Value {
    json!({ "id": id, "kind": "field", "where": format!("{label} の欄"), "audience": "fp", "text": label, "vars": [], "hash": fingerprint(label.as_bytes()), "ops": ["hide", "order"] })
}

fn fields_catalog() -> Catalog {
    Catalog::parse(
        &json!({ "schema": catalog::FIELDS_CATALOG_SCHEMA, "entries": [
            field_entry("field:livingExpense.monthly", "基本生活費（月額）"),
            field_entry("field:livingExpense.growth", "伸び方"),
        ] })
        .to_string(),
    )
    .unwrap()
}

impl Env {
    fn write_kind(&self, kind: Kind, v: &serde_json::Value) {
        let p = self.custom.join(kind.path());
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, serde_json::to_vec_pretty(v).unwrap()).unwrap();
    }
}

#[test]
fn names_need_approval_and_keep_their_own_ledger_slot() {
    let tc = terms_catalog();
    let xc = base_catalog();
    let env = Env::new("terms");
    let terms = env.ctx_of(Kind::Terms, &tc);
    env.write_kind(
        Kind::Terms,
        &json!({ "schema": "terms@1.0", "entries": [
            { "id": "row:living", "name": "毎月の暮らしの費用", "basedOn": hash(&tc, "row:living") },
            { "id": "row:salary", "name": "{person}のお給料", "basedOn": hash(&tc, "row:salary") },
            { "id": "row:gone", "name": "無い行", "basedOn": hash(&tc, "row:living") },
        ] }),
    );
    let st = terms.status();
    assert_eq!(st.kind, Kind::Terms);
    assert_eq!(st.state, State::Pending);
    assert!(st.errors.is_empty(), "{:?}", st.errors);
    assert_eq!(st.unused, vec!["row:gone".to_owned()]);
    assert!(st.effective.is_empty(), "承認するまで効かない");
    // お客さまに見える名前（表の行）は承認の画面で先に並ぶ
    assert_eq!(st.rows[0].audience.as_deref(), Some("customer"));
    let st = terms.approve(&st.fingerprint, 1).unwrap();
    assert_eq!(st.state, State::Approved);
    let eff: Vec<_> = st
        .effective
        .iter()
        .map(|e| (e.id.as_str(), e.text.as_deref(), e.official.as_str()))
        .collect();
    assert_eq!(
        eff,
        vec![
            ("row:living", Some("毎月の暮らしの費用"), "基本生活費"),
            ("row:salary", Some("{person}のお給料"), "{person}の給与")
        ]
    );
    // 保存庫のファイル名の頭は種類ごと
    let fp = st.approved.unwrap().fingerprint;
    assert!(env
        .data
        .join("custom")
        .join("approved")
        .join(format!("terms-{}.json", &fp["sha256:".len()..]))
        .is_file());
    // 説明の文の承認とは別（名前を承認しても、説明の文は公式のまま）
    let texts = env.ctx_of(Kind::Texts, &xc);
    assert_eq!(texts.status().state, State::None);
    assert!(texts.effective().is_empty());
    // 公式の名前が変わったら、更新の確かめに出る（名前はそのまま使い続ける）
    let tc2 = Catalog::parse(
        &json!({ "schema": catalog::TERMS_CATALOG_SCHEMA, "entries": [name_entry("row:living", "基本的な生活費", &[]), name_entry("row:salary", "{person}の給与", &["person"])] })
            .to_string(),
    )
    .unwrap();
    let st = env.ctx_of(Kind::Terms, &tc2).status();
    assert_eq!(st.updates.len(), 1);
    assert_eq!(st.updates[0].id, "row:living");
    assert!(!st.updates[0].stopped);
    let st = env
        .ctx_of(Kind::Terms, &tc2)
        .keep_rows(&["row:living".to_owned()], 2)
        .unwrap();
    assert!(st.updates.is_empty());
    // 書き直したファイルも名前の形のまま（name・basedOn）
    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(env.custom.join(terms::TERMS_PATH)).unwrap()).unwrap();
    assert_eq!(saved["entries"][0]["name"], json!("毎月の暮らしの費用"));
    assert_eq!(
        saved["entries"][0]["basedOn"],
        json!(hash(&tc2, "row:living"))
    );
    assert!(saved["entries"][0].get("do").is_none());
}

#[test]
fn name_rules() {
    let tc = terms_catalog();
    let env = Env::new("terms-rules");
    let ctx = env.ctx_of(Kind::Terms, &tc);
    let h = hash(&tc, "row:living");
    env.write_kind(
        Kind::Terms,
        &json!({ "schema": "terms@1.0", "entries": [
            { "id": "row:living", "name": "二行の\n名前", "basedOn": h },
            { "id": "field:livingExpense.monthly", "name": "あ".repeat(41), "basedOn": hash(&tc, "field:livingExpense.monthly") },
            { "id": "row:salary", "name": "{who}の給与", "basedOn": hash(&tc, "row:salary") },
        ] }),
    );
    let st = ctx.status();
    assert_eq!(
        codes(&st),
        vec!["E_TERMS_CHAR", "E_TERMS_LENGTH", "E_TERMS_PLACEHOLDER"]
    );
    assert_eq!(ctx.approve(&st.fingerprint, 1).unwrap_err(), code::INVALID);
    // 名前は消せない（do・text は書けない）。空の名前も受け付けない
    env.write_kind(
        Kind::Terms,
        &json!({ "schema": "terms@1.0", "entries": [
            { "id": "row:living", "do": "hide", "basedOn": h },
            { "id": "row:salary", "name": " ", "basedOn": hash(&tc, "row:salary") },
        ] }),
    );
    let st = ctx.status();
    assert_eq!(
        codes(&st),
        vec!["E_TERMS_FIELD", "E_TERMS_NAME", "E_TERMS_NAME"]
    );
    // 差し込みの印を使わない名前は、承認はできる（注意を出す）
    env.write_kind(Kind::Terms, &json!({ "schema": "terms@1.0", "entries": [{ "id": "row:salary", "name": "給与", "basedOn": hash(&tc, "row:salary") }] }));
    let st = ctx.status();
    assert!(st.errors.is_empty());
    assert_eq!(
        st.warnings.iter().map(|w| w.code).collect::<Vec<_>>(),
        vec!["W_TERMS_VARS"]
    );
    // 版
    env.write_kind(
        Kind::Terms,
        &json!({ "schema": "texts@1.0", "entries": [] }),
    );
    assert_eq!(codes(&ctx.status()), vec!["E_TERMS_SCHEMA"]);
}

#[test]
fn field_layout_hide_and_order() {
    let fc = fields_catalog();
    let env = Env::new("fields");
    let ctx = env.ctx_of(Kind::Fields, &fc);
    env.write_kind(
        Kind::Fields,
        &json!({ "schema": "fields@1.0", "entries": [
            { "id": "field:livingExpense.growth", "hide": true },
            { "id": "field:livingExpense.monthly", "order": 2 },
        ] }),
    );
    let st = ctx.status();
    assert!(st.errors.is_empty(), "{:?}", st.errors);
    assert!(st.effective.is_empty(), "承認するまで効かない");
    let st = ctx.approve(&st.fingerprint, 1).unwrap();
    let eff: Vec<_> = st
        .effective
        .iter()
        .map(|e| (e.id.as_str(), e.op, e.order))
        .collect();
    assert_eq!(
        eff,
        vec![
            ("field:livingExpense.growth", Op::Hide, None),
            ("field:livingExpense.monthly", Op::Order, Some(2))
        ]
    );
    assert!(
        st.updates.is_empty(),
        "公式の文に拠らないので、更新の確かめは出ない"
    );
}

#[test]
fn field_layout_does_not_take_default_values() {
    let fc = fields_catalog();
    let env = Env::new("fields-default");
    let ctx = env.ctx_of(Kind::Fields, &fc);
    // 既定の値は事務所の既定値の画面で変える。カスタム層のファイルに書いても承認できない（効かない）
    env.write_kind(
        Kind::Fields,
        &json!({ "schema": "fields@1.0", "entries": [
            { "id": "field:livingExpense.monthly", "hide": true, "default": 250000 },
            { "id": "field:livingExpense.growth", "value": "1%" },
        ] }),
    );
    let st = ctx.status();
    assert_eq!(
        codes(&st),
        vec!["E_FIELDS_DEFAULT", "E_FIELDS_DEFAULT", "E_FIELDS_EMPTY"]
    );
    assert_eq!(ctx.approve(&st.fingerprint, 1).unwrap_err(), code::INVALID);
    assert!(ctx.effective().is_empty());
    env.write_kind(Kind::Fields, &json!({ "schema": "fields@1.0", "defaults": { "livingExpense.monthly": 1 }, "entries": [] }));
    assert_eq!(codes(&ctx.status()), vec!["E_FIELDS_DEFAULT"]);
    // ほかの誤り: hide は true だけ・order は 1〜99 の整数・欄（field:）だけ
    env.write_kind(
        Kind::Fields,
        &json!({ "schema": "fields@1.0", "entries": [
            { "id": "field:livingExpense.monthly", "hide": false },
            { "id": "field:livingExpense.growth", "order": 0 },
            { "id": "notice:N_X", "hide": true },
        ] }),
    );
    assert_eq!(
        codes(&ctx.status()),
        vec!["E_FIELDS_HIDE", "E_FIELDS_ORDER", "E_FIELDS_ID"]
    );
}

/// 名前・欄の見せ方の JSON Schema（正本）と、本体の決まりがそろっている
#[test]
fn terms_and_fields_schema_files_match_the_rules() {
    let read = |n: &str| -> serde_json::Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../app/schemas/{n}"));
        serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
    };
    let t = read("settings.terms.json");
    assert_eq!(t["properties"]["schema"]["pattern"], json!("^terms@1\\.0$"));
    assert_eq!(t["additionalProperties"], json!(false));
    let row = &t["$defs"]["row"];
    assert_eq!(row["additionalProperties"], json!(false));
    assert_eq!(row["required"], json!(["id", "name", "basedOn"]));
    assert_eq!(
        row["properties"]["name"]["maxLength"],
        json!(terms::NAME_MAX_CHARS)
    );
    assert!(
        row["properties"]["name"]["pattern"]
            .as_str()
            .unwrap()
            .contains("\\u000A"),
        "名前は改行を受け付けない"
    );
    let f = read("settings.fields.json");
    assert_eq!(
        f["properties"]["schema"]["pattern"],
        json!("^fields@1\\.0$")
    );
    assert_eq!(f["additionalProperties"], json!(false));
    let row = &f["$defs"]["row"];
    assert_eq!(
        row["additionalProperties"],
        json!(false),
        "既定の値（default など）は Schema でも受け付けない"
    );
    let mut props: Vec<&String> = row["properties"].as_object().unwrap().keys().collect();
    props.sort();
    assert_eq!(props, vec!["hide", "id", "order"]);
    assert_eq!(
        row["properties"]["order"]["maximum"],
        json!(fields::ORDER_MAX)
    );
    assert_eq!(row["properties"]["hide"]["const"], json!(true));
}

/// 結果の画面の文（`result:…`。0212）: 差し込みの印つきの公式の文。知らない印は承認できず、計算の値の入る印を落とした書き換えは注意（承認はできる）。
/// アプリの更新で公式の文が変わったときは、ほかの文と同じく使い続けて知らせる
fn result_entry(id: &str, text: &str, vars: &[&str], numbers: &[&str]) -> serde_json::Value {
    let mut v = entry(id, text, &[Op::Replace]);
    v["audience"] = json!("customer");
    v["vars"] = json!(vars);
    v["numberVars"] = json!(numbers);
    v["varsHelp"] = json!(vars
        .iter()
        .map(|n| (n.to_string(), json!(format!("{n} の意味"))))
        .collect::<serde_json::Map<_, _>>());
    v
}

#[test]
fn result_texts_check_placeholders_and_follow_updates() {
    let old = catalog_of(vec![
        result_entry(
            "result:invest/verdict",
            "{plan}では、金融資産は {age} まで持ちます",
            &["plan", "age"],
            &["age"],
        ),
        result_entry(
            "result:invest/conditionNone",
            "足りない年だけ取り崩す場合",
            &[],
            &[],
        ),
    ]);
    let e = old.get("result:invest/verdict").unwrap();
    assert_eq!(e.number_vars, vec!["age".to_owned()]);
    assert_eq!(
        e.vars_help.get("age").map(String::as_str),
        Some("age の意味")
    );
    let env = Env::new("result");
    let h = hash(&old, "result:invest/verdict");
    // 知らない印は誤り（承認できない）
    env.write(&file(vec![json!({ "id": "result:invest/verdict", "do": "replace", "text": "{plan}は{years}年", "basedOn": h })]));
    let st = env.ctx(&old).status();
    assert!(
        codes(&st).contains(&"E_TEXTS_PLACEHOLDER"),
        "{:?}",
        st.errors
    );
    // 結果の画面の文は消せない（一覧の ops に hide が無い）
    env.write(&file(vec![
        json!({ "id": "result:invest/verdict", "do": "hide", "basedOn": h }),
    ]));
    assert!(codes(&env.ctx(&old).status()).contains(&"E_TEXTS_NOT_HIDEABLE"));
    // 計算の値の入る印 {age} を落とした書き換えは注意だけ（名前の {plan} は落としても注意しない）
    env.write(&file(vec![json!({ "id": "result:invest/verdict", "do": "replace", "text": "資産は長く持ちます", "basedOn": h })]));
    let st = env.ctx(&old).status();
    assert!(st.errors.is_empty(), "{:?}", st.errors);
    let warns: Vec<_> = st
        .warnings
        .iter()
        .map(|w| (w.code, w.message.clone()))
        .collect();
    assert!(
        warns.iter().any(|(c, m)| *c == "W_TEXTS_VAR_MISSING"
            && m.contains("{age}")
            && !m.contains("{plan}")),
        "{warns:?}"
    );
    // 印を入れた書き換えは注意なし。承認すると効く
    env.write(&file(vec![
        json!({ "id": "result:invest/verdict", "do": "replace", "text": "{plan}の場合、金融資産が続くのは {age} までです", "basedOn": h }),
        json!({ "id": "result:invest/conditionNone", "do": "replace", "text": "予定を入れずに、不足の年だけ取り崩したとき", "basedOn": hash(&old, "result:invest/conditionNone") }),
    ]));
    let ctx = env.ctx(&old);
    let st = ctx.status();
    assert!(
        st.errors.is_empty() && st.warnings.is_empty(),
        "{:?} {:?}",
        st.errors,
        st.warnings
    );
    ctx.approve(&st.fingerprint, 1).unwrap();
    assert_eq!(ctx.effective().len(), 2);
    // アプリの更新で公式の文が変わった（取り崩しの条件の言い方を直した）: 使い続けて知らせる
    let new = catalog_of(vec![
        result_entry(
            "result:invest/verdict",
            "{plan}では、金融資産は {age} まで持ちます",
            &["plan", "age"],
            &["age"],
        ),
        result_entry(
            "result:invest/conditionNone",
            "取り崩しの予定を入れず、足りない年だけ取り崩す場合",
            &[],
            &[],
        ),
    ]);
    let st = env.ctx(&new).status();
    let up: Vec<_> = st
        .updates
        .iter()
        .map(|u| (u.id.as_str(), u.stopped))
        .collect();
    assert_eq!(up, vec![("result:invest/conditionNone", false)]);
    let eff: Vec<_> = st
        .effective
        .iter()
        .map(|e| (e.id.as_str(), e.official_changed))
        .collect();
    assert_eq!(
        eff,
        vec![
            ("result:invest/verdict", false),
            ("result:invest/conditionNone", true)
        ]
    );
}

#[test]
fn number_vars_must_be_listed_in_vars() {
    let bad = result_entry("result:x/y", "{age}まで", &["age"], &["years"]);
    let err =
        Catalog::parse(&json!({ "schema": catalog::CATALOG_SCHEMA, "entries": [bad] }).to_string())
            .unwrap_err();
    assert!(err.contains("numberVars"), "{err}");
}
