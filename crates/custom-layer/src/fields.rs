//! 入力欄ごとの隠す・並べ替えの設定（カスタム層の `settings/fields.json`。0016 の 2026-11-02 の追記「名前の差し替え・隠す・並べ替え・推定の根拠の文」の2・3）。
//!
//! 行は `{ id, hide?, order? }`（`id` は欄の一覧の `field:…`）。決まり:
//! - 見せ方だけで、世帯の値と計算は変えない（当てるのは画面の側。隠しても計算の要求はそのまま）。
//! - 値の入った欄は隠さない（隠す設定でも、値があれば出す。画面の側で守る。0083 の4と同じ考え方）。
//! - 既定の値は扱わない（事務所の既定値の画面で変える。置き場所を2つにしない）。`default`・`value` などの項目は誤りにして承認できない。
//!
//! 中では、説明の文の設定と同じ行の形（[`Row`]。隠すは `do` が hide、並べ替えだけは order）にして、同じ承認・台帳・保存庫を使う。

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::catalog::{kind_of, Catalog, Op};
use crate::texts::{id_shape_ok, issue, read_top, Checked, Codes, Issue, Row, TextsFile};

/// 設定ファイルの場所（カスタム層の中）
pub const FIELDS_PATH: &str = "settings/fields.json";
/// 書き方の版の頭（`fields@MAJOR.MINOR`）
pub const SCHEMA_PREFIX: &str = "fields@";
/// 何番目に出すかの上限
pub const ORDER_MAX: u32 = 99;
/// 行の数の上限
pub const MAX_ENTRIES: usize = 2000;

const CODES: Codes = Codes {
    size: "E_FIELDS_SIZE",
    json: "E_FIELDS_JSON",
    field: "E_FIELDS_FIELD",
    schema: "E_FIELDS_SCHEMA",
    entries: "E_FIELDS_ENTRIES",
};

/// 既定の値を書こうとした項目（受け付けない。事務所の既定値の画面で変える）
const DEFAULT_KEYS: &[&str] = &[
    "default",
    "defaults",
    "defaultValue",
    "value",
    "values",
    "initial",
    "initialValue",
];

/// 既定の値を書いたときの文
pub const DEFAULT_MESSAGE: &str = "既定の値はカスタム層では変えられません。アプリの「事務所の既定値」の画面で変えてください（このファイルに書けるのは、隠す hide と並べ替え order だけです）";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FieldRow {
    id: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    hide: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    order: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FieldsOnDisk {
    schema: String,
    entries: Vec<FieldRow>,
}

fn row_of(id: String, hide: bool, order: Option<u32>) -> Row {
    Row {
        id,
        op: if hide { Op::Hide } else { Op::Order },
        text: None,
        based_on: String::new(),
        order,
    }
}

/// 承認した中身（保存庫のバイト列）を、中の形にする
pub fn parse_stored(bytes: &[u8]) -> Option<TextsFile> {
    let f: FieldsOnDisk = serde_json::from_slice(bytes).ok()?;
    Some(TextsFile {
        schema: f.schema,
        entries: f
            .entries
            .into_iter()
            .map(|r| row_of(r.id, r.hide, r.order))
            .collect(),
    })
}

/// アプリが書き直すときの形（2つの空白で字下げ。最後に改行）
pub fn to_bytes(f: &TextsFile) -> Vec<u8> {
    let d = FieldsOnDisk {
        schema: f.schema.clone(),
        entries: f
            .entries
            .iter()
            .map(|r| FieldRow {
                id: r.id.clone(),
                hide: r.op == Op::Hide,
                order: r.order,
            })
            .collect(),
    };
    let mut v = serde_json::to_vec_pretty(&d).expect("設定の書き出し");
    v.push(b'\n');
    v
}

fn top_message(k: &str) -> Option<(&'static str, String)> {
    DEFAULT_KEYS
        .contains(&k)
        .then(|| ("E_FIELDS_DEFAULT", DEFAULT_MESSAGE.to_owned()))
}

fn read_row(i: usize, v: &Value, errors: &mut Vec<Issue>) -> Option<Row> {
    let Some(o) = v.as_object() else {
        errors.push(issue(
            Some(i),
            None,
            "E_FIELDS_ROW",
            "行が { … } の形になっていません",
        ));
        return None;
    };
    let id = o.get("id").and_then(Value::as_str);
    let mut ok = true;
    for k in o.keys() {
        if matches!(k.as_str(), "id" | "hide" | "order") {
            continue;
        }
        ok = false;
        match top_message(k) {
            Some((code, msg)) => errors.push(issue(Some(i), id, code, msg)),
            None => errors.push(issue(
                Some(i),
                id,
                "E_FIELDS_FIELD",
                format!("知らない項目「{k}」があります（書けるのは id・hide・order）"),
            )),
        }
    }
    let Some(id) = id else {
        errors.push(issue(Some(i), None, "E_FIELDS_ID", "id がありません"));
        return None;
    };
    if !id_shape_ok(id) {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_FIELDS_ID",
            "id の形が違います（欄の一覧の id をそのまま写してください）",
        ));
        return None;
    }
    if kind_of(id) != "field" {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_FIELDS_ID",
            "隠す・並べ替えができるのは入力の欄（field:…）だけです",
        ));
        return None;
    }
    let hide = match o.get("hide") {
        None => false,
        Some(Value::Bool(true)) => true,
        Some(_) => {
            errors.push(issue(
                Some(i),
                Some(id),
                "E_FIELDS_HIDE",
                "hide は true だけ書けます（出すときは hide を書きません）",
            ));
            return None;
        }
    };
    let order = match o.get("order") {
        None => None,
        Some(v) => {
            match v
                .as_u64()
                .filter(|n| (1..=u64::from(ORDER_MAX)).contains(n))
            {
                Some(n) => Some(n as u32),
                None => {
                    errors.push(issue(
                    Some(i),
                    Some(id),
                    "E_FIELDS_ORDER",
                    format!("order は、まとまりの中で何番目に出すかを 1〜{ORDER_MAX} の整数で書きます"),
                ));
                    return None;
                }
            }
        }
    };
    if !hide && order.is_none() {
        errors.push(issue(
            Some(i),
            Some(id),
            "E_FIELDS_EMPTY",
            "hide か order のどちらかを書いてください",
        ));
        return None;
    }
    ok.then(|| row_of(id.to_owned(), hide, order))
}

/// 設定ファイルのバイト列を読んで、形と欄の一覧に照らして確かめる
pub fn check(bytes: &[u8], catalog: &Catalog) -> Checked {
    let mut out = Checked::default();
    let Some((schema, list)) = read_top(
        bytes,
        SCHEMA_PREFIX,
        &CODES,
        MAX_ENTRIES,
        &top_message,
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
                "E_FIELDS_DUPLICATE",
                "同じ id の行が2つあります（1つにまとめてください）",
            ));
        }
        match catalog.resolve(&r.id) {
            None => out.unused.push(r.id.clone()),
            Some((e, moved)) => {
                if r.op == Op::Hide && !e.ops.contains(&Op::Hide) {
                    out.errors.push(issue(
                        Some(i),
                        Some(&r.id),
                        "E_FIELDS_NOT_HIDEABLE",
                        "この欄は隠せません",
                    ));
                }
                if r.order.is_some() && !e.ops.contains(&Op::Order) {
                    out.errors.push(issue(
                        Some(i),
                        Some(&r.id),
                        "E_FIELDS_OP",
                        "この欄は並べ替えられません",
                    ));
                }
                if moved {
                    out.warnings.push(issue(
                        Some(i),
                        Some(&r.id),
                        "W_FIELDS_MOVED",
                        format!(
                            "この id は {} に移りました（新しい id に直してください）",
                            e.id
                        ),
                    ));
                }
            }
        }
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
