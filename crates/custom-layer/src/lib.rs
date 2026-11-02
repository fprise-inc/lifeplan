//! カスタム層の最小の仕組み（0016 の3・4・6、2026-11-01 の追記・2026-11-02 の追記）。
//!
//! 今動く種類は、設定のうち説明の文の差し替え（`settings/texts.json`）・名前の差し替え（`settings/terms.json`）・
//! 入力欄ごとの隠す・並べ替え（`settings/fields.json`）の3つ（[`Kind`]）。どれも同じ検査の流れ・指紋・承認の台帳・保存庫を使い、
//! 台帳の欄と保存庫のファイル名の頭が種類ごとに分かれている。計算部品（`modules/`）・帳票（`reports/`）・独自の入力欄（`fields/`）も、
//! 同じ台帳と保存庫に種類を足して載せる。
//!
//! 流れ:
//! 1. カスタム層のファイルを読み、形と説明の一覧に照らして確かめ（[`texts::check`]）、中身の指紋（SHA-256）を取る。
//! 2. 前に承認した指紋と違えば「承認待ち」。承認するまで、前に承認した中身（無ければ公式の文）だけが効く。
//!    AI がファイルを書いても、FP がアプリの画面で承認するまで効かない（0015 の追記の2段目と同じ考え方）。
//! 3. 承認すると、その中身を保存庫に置き（名前は指紋）、台帳に指紋を書く。台帳は改ざん検出付き（[`ledger`]）。
//! 4. 効く中身は、保存庫の中身（指紋を確かめた物）から作る。カスタム層のファイルを直接は使わない。
//! 5. アプリの更新で公式の文が変わったときは、行ごとに `basedOn` と一覧の `hash` を比べる（0016 の追記の7）。

pub mod catalog;
pub mod fields;
pub mod ledger;
pub mod location;
pub mod terms;
pub mod texts;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

pub use catalog::{Catalog, CatalogEntry, Op};
pub use texts::{Issue, Row, TextsFile};

/// カスタム層の設定の種類（同じ台帳と保存庫に種類を足す。2026-11-02 の追記）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// 説明の文の差し替え（`settings/texts.json`）
    Texts,
    /// 名前の差し替え（`settings/terms.json`）
    Terms,
    /// 入力欄ごとの隠す・並べ替え（`settings/fields.json`）
    Fields,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Texts, Kind::Terms, Kind::Fields];

    /// 保存庫のファイル名の頭・命令の引数の名前
    pub fn name(self) -> &'static str {
        match self {
            Kind::Texts => "texts",
            Kind::Terms => "terms",
            Kind::Fields => "fields",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.name() == s)
    }

    /// カスタム層の中のファイルの場所
    pub fn path(self) -> &'static str {
        match self {
            Kind::Texts => texts::TEXTS_PATH,
            Kind::Terms => terms::TERMS_PATH,
            Kind::Fields => fields::FIELDS_PATH,
        }
    }

    fn check(self, bytes: &[u8], catalog: &Catalog) -> texts::Checked {
        match self {
            Kind::Texts => texts::check(bytes, catalog),
            Kind::Terms => terms::check(bytes, catalog),
            Kind::Fields => fields::check(bytes, catalog),
        }
    }

    /// 保存庫の中身を中の形にする
    fn parse_stored(self, bytes: &[u8]) -> Option<TextsFile> {
        match self {
            Kind::Texts => serde_json::from_slice(bytes).ok(),
            Kind::Terms => terms::parse_stored(bytes),
            Kind::Fields => fields::parse_stored(bytes),
        }
    }

    /// 中の形をファイルの形にする（更新の確かめの「このまま使う」「公式の文に戻す」で書き直すとき）
    fn to_bytes(self, f: &TextsFile) -> Vec<u8> {
        match self {
            Kind::Texts => f.to_bytes(),
            Kind::Terms => terms::to_bytes(f),
            Kind::Fields => fields::to_bytes(f),
        }
    }
}

/// 中身の指紋（`sha256:<16進>`）
pub fn fingerprint(bytes: &[u8]) -> String {
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// ファイルが無いときの指紋の代わり（「ファイルを消した」も変更として承認の対象にする）
pub const NO_FILE: &str = "none";

/// 本体の命令が返す誤りの符号
pub mod code {
    /// 画面に見せたときから、ファイルが変わった（もう一度見てから承認する）
    pub const CHANGED: &str = "E_CUSTOM_CHANGED";
    /// 誤りのある中身は承認できない
    pub const INVALID: &str = "E_CUSTOM_INVALID";
    /// 承認待ちが無い
    pub const NOTHING: &str = "E_CUSTOM_NOTHING";
    /// 承認待ちの変更があるので、先にそれを決める
    pub const PENDING: &str = "E_CUSTOM_PENDING";
    /// ファイルの読み書きができない
    pub const IO: &str = "E_CUSTOM_IO";
}

/// カスタム層の操作に要るもの
pub struct Context<'a> {
    /// どの設定か
    pub kind: Kind,
    /// 台帳と保存庫（データフォルダの中の `custom/`）
    pub store: ledger::Store,
    /// 台帳の改ざん検出の鍵（事務所の親鍵から導いた鍵）
    pub key: &'a [u8; 32],
    /// その種類の一覧（説明の一覧・名前の一覧・欄の一覧。本体に埋め込んだ物）
    pub catalog: &'a Catalog,
    /// カスタム層の既定の場所
    pub default_dir: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileState {
    None,
    Present,
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// ファイルも承認も無い（公式の文のまま）
    None,
    /// 承認した中身とファイルが同じ
    Approved,
    /// ファイルが承認した中身と違う（承認待ち）
    Pending,
    /// ファイルが承認した中身と違うが、承認しないと決めた中身
    Declined,
}

/// 文と操作
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowText {
    #[serde(rename = "do")]
    pub op: Op,
    pub text: Option<String>,
    /// 何番目に出すか（欄の見せ方の設定だけ）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

/// 承認の画面の1行（公式の文／今の事務所の文／新しい文）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDiff {
    pub id: String,
    /// 画面のどこの文か（一覧に無い行は空）
    #[serde(rename = "where")]
    pub place: String,
    pub audience: Option<String>,
    pub official: Option<String>,
    /// 今効いている事務所の文（承認した中身の行）
    pub current: Option<RowText>,
    /// ファイルの新しい行
    pub next: Option<RowText>,
    pub changed: bool,
    /// 一覧に無い（使われていない行）
    pub unused: bool,
}

/// アプリの更新で公式の文が変わった行（承認した中身の行）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRow {
    /// 設定の行の id
    pub id: String,
    /// 今の一覧の id（`formerIds` で移ったときは新しい id）
    pub now_id: String,
    #[serde(rename = "where")]
    pub place: String,
    /// 承認したときの公式の文（分かるときだけ）
    pub before: Option<String>,
    /// 今の公式の文
    pub official: String,
    pub office: RowText,
    /// 確かめるまで事務所の文を止めている（公式の文を出している）
    pub stopped: bool,
    /// 止めた理由（`meaning`＝公式の側で意味が変わった・`vars`＝使っていた差し込みの印が無くなった・`op`＝その操作ができなくなった）
    pub reason: Option<&'static str>,
}

/// 画面に当てる事務所の文（承認した中身から作った物だけ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Effective {
    pub id: String,
    #[serde(rename = "do")]
    pub op: Op,
    pub text: Option<String>,
    /// 何番目に出すか（欄の見せ方の設定だけ）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// 当てる先の公式の文（画面は、今の公式の文がこれと同じときだけ当てる）
    pub official: String,
    /// 公式の説明が変わった（確かめるまで「事務所の文（公式の説明が変わりました）」の札）
    pub official_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedView {
    pub fingerprint: String,
    pub approved_at: i64,
}

/// 説明の文の設定の状態（承認の画面の材料。パスは入れない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextsStatus {
    pub kind: Kind,
    pub is_default_dir: bool,
    pub folder_exists: bool,
    pub file: FileState,
    /// 今のファイルの指紋（無ければ "none"）。承認・承認しないときに、見た中身の印として渡してもらう
    pub fingerprint: String,
    pub state: State,
    pub errors: Vec<Issue>,
    pub warnings: Vec<Issue>,
    pub unused: Vec<String>,
    pub approved: Option<ApprovedView>,
    /// 台帳を確かめられなかったので、承認を無効にした
    pub ledger_reset: bool,
    /// 台帳にある承認の中身が保存庫に無い・指紋が合わない（公式の文を出している）
    pub approved_missing: bool,
    pub rows: Vec<RowDiff>,
    pub updates: Vec<UpdateRow>,
    pub effective: Vec<Effective>,
    /// 一覧の件数（いまのアプリで書き換えられる文の数）
    pub catalog_size: usize,
}

/// 読んだもの一式
struct Snapshot {
    loaded: ledger::Loaded,
    dir: PathBuf,
    file: FileState,
    bytes: Option<Vec<u8>>,
    fp: String,
    checked: texts::Checked,
    /// 効いている承認（中身が保存庫で確かめられた物）
    approved: Option<(ledger::Approval, TextsFile)>,
    approved_missing: bool,
    state: State,
}

/// カスタム層の場所（台帳に選んだ場所が無ければ既定の場所）
pub fn custom_dir(body: &ledger::LedgerBody, default: &Path) -> PathBuf {
    body.custom_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| default.to_path_buf())
}

impl Context<'_> {
    fn snapshot(&self) -> Snapshot {
        let loaded = self.store.load(self.key);
        let dir = custom_dir(&loaded.body, &self.default_dir);
        let path = dir.join(self.kind.path());
        let (file, bytes) = match fs::read(&path) {
            Ok(b) => (FileState::Present, Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (FileState::None, None),
            Err(_) => (FileState::Unreadable, None),
        };
        let fp = bytes
            .as_deref()
            .map(fingerprint)
            .unwrap_or_else(|| NO_FILE.to_owned());
        let checked = bytes
            .as_deref()
            .map(|b| self.kind.check(b, self.catalog))
            .unwrap_or_default();
        let mut approved_missing = false;
        let approved = loaded.body.approval(self.kind).and_then(|a| {
            let got = self
                .store
                .get_approved(self.kind.name(), &a.fingerprint)
                .and_then(|b| self.kind.parse_stored(&b));
            if got.is_none() {
                approved_missing = true;
            }
            got.map(|f| (a.clone(), f))
        });
        let approved_fp = loaded
            .body
            .approval(self.kind)
            .map(|a| a.fingerprint.as_str())
            .unwrap_or(NO_FILE);
        // 読めないファイルは変更と見なさない（前に承認した中身のまま）
        let unchanged = file == FileState::Unreadable || fp == approved_fp;
        let state = if unchanged {
            if loaded.body.approval(self.kind).is_some() {
                State::Approved
            } else {
                State::None
            }
        } else if loaded.body.declined(self.kind) == Some(fp.as_str()) {
            State::Declined
        } else {
            State::Pending
        };
        Snapshot {
            loaded,
            dir,
            file,
            bytes,
            fp,
            checked,
            approved,
            approved_missing,
            state,
        }
    }

    /// 今のカスタム層の場所
    pub fn dir(&self) -> PathBuf {
        custom_dir(&self.store.load(self.key).body, &self.default_dir)
    }

    /// 説明の文の設定の状態
    pub fn status(&self) -> TextsStatus {
        let s = self.snapshot();
        let approved_rows = s
            .approved
            .as_ref()
            .map(|(_, f)| f.entries.clone())
            .unwrap_or_default();
        let next_rows = s.checked.file.as_ref().map(|f| f.entries.clone());
        let (updates, effective) = self.resolve(s.approved.as_ref());
        TextsStatus {
            kind: self.kind,
            is_default_dir: s.loaded.body.custom_dir.is_none(),
            folder_exists: s.dir.is_dir(),
            file: s.file,
            fingerprint: s.fp.clone(),
            state: s.state,
            errors: s.checked.errors.clone(),
            warnings: s.checked.warnings.clone(),
            unused: s.checked.unused.clone(),
            approved: s.loaded.body.approval(self.kind).map(|a| ApprovedView {
                fingerprint: a.fingerprint.clone(),
                approved_at: a.approved_at,
            }),
            ledger_reset: s.loaded.reset,
            approved_missing: s.approved_missing,
            rows: self.diff(
                &approved_rows,
                next_rows
                    .as_deref()
                    .unwrap_or(if s.file == FileState::None {
                        &[]
                    } else {
                        &approved_rows
                    }),
            ),
            updates,
            effective,
            catalog_size: self.catalog.len(),
        }
    }

    /// 画面に当てる事務所の文だけ
    pub fn effective(&self) -> Vec<Effective> {
        let s = self.snapshot();
        self.resolve(s.approved.as_ref()).1
    }

    fn diff(&self, current: &[Row], next: &[Row]) -> Vec<RowDiff> {
        let cur: BTreeMap<&str, &Row> = current.iter().map(|r| (r.id.as_str(), r)).collect();
        let mut seen = BTreeSet::new();
        let text = |r: &Row| RowText {
            op: r.op,
            text: r.text.clone(),
            order: r.order,
        };
        let mut out = Vec::new();
        for id in next
            .iter()
            .map(|r| r.id.as_str())
            .chain(current.iter().map(|r| r.id.as_str()))
        {
            if !seen.insert(id) {
                continue;
            }
            let entry = self.catalog.resolve(id).map(|(e, _)| e);
            let c = cur.get(id).map(|r| text(r));
            let n = next.iter().find(|r| r.id == id).map(text);
            out.push(RowDiff {
                id: id.to_owned(),
                place: entry.map(|e| e.place.clone()).unwrap_or_default(),
                audience: entry.map(|e| e.audience.clone()),
                official: entry.map(|e| e.text.clone()),
                changed: c != n,
                current: c,
                next: n,
                unused: entry.is_none(),
            });
        }
        // お客さまに見える文を先に（0016 の追記の5）
        out.sort_by_key(|r| r.audience.as_deref() != Some("customer"));
        out
    }

    /// 承認した中身から、更新で変わった行と、画面に当てる事務所の文を作る（0016 の追記の7）
    fn resolve(
        &self,
        approved: Option<&(ledger::Approval, TextsFile)>,
    ) -> (Vec<UpdateRow>, Vec<Effective>) {
        let mut updates = Vec::new();
        let mut effective = Vec::new();
        let Some((a, f)) = approved else {
            return (updates, effective);
        };
        for r in &f.entries {
            let Some((e, moved)) = self.catalog.resolve(&r.id) else {
                continue;
            };
            // 欄の見せ方の設定は公式の文に拠らない（basedOn が無い）
            let changed = !r.based_on.is_empty() && r.based_on != e.hash;
            let vars_ok = r
                .text
                .as_deref()
                .map(|t| texts::placeholders(t).is_ok_and(|n| n.iter().all(|x| e.vars.contains(x))))
                .unwrap_or(true);
            let op_ok = e.ops.contains(&r.op)
                && !(r.op == Op::Hide && catalog::never_hidden(&e.kind, e.notice_kind.as_deref()));
            let reason = if !op_ok {
                Some("op")
            } else if !vars_ok {
                Some("vars")
            } else if changed && e.meaning_changed {
                Some("meaning")
            } else {
                None
            };
            if changed || moved || reason.is_some() {
                updates.push(UpdateRow {
                    id: r.id.clone(),
                    now_id: e.id.clone(),
                    place: e.place.clone(),
                    before: a.official.get(&r.id).cloned(),
                    official: e.text.clone(),
                    office: RowText {
                        op: r.op,
                        text: r.text.clone(),
                        order: r.order,
                    },
                    stopped: reason.is_some(),
                    reason,
                });
            }
            if reason.is_none() {
                effective.push(Effective {
                    id: e.id.clone(),
                    op: r.op,
                    text: r.text.clone(),
                    order: r.order,
                    official: e.text.clone(),
                    official_changed: changed || moved,
                });
            }
        }
        (updates, effective)
    }

    fn approval_for(&self, fp: &str, file: Option<&TextsFile>, now: i64) -> ledger::Approval {
        let official = file
            .map(|f| {
                f.entries
                    .iter()
                    .filter_map(|r| {
                        self.catalog
                            .get(&r.id)
                            .filter(|e| e.hash == r.based_on)
                            .map(|e| (r.id.clone(), e.text.clone()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        ledger::Approval {
            fingerprint: fp.to_owned(),
            approved_at: now,
            official,
        }
    }

    /// 承認待ちの中身を承認する。`fp` は画面に見せたときの指紋（その間にファイルが変わっていたら断る）
    pub fn approve(&self, fp: &str, now: i64) -> Result<TextsStatus, &'static str> {
        let s = self.snapshot();
        if s.fp != fp || s.file == FileState::Unreadable {
            return Err(code::CHANGED);
        }
        if !matches!(s.state, State::Pending | State::Declined) {
            return Err(code::NOTHING);
        }
        let mut body = s.loaded.body.clone();
        match &s.bytes {
            Some(b) => {
                if !s.checked.ok() {
                    return Err(code::INVALID);
                }
                self.store
                    .put_approved(self.kind.name(), b)
                    .map_err(|_| code::IO)?;
                *body.approval_mut(self.kind) =
                    Some(self.approval_for(fp, s.checked.file.as_ref(), now));
            }
            // ファイルを消した変更の承認: 事務所の文をやめて公式の文に戻す
            None => *body.approval_mut(self.kind) = None,
        }
        *body.declined_mut(self.kind) = None;
        self.store.save(self.key, &body).map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// 承認待ちの中身を承認しない（前に承認した中身のまま。同じ中身のあいだは承認待ちに出さない）
    pub fn decline(&self, fp: &str) -> Result<TextsStatus, &'static str> {
        let s = self.snapshot();
        if s.fp != fp {
            return Err(code::CHANGED);
        }
        if s.state != State::Pending {
            return Err(code::NOTHING);
        }
        let mut body = s.loaded.body.clone();
        *body.declined_mut(self.kind) = Some(fp.to_owned());
        self.store.save(self.key, &body).map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// 事務所の文を全部やめて、公式の文に戻す（今のファイルは承認しないことにする。ファイルは消さない）
    pub fn revert(&self) -> Result<TextsStatus, &'static str> {
        let s = self.snapshot();
        let mut body = s.loaded.body.clone();
        *body.approval_mut(self.kind) = None;
        *body.declined_mut(self.kind) = (s.fp != NO_FILE).then(|| s.fp.clone());
        self.store.save(self.key, &body).map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// 確かめられなかった台帳を作り直す（承認は無いまま。場所の選択も既定に戻る）
    pub fn reset_ledger(&self) -> Result<TextsStatus, &'static str> {
        self.store
            .save(self.key, &ledger::LedgerBody::default())
            .map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// 承認した中身の行を、アプリの画面で直す（更新の確かめの「このまま使う」「公式の文に戻す」）。
    /// アプリの画面での操作なので、直したファイルをそのまま承認する（0016 の6）。承認待ちの変更があるときは断る
    fn edit_rows(
        &self,
        now: i64,
        f: impl Fn(&Catalog, &mut Vec<Row>),
    ) -> Result<TextsStatus, &'static str> {
        let s = self.snapshot();
        if s.state != State::Approved {
            return Err(code::PENDING);
        }
        let Some((_, file)) = s.approved.clone() else {
            return Err(code::NOTHING);
        };
        let mut next = file.clone();
        f(self.catalog, &mut next.entries);
        let bytes = self.kind.to_bytes(&next);
        let checked = self.kind.check(&bytes, self.catalog);
        if !checked.ok() {
            return Err(code::INVALID);
        }
        let path = s.dir.join(self.kind.path());
        fs::create_dir_all(path.parent().expect("settings のフォルダ")).map_err(|_| code::IO)?;
        ledger::write_atomically(&path, &bytes).map_err(|_| code::IO)?;
        let fp = self
            .store
            .put_approved(self.kind.name(), &bytes)
            .map_err(|_| code::IO)?;
        let mut body = s.loaded.body.clone();
        *body.approval_mut(self.kind) = Some(self.approval_for(&fp, checked.file.as_ref(), now));
        *body.declined_mut(self.kind) = None;
        self.store.save(self.key, &body).map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// 「このまま使う」: 行の `basedOn` を今の公式の文の指紋にする（`formerIds` で移った行は新しい id に直す）
    pub fn keep_rows(&self, ids: &[String], now: i64) -> Result<TextsStatus, &'static str> {
        self.edit_rows(now, |c, rows| {
            for r in rows.iter_mut().filter(|r| ids.contains(&r.id)) {
                if let Some((e, _)) = c.resolve(&r.id) {
                    r.id = e.id.clone();
                    r.based_on = e.hash.clone();
                }
            }
        })
    }

    /// 「公式の文に戻す」（行ごと）: その行を外す
    pub fn drop_rows(&self, ids: &[String], now: i64) -> Result<TextsStatus, &'static str> {
        self.edit_rows(now, |_, rows| rows.retain(|r| !ids.contains(&r.id)))
    }

    /// カスタム層の場所を変える（None は既定に戻す）。`protected` と重なる場所は断る
    pub fn set_dir(
        &self,
        dir: Option<&Path>,
        protected: &[PathBuf],
    ) -> Result<TextsStatus, &'static str> {
        let mut body = self.store.load(self.key).body;
        body.custom_dir = match dir {
            Some(d) => Some(
                location::check(d, protected)?
                    .to_string_lossy()
                    .into_owned(),
            ),
            None => {
                location::check(&self.default_dir, protected)?;
                None
            }
        };
        self.store.save(self.key, &body).map_err(|_| code::IO)?;
        Ok(self.status())
    }

    /// カスタム層のフォルダと `settings/` を作る（AI が書く場所を用意する。中身は書かない）
    pub fn create_folder(&self, protected: &[PathBuf]) -> Result<TextsStatus, &'static str> {
        let dir = self.dir();
        location::check(&dir, protected)?;
        fs::create_dir_all(dir.join("settings")).map_err(|_| code::IO)?;
        Ok(self.status())
    }
}

#[cfg(test)]
mod tests;
