//! 説明の一覧（0016 の 2026-11-01 の追記の2）: 書き換えられる公式の文を、`id` ごとに1件ずつ載せた一覧。
//! アプリのビルドが画面の定義から作り（`app/scripts/textsCatalog.ts`）、本体に埋め込む。
//! 名前の一覧（`terms-reference`。公式の名前）と、欄の一覧（`fields-reference`。隠す・並べ替えができる欄）も同じ形で読む
//! （0016 の 2026-11-02 の追記「名前の差し替え・隠す・並べ替え・推定の根拠の文」）。
//!
//! 1件の中身: `id`・`kind`・`where`（画面のどこの文か）・`audience`（`fp`／`customer`）・`text`（公式の文）・`vars`（差し込みの印）・
//! `hash`（`text` の SHA-256）・`ops`（できる操作）・任意の `formerIds`・`meaningChanged`・`noticeKind`（計算の知らせの種類）。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::fingerprint;

/// 一覧の書き方の版（説明の文）
pub const CATALOG_SCHEMA: &str = "texts-reference@1.0";
/// 名前の一覧の書き方の版
pub const TERMS_CATALOG_SCHEMA: &str = "terms-reference@1.0";
/// 欄の一覧（隠す・並べ替え）の書き方の版
pub const FIELDS_CATALOG_SCHEMA: &str = "fields-reference@1.0";

/// 文にできる操作（設定の行の `do`）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    /// 書き換える（公式の文が無い所に書けば、説明を足す）
    Replace,
    /// 公式の文の後ろに段落を足す
    Append,
    /// 消す（説明なら「?」ごと出さない。欄の見せ方の設定では、値の無い欄を隠す）
    Hide,
    /// 並べ替える（欄の見せ方の設定だけ）
    Order,
}

impl Op {
    /// 説明の文の設定の `do` を読む（並べ替えは説明の文には無い）
    pub fn parse(s: &str) -> Option<Op> {
        match s {
            "replace" => Some(Op::Replace),
            "append" => Some(Op::Append),
            "hide" => Some(Op::Hide),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Op::Replace => "replace",
            Op::Append => "append",
            Op::Hide => "hide",
            Op::Order => "order",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub kind: String,
    #[serde(rename = "where")]
    pub place: String,
    pub audience: String,
    pub text: String,
    #[serde(default)]
    pub vars: Vec<String>,
    pub hash: String,
    pub ops: Vec<Op>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub former_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub meaning_changed: bool,
    /// 計算の知らせの種類（`input`・`missing`・`outside`・`assumed`・`data`。0064 の2）。知らせのときだけ
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice_kind: Option<String>,
}

#[derive(Deserialize)]
struct CatalogFile {
    schema: String,
    entries: Vec<CatalogEntry>,
}

/// 説明の一覧
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    /// 一覧の書き方の版（どの種類の一覧か）
    pub schema: String,
    by_id: BTreeMap<String, CatalogEntry>,
    /// 前の `id` → 今の `id`（`formerIds`）
    former: BTreeMap<String, String>,
}

/// `id` の頭（`field:…` の `field`）
pub fn kind_of(id: &str) -> &str {
    id.split_once(':').map(|(k, _)| k).unwrap_or("")
}

/// 説明の文（長い文を書ける種類）か
pub fn is_explanation(kind: &str) -> bool {
    matches!(kind, "field" | "section" | "action" | "item" | "level")
}

/// 文の長さの上限（字。0016 の追記の3）: 説明は1,000字、知らせ・確かめの注意・推定の根拠・提示層の文は300字
pub fn max_chars(kind: &str) -> usize {
    if is_explanation(kind) {
        1000
    } else {
        300
    }
}

/// どの一覧の中身でも消せない文か（0016 の追記の4）。推定の根拠・確かめの注意と、「入力が足りない」「計算に入れていない」の知らせ。
/// 言い方は変えられる（書き換え・足すはできる）
pub fn never_hidden(kind: &str, notice_kind: Option<&str>) -> bool {
    match kind {
        "estimate" | "check" => true,
        "notice" => !matches!(notice_kind, Some("outside" | "assumed" | "data")),
        _ => false,
    }
}

impl Catalog {
    /// 一覧の JSON を読む。形・指紋・消せない文の決まりが崩れていたら誤り（ビルドの誤りなので、テストで止める）
    pub fn parse(json: &str) -> Result<Catalog, String> {
        let f: CatalogFile =
            serde_json::from_str(json).map_err(|e| format!("説明の一覧を読めません: {e}"))?;
        if ![CATALOG_SCHEMA, TERMS_CATALOG_SCHEMA, FIELDS_CATALOG_SCHEMA]
            .contains(&f.schema.as_str())
        {
            return Err(format!("説明の一覧の版が違います: {}", f.schema));
        }
        let mut c = Catalog {
            schema: f.schema.clone(),
            ..Catalog::default()
        };
        for e in f.entries {
            if kind_of(&e.id) != e.kind || e.kind.is_empty() {
                return Err(format!("id と kind が合いません: {}", e.id));
            }
            if e.hash != fingerprint(e.text.as_bytes()) {
                return Err(format!("指紋が文と合いません: {}", e.id));
            }
            if e.ops.contains(&Op::Hide) && never_hidden(&e.kind, e.notice_kind.as_deref()) {
                return Err(format!("消せない文に hide が付いています: {}", e.id));
            }
            if e.audience != "fp" && e.audience != "customer" {
                return Err(format!("audience が違います: {}", e.id));
            }
            for old in &e.former_ids {
                c.former.insert(old.clone(), e.id.clone());
            }
            if c.by_id.insert(e.id.clone(), e).is_some() {
                return Err("同じ id が2つあります".into());
            }
        }
        Ok(c)
    }

    pub fn get(&self, id: &str) -> Option<&CatalogEntry> {
        self.by_id.get(id)
    }

    /// 設定の行の `id` から一覧の1件を引く（無ければ `formerIds` で移った先）。2つめは移った先か
    pub fn resolve(&self, id: &str) -> Option<(&CatalogEntry, bool)> {
        if let Some(e) = self.by_id.get(id) {
            return Some((e, false));
        }
        let to = self.former.get(id)?;
        self.by_id.get(to).map(|e| (e, true))
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn entries(&self) -> impl Iterator<Item = &CatalogEntry> {
        self.by_id.values()
    }
}
