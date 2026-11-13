//! 説明の文の差し替えの設定（カスタム層の `settings/texts.json`。0016 の 2026-11-01 の追記の1・3・4）の読み込みと検査。
//!
//! 形の正本は JSON Schema（`app/schemas/settings.texts.json`）。本体は同じ決まりをここで確かめる（汎用の JSON Schema の部品は入れない。
//! 誤りの文を FP に読める日本語で出すため）。Schema とここの決まりが合っていることはテストで確かめる。
//!
//! 承認できない誤り（errors）: 形の誤り・同じ `id` の行が2つ・受け付けない字・長さの上限・知らない差し込みの印・その文にできない操作
//! （消せない文の `hide` を含む）。一覧に無い `id` の行は誤りにせず「使われていない行」に回す（unused）。

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::catalog::{kind_of, max_chars, never_hidden, Catalog, Op};

/// 設定ファイルの場所（カスタム層の中）
pub const TEXTS_PATH: &str = "settings/texts.json";
/// 書き方の版の頭（`texts@MAJOR.MINOR`。0001）
pub const SCHEMA_PREFIX: &str = "texts@";
/// このアプリが読める版（MAJOR は 1、MINOR は 0 まで）
pub const SCHEMA_MAJOR: u32 = 1;
pub const SCHEMA_MINOR_MAX: u32 = 0;
/// ファイルの大きさの上限（バイト）
pub const MAX_BYTES: usize = 256 * 1024;
/// 行の数の上限
pub const MAX_ENTRIES: usize = 2000;
/// `id` の長さの上限（字）
pub const ID_MAX_CHARS: usize = 200;

/// 設定の1行
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    #[serde(rename = "do")]
    pub op: Op,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 書いたときの公式の文の指紋（欄の見せ方の設定には無い。空）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub based_on: String,
    /// まとまりの中で何番目に出すか（欄の見せ方の設定だけ。1 から）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

/// 設定ファイルの中身
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextsFile {
    pub schema: String,
    pub entries: Vec<Row>,
}

impl TextsFile {
    /// アプリが書き直すときの形（2つの空白で字下げ。最後に改行）
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v = serde_json::to_vec_pretty(self).expect("設定の書き出し");
        v.push(b'\n');
        v
    }
}

/// 誤り・注意の1件
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// 何行目か（0 から。ファイル全体のときは無し）
    pub row: Option<usize>,
    pub id: Option<String>,
    pub code: &'static str,
    /// FP 向けの文
    pub message: String,
}

/// 検査の結果
#[derive(Debug, Clone, Default)]
pub struct Checked {
    /// 形として読めた中身（読めなければ無し）
    pub file: Option<TextsFile>,
    /// 承認できない誤り
    pub errors: Vec<Issue>,
    /// 承認はできる注意（書いたときの公式の文が、今の公式の文と違う など）
    pub warnings: Vec<Issue>,
    /// 一覧に無い `id`（使われていない行。読み飛ばす）
    pub unused: Vec<String>,
}

impl Checked {
    pub fn ok(&self) -> bool {
        self.file.is_some() && self.errors.is_empty()
    }
}

pub(crate) fn issue(
    row: Option<usize>,
    id: Option<&str>,
    code: &'static str,
    message: impl Into<String>,
) -> Issue {
    Issue {
        row,
        id: id.map(str::to_owned),
        code,
        message: message.into(),
    }
}

/// 受け付けない字か（改行のほかの制御文字と、文字の向きを変える字。0016 の追記の3）
pub fn forbidden_char(c: char) -> bool {
    (c.is_control() && c != '\n')
        || ('\u{202A}'..='\u{202E}').contains(&c)
        || ('\u{2066}'..='\u{2069}').contains(&c)
}

/// 括弧 `{ }` の書き方の誤り
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadBraces;

/// 文の中の差し込みの印（`{name}`）。`{{`・`}}` は字そのもの。閉じていない括弧・名前の形の誤りは Err
pub fn placeholders(text: &str) -> Result<Vec<String>, BadBraces> {
    let mut out = Vec::new();
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '{' if it.peek() == Some(&'{') => {
                it.next();
            }
            '}' if it.peek() == Some(&'}') => {
                it.next();
            }
            '}' => return Err(BadBraces),
            '{' => {
                let mut name = String::new();
                loop {
                    match it.next() {
                        Some('}') => break,
                        Some(x) if x.is_ascii_alphanumeric() || x == '_' => name.push(x),
                        _ => return Err(BadBraces),
                    }
                }
                if !name.starts_with(|x: char| x.is_ascii_alphabetic()) {
                    return Err(BadBraces);
                }
                out.push(name);
            }
            _ => {}
        }
    }
    Ok(out)
}

pub(crate) fn is_fingerprint(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(|h| {
        h.len() == 64
            && h.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// `id` の形（頭の英小文字＋「:」＋空白・制御文字を含まない字）
pub(crate) fn id_shape_ok(id: &str) -> bool {
    match id.split_once(':') {
        Some((k, rest)) => {
            !k.is_empty()
                && k.bytes().all(|b| b.is_ascii_lowercase())
                && !rest.is_empty()
                && !rest.chars().any(|c| c.is_whitespace() || c.is_control())
                && id.chars().count() <= ID_MAX_CHARS
        }
        None => false,
    }
}

/// このアプリより新しい MINOR か
fn minor_too_new(minor: u32) -> bool {
    minor > SCHEMA_MINOR_MAX
}

/// 版の文字（`texts@1.0`）を読む
pub(crate) fn schema_version(s: &str, prefix: &str) -> Option<(u32, u32)> {
    let v = s.strip_prefix(prefix)?;
    let (ma, mi) = v.split_once('.')?;
    let num = |x: &str| {
        (!x.is_empty()
            && x.bytes().all(|b| b.is_ascii_digit())
            && (x == "0" || !x.starts_with('0')))
        .then(|| x.parse::<u32>().ok())
        .flatten()
    };
    Some((num(ma)?, num(mi)?))
}

const OP_NAMES: &str = "replace（書き換える）・append（足す）・hide（消す）";

/// 1行を形として読む（誤りは errors に足し、読めなければ None）
fn read_row(i: usize, v: &Value, errors: &mut Vec<Issue>) -> Option<Row> {
    let Some(o) = v.as_object() else {
        errors.push(issue(
            Some(i),
            None,
            "E_TEXTS_ROW",
            "行が { … } の形になっていません",
        ));
        return None;
    };
    let id = o.get("id").and_then(Value::as_str);
    for k in o.keys() {
        if !matches!(k.as_str(), "id" | "do" | "text" | "basedOn") {
            errors.push(issue(
                Some(i),
                id,
                "E_TEXTS_FIELD",
                format!("知らない項目「{k}」があります（書けるのは id・do・text・basedOn）"),
            ));
        }
    }
    let Some(id) = id else {
        errors.push(issue(Some(i), None, "E_TEXTS_ID", "id がありません"));
        return None;
    };
    if !id_shape_ok(id) {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TEXTS_ID",
            "id の形が違います（説明の一覧の id をそのまま写してください）",
        ));
        return None;
    }
    let Some(op) = o.get("do").and_then(Value::as_str).and_then(Op::parse) else {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TEXTS_DO",
            format!("do は {OP_NAMES} のどれかにしてください"),
        ));
        return None;
    };
    let text = match o.get("text") {
        None => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => {
            errors.push(issue(
                Some(i),
                Some(id),
                "E_TEXTS_TEXT",
                "text は文字にしてください",
            ));
            return None;
        }
    };
    match (op, &text) {
        (Op::Hide, Some(_)) => {
            errors.push(issue(
                Some(i),
                Some(id),
                "E_TEXTS_TEXT",
                "消す行（hide）には text を書きません",
            ));
            return None;
        }
        (Op::Replace | Op::Append, None) => {
            errors.push(issue(
                Some(i),
                Some(id),
                "E_TEXTS_TEXT",
                "書き換える・足す行には text が要ります",
            ));
            return None;
        }
        (Op::Replace | Op::Append, Some(t)) if t.trim().is_empty() => {
            errors.push(issue(
                Some(i),
                Some(id),
                "E_TEXTS_TEXT",
                "text が空です（消すときは do を hide にします）",
            ));
            return None;
        }
        _ => {}
    }
    let Some(based_on) = o
        .get("basedOn")
        .and_then(Value::as_str)
        .filter(|s| is_fingerprint(s))
    else {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TEXTS_BASED_ON",
            "basedOn には、説明の一覧の hash（sha256:…）を写してください",
        ));
        return None;
    };
    Some(Row {
        id: id.to_owned(),
        op,
        text,
        based_on: based_on.to_owned(),
        order: None,
    })
}

/// ファイル全体の形の誤りの符号（種類ごと）
pub(crate) struct Codes {
    pub size: &'static str,
    pub json: &'static str,
    pub field: &'static str,
    pub schema: &'static str,
    pub entries: &'static str,
}

pub(crate) const CODES: Codes = Codes {
    size: "E_TEXTS_SIZE",
    json: "E_TEXTS_JSON",
    field: "E_TEXTS_FIELD",
    schema: "E_TEXTS_SCHEMA",
    entries: "E_TEXTS_ENTRIES",
};

/// ファイル全体の形（大きさ・UTF-8・JSON・`schema`・`entries`）を読む。行の並びと `schema` の字を返す（読めなければ None）。
/// schema・entries のほかの項目は誤り（`top_message` が符号と文を返せばそれを使う。既定の値の項目を断る文など）
pub(crate) fn read_top(
    bytes: &[u8],
    prefix: &str,
    codes: &Codes,
    max_entries: usize,
    top_message: &dyn Fn(&str) -> Option<(&'static str, String)>,
    out_errors: &mut Vec<Issue>,
) -> Option<(String, Vec<Value>)> {
    if bytes.len() > MAX_BYTES {
        out_errors.push(issue(
            None,
            None,
            codes.size,
            format!("ファイルが大きすぎます（{}KB まで）", MAX_BYTES / 1024),
        ));
        return None;
    }
    let Ok(s) = std::str::from_utf8(bytes) else {
        out_errors.push(issue(
            None,
            None,
            codes.json,
            "文字コードが UTF-8 ではありません",
        ));
        return None;
    };
    let v: Value = match serde_json::from_str(s.strip_prefix('\u{FEFF}').unwrap_or(s)) {
        Ok(v) => v,
        Err(e) => {
            out_errors.push(issue(
                None,
                None,
                codes.json,
                format!(
                    "JSON として読めません（{} 行目 {} 字目）",
                    e.line(),
                    e.column()
                ),
            ));
            return None;
        }
    };
    let Some(top) = v.as_object() else {
        out_errors.push(issue(
            None,
            None,
            codes.json,
            "全体が { … } の形になっていません",
        ));
        return None;
    };
    for k in top.keys() {
        if k != "schema" && k != "entries" {
            let (code, msg) = top_message(k).unwrap_or((
                codes.field,
                format!("知らない項目「{k}」があります（書けるのは schema・entries）"),
            ));
            out_errors.push(issue(None, None, code, msg));
        }
    }
    let schema = top.get("schema").and_then(Value::as_str).unwrap_or("");
    let current = format!("{prefix}{SCHEMA_MAJOR}.{SCHEMA_MINOR_MAX}");
    match schema_version(schema, prefix) {
        Some((SCHEMA_MAJOR, mi)) if !minor_too_new(mi) => {}
        Some((SCHEMA_MAJOR, _)) => {
            out_errors.push(issue(None, None, codes.schema, format!("このアプリより新しい書き方（{schema}）です。アプリを更新するか、{current} で書いてください")));
        }
        _ => {
            out_errors.push(issue(
                None,
                None,
                codes.schema,
                format!("schema は \"{current}\" にしてください"),
            ));
        }
    }
    let Some(list) = top.get("entries").and_then(Value::as_array) else {
        out_errors.push(issue(
            None,
            None,
            codes.entries,
            "entries（行の並び）がありません",
        ));
        return None;
    };
    if list.len() > max_entries {
        out_errors.push(issue(
            None,
            None,
            codes.entries,
            format!("行が多すぎます（{max_entries}行まで）"),
        ));
        return None;
    }
    Some((schema.to_owned(), list.clone()))
}

/// 設定ファイルのバイト列を読んで、形と説明の一覧に照らして確かめる
pub fn check(bytes: &[u8], catalog: &Catalog) -> Checked {
    let mut out = Checked::default();
    let Some((schema, list)) = read_top(
        bytes,
        SCHEMA_PREFIX,
        &CODES,
        MAX_ENTRIES,
        &|_| None,
        &mut out.errors,
    ) else {
        return out;
    };
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    let mut shape_ok = out.errors.is_empty();
    for (i, v) in list.iter().enumerate() {
        let before = out.errors.len();
        let Some(r) = read_row(i, v, &mut out.errors) else {
            shape_ok = false;
            continue;
        };
        if out.errors.len() > before {
            shape_ok = false;
        }
        if !seen.insert(r.id.clone()) {
            out.errors.push(issue(
                Some(i),
                Some(&r.id),
                "E_TEXTS_DUPLICATE",
                "同じ id の行が2つあります（1つにまとめてください）",
            ));
        }
        check_row(i, &r, catalog, &mut out);
        rows.push(r);
    }
    if shape_ok {
        out.file = Some(TextsFile {
            schema,
            entries: rows,
        });
    }
    out
}

/// 1行の中身を、字の決まりと説明の一覧に照らして確かめる
fn check_row(i: usize, r: &Row, catalog: &Catalog, out: &mut Checked) {
    let id = Some(r.id.as_str());
    let resolved = catalog.resolve(&r.id);
    let kind = resolved
        .map(|(e, _)| e.kind.as_str())
        .unwrap_or_else(|| kind_of(&r.id));
    if let Some(t) = &r.text {
        if t.chars().any(forbidden_char) {
            out.errors.push(issue(
                Some(i),
                id,
                "E_TEXTS_CHAR",
                "使えない字（改行のほかの制御文字・文字の向きを変える字）が入っています",
            ));
        }
        let n = t.chars().count();
        if n > max_chars(kind) {
            out.errors.push(issue(
                Some(i),
                id,
                "E_TEXTS_LENGTH",
                format!("長すぎます（{n}字。この文は{}字まで）", max_chars(kind)),
            ));
        }
    }
    // どの一覧でも消せない文（一覧に無い id でも、推定の根拠・確かめの注意は消せない）
    let notice_kind = resolved.and_then(|(e, _)| e.notice_kind.as_deref());
    if r.op == Op::Hide
        && never_hidden(kind, notice_kind)
        && (resolved.is_some() || kind != "notice")
    {
        out.errors.push(issue(
            Some(i),
            id,
            "E_TEXTS_NOT_HIDEABLE",
            not_hideable_message(kind),
        ));
        return;
    }
    let Some((e, moved)) = resolved else {
        out.unused.push(r.id.clone());
        return;
    };
    if !e.ops.contains(&r.op) {
        let msg = match r.op {
            Op::Hide => not_hideable_message(kind).to_owned(),
            _ => format!("この文には {} はできません", r.op.as_str()),
        };
        out.errors.push(issue(
            Some(i),
            id,
            if r.op == Op::Hide {
                "E_TEXTS_NOT_HIDEABLE"
            } else {
                "E_TEXTS_OP"
            },
            msg,
        ));
    }
    if let Some(t) = &r.text {
        match placeholders(t) {
            Err(BadBraces) => out.errors.push(issue(
                Some(i),
                id,
                "E_TEXTS_PLACEHOLDER",
                "括弧 { } の書き方が違います（字のまま出すときは {{ と }}）",
            )),
            Ok(names) => {
                for n in names {
                    if !e.vars.contains(&n) {
                        out.errors.push(issue(
                            Some(i),
                            id,
                            "E_TEXTS_PLACEHOLDER",
                            format!("この文では使えない差し込みの印 {{{n}}} があります"),
                        ));
                    }
                }
            }
        }
    }
    // 書き換えた文が、計算の値（年齢・年・額・率）の入る印を落としている（その値が画面に出なくなる。結果の画面の文。0212）。
    // 足す（append）は公式の文が残るので見ない
    if let (Op::Replace, Some(t)) = (r.op, &r.text) {
        if let Ok(names) = placeholders(t) {
            let missing: Vec<String> = e
                .number_vars
                .iter()
                .filter(|v| !names.contains(v))
                .map(|v| format!("{{{v}}}"))
                .collect();
            if !missing.is_empty() {
                out.warnings.push(issue(
                    Some(i),
                    id,
                    "W_TEXTS_VAR_MISSING",
                    format!(
                        "計算の値が入る差し込みの印 {} がありません（その値が画面に出なくなります。わざと外すのでなければ入れてください）",
                        missing.join("・")
                    ),
                ));
            }
        }
    }
    if moved {
        out.warnings.push(issue(
            Some(i),
            id,
            "W_TEXTS_MOVED",
            format!(
                "この id は {} に移りました（新しい id に直してください）",
                e.id
            ),
        ));
    }
    if r.based_on != e.hash {
        out.warnings.push(issue(Some(i), id, "W_TEXTS_BASED_ON", "書いたときの公式の文と、今の公式の文が違います（公式の文が変わったか、basedOn の写し間違いです）"));
    }
}

fn not_hideable_message(kind: &str) -> &'static str {
    match kind {
        "estimate" => "推定の根拠の文は消せません（値がどこから来たかを説明できなくなるため）。言い方は書き換えられます",
        "check" => "確かめの注意は消せません。言い方は書き換えられます",
        "notice" => "この知らせ（「入力が足りない」「計算に入れていない」）は消せません。結果に入っていない物に気づけなくなるため。言い方は書き換えられます",
        _ => "この文は消せません。言い方は書き換えられます",
    }
}
