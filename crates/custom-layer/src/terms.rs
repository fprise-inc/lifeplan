//! 名前の差し替えの設定（カスタム層の `settings/terms.json`。0016 の 2026-11-02 の追記「名前の差し替え・隠す・並べ替え・推定の根拠の文」の1）。
//!
//! 入力の欄の名前（`field:…`）と、結果の表の行の名前（`row:…`）を、事務所の言い方に変える。表の行の名前は、FP の画面・お客さまに見せる画面・
//! 提案書・持ち帰り用のレポートのどこでも同じ名前にする（当てるのは画面の側。ここは検査だけ）。
//! 形の正本は JSON Schema（`app/schemas/settings.terms.json`）。行は `{ id, name, basedOn }` だけで、消す・足すは無い（名前は消せない）。
//!
//! 中では、説明の文の設定と同じ行の形（[`Row`]。`do` は replace、`text` は名前）にして、同じ承認・台帳・保存庫・更新の確かめを使う。

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::catalog::{Catalog, Op};
use crate::texts::{
    forbidden_char, id_shape_ok, is_fingerprint, issue, placeholders, read_top, BadBraces, Checked,
    Codes, Issue, Row, TextsFile,
};

/// 設定ファイルの場所（カスタム層の中）
pub const TERMS_PATH: &str = "settings/terms.json";
/// 書き方の版の頭（`terms@MAJOR.MINOR`）
pub const SCHEMA_PREFIX: &str = "terms@";
/// 名前の長さの上限（字）
pub const NAME_MAX_CHARS: usize = 40;
/// 行の数の上限
pub const MAX_ENTRIES: usize = 2000;

const CODES: Codes = Codes {
    size: "E_TERMS_SIZE",
    json: "E_TERMS_JSON",
    field: "E_TERMS_FIELD",
    schema: "E_TERMS_SCHEMA",
    entries: "E_TERMS_ENTRIES",
};

/// ファイルの1行（書く形）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TermRow {
    id: String,
    name: String,
    based_on: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct TermsOnDisk {
    schema: String,
    entries: Vec<TermRow>,
}

/// 承認した中身（保存庫のバイト列）を、中の形にする
pub fn parse_stored(bytes: &[u8]) -> Option<TextsFile> {
    let f: TermsOnDisk = serde_json::from_slice(bytes).ok()?;
    Some(TextsFile {
        schema: f.schema,
        entries: f
            .entries
            .into_iter()
            .map(|r| Row {
                id: r.id,
                op: Op::Replace,
                text: Some(r.name),
                based_on: r.based_on,
                order: None,
            })
            .collect(),
    })
}

/// アプリが書き直すときの形（2つの空白で字下げ。最後に改行）
pub fn to_bytes(f: &TextsFile) -> Vec<u8> {
    let d = TermsOnDisk {
        schema: f.schema.clone(),
        entries: f
            .entries
            .iter()
            .map(|r| TermRow {
                id: r.id.clone(),
                name: r.text.clone().unwrap_or_default(),
                based_on: r.based_on.clone(),
            })
            .collect(),
    };
    let mut v = serde_json::to_vec_pretty(&d).expect("設定の書き出し");
    v.push(b'\n');
    v
}

fn read_row(i: usize, v: &Value, errors: &mut Vec<Issue>) -> Option<Row> {
    let Some(o) = v.as_object() else {
        errors.push(issue(
            Some(i),
            None,
            "E_TERMS_ROW",
            "行が { … } の形になっていません",
        ));
        return None;
    };
    let id = o.get("id").and_then(Value::as_str);
    let mut ok = true;
    for k in o.keys() {
        if !matches!(k.as_str(), "id" | "name" | "basedOn") {
            ok = false;
            errors.push(issue(
                Some(i),
                id,
                "E_TERMS_FIELD",
                format!("知らない項目「{k}」があります（書けるのは id・name・basedOn。名前は消せません）"),
            ));
        }
    }
    let Some(id) = id else {
        errors.push(issue(Some(i), None, "E_TERMS_ID", "id がありません"));
        return None;
    };
    if !id_shape_ok(id) {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TERMS_ID",
            "id の形が違います（名前の一覧の id をそのまま写してください）",
        ));
        return None;
    }
    let Some(name) = o.get("name").and_then(Value::as_str) else {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TERMS_NAME",
            "name（事務所の名前）を文字で書いてください",
        ));
        return None;
    };
    if name.trim().is_empty() {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TERMS_NAME",
            "name が空です（名前は消せません。公式の名前に戻すときは行を消します）",
        ));
        return None;
    }
    let Some(based_on) = o
        .get("basedOn")
        .and_then(Value::as_str)
        .filter(|s| is_fingerprint(s))
    else {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_TERMS_BASED_ON",
            "basedOn には、名前の一覧の hash（sha256:…）を写してください",
        ));
        return None;
    };
    ok.then(|| Row {
        id: id.to_owned(),
        op: Op::Replace,
        text: Some(name.to_owned()),
        based_on: based_on.to_owned(),
        order: None,
    })
}

/// 設定ファイルのバイト列を読んで、形と名前の一覧に照らして確かめる
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
    let mut shape_ok = out.errors.is_empty();
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
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
                "E_TERMS_DUPLICATE",
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

fn check_row(i: usize, r: &Row, catalog: &Catalog, out: &mut Checked) {
    let id = Some(r.id.as_str());
    let name = r.text.as_deref().unwrap_or("");
    if name.chars().any(|c| c == '\n' || forbidden_char(c)) {
        out.errors.push(issue(
            Some(i),
            id,
            "E_TERMS_CHAR",
            "名前に使えない字（改行・制御文字・文字の向きを変える字）が入っています",
        ));
    }
    let n = name.chars().count();
    if n > NAME_MAX_CHARS {
        out.errors.push(issue(
            Some(i),
            id,
            "E_TERMS_LENGTH",
            format!("長すぎます（{n}字。名前は{NAME_MAX_CHARS}字まで）"),
        ));
    }
    let Some((e, moved)) = catalog.resolve(&r.id) else {
        out.unused.push(r.id.clone());
        return;
    };
    match placeholders(name) {
        Err(BadBraces) => out.errors.push(issue(
            Some(i),
            id,
            "E_TERMS_PLACEHOLDER",
            "括弧 { } の書き方が違います（字のまま出すときは {{ と }}）",
        )),
        Ok(names) => {
            for v in &names {
                if !e.vars.contains(v) {
                    out.errors.push(issue(
                        Some(i),
                        id,
                        "E_TERMS_PLACEHOLDER",
                        format!("この名前では使えない差し込みの印 {{{v}}} があります"),
                    ));
                }
            }
            for v in &e.vars {
                if !names.contains(v) {
                    out.warnings.push(issue(
                        Some(i),
                        id,
                        "W_TERMS_VARS",
                        format!(
                            "差し込みの印 {{{v}}} がありません（人ごとの行も、同じ名前になります）"
                        ),
                    ));
                }
            }
        }
    }
    if moved {
        out.warnings.push(issue(
            Some(i),
            id,
            "W_TERMS_MOVED",
            format!(
                "この id は {} に移りました（新しい id に直してください）",
                e.id
            ),
        ));
    }
    if r.based_on != e.hash {
        out.warnings.push(issue(
            Some(i),
            id,
            "W_TERMS_BASED_ON",
            "書いたときの公式の名前と、今の公式の名前が違います（公式の名前が変わったか、basedOn の写し間違いです）",
        ));
    }
}
