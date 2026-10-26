//! 縮約版と文章の包み方（0015 の6）。AIに世帯を渡す経路は、必ずこの1か所を通る。
//!
//! - **縮約版**（既定）: 計算の入力のうち、入力項目ID（0004）の許可リスト（`data/reduced-allowlist.json`）にある項目だけ。
//!   スキーマに無い項目・形の決まっていない文字列（人が書いた文章になりうるもの）は、許可リストにかかわらず外す。
//! - **文章の項目**（既定で外す。FPが項目ごとに足せる）: 計算の入力の中の見出し（`periodicExpense.label`）と、
//!   画面の側の文章（FPのメモ・顧客の相談内容・移行メモ・自由記述）。足したときは入力から抜き出して包み（`client_text`）、`texts` に並べる。
//! - **どの版でも渡さない**: 世帯の内部ID・表示用の顧客番号・呼び名・同意の記録の中身・取り込みの記録の元データへの参照など（足せない）。
//! - **物の ID の仮名**: 世帯の中の乱数ID（構成員・物）は、共有ごとに別の乱数IDに置き換える（同じ世帯の別の共有と結びつけられないように）。
//!   並びの順番は保つ（計算の結果の並びが変わらないように）。プランの候補の ID は戻してから「AIからの候補」に入れる。

use crate::schema::{self, constrained_string, location, x_item, Node};
use crate::source::SharedHouseholdSource;
use crate::wrap::wrap_client_text;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

const ALLOWLIST_JSON: &str = include_str!("../data/reduced-allowlist.json");

/// 計算の入力の中の文章の項目（入力項目ID と、誰が書いたか）。既定で外す
pub const TEXT_ITEMS: &[(&str, &str)] = &[
    ("periodicExpense.label", "FP（見出し）"),
    ("incomeFlow.label", "FP（見出し）"),
    ("transfer.label", "FP（見出し）"),
    ("debt.label", "FP（ローンの名前）"),
    ("retirementBenefit.label", "FP（退職給付の名前）"),
];

/// 画面の側の文章の項目。既定で外す
pub const SOURCE_TEXT_ITEMS: &[&str] =
    &["note.fp", "note.consultation", "note.import", "note.free"];

/// 入力項目IDの無い文字列のうち、アプリが作る決まった値（人が書かない）で、計算に要るもの。縮約版に残す
const SYSTEM_STRINGS: &[&str] = &[
    // 保険の年次の数表の出どころ（数表のパックへの参照と指紋）
    "urn:financia:schema:engine.input#/$defs/insuranceContract/properties/schedule/properties/source/properties/productRef",
    // 学費データから写した学校の行の出どころ（パックと版）・課程
    "urn:financia:schema:engine.input#/$defs/schoolTuition/properties/source/properties/pack",
    "urn:financia:schema:engine.input#/$defs/schoolTuition/properties/source/properties/version",
    "urn:financia:schema:engine.input#/$defs/schoolTuition/properties/track",
    // 事務所の標準の料金表から写した日時
    "urn:financia:schema:engine.input#/$defs/advisoryFee/properties/menu/properties/copiedFrom/properties/at",
    // 推定の根拠（統計名と年度。アプリが書く）
    "urn:financia:schema:common#/$defs/valueBoxMeta/properties/estimate/properties/basis",
];

/// 許可リストの版と項目
pub struct Allowlist {
    pub version: String,
    pub items: BTreeSet<String>,
}

pub fn allowlist() -> &'static Allowlist {
    static A: OnceLock<Allowlist> = OnceLock::new();
    A.get_or_init(|| {
        let v: Value =
            serde_json::from_str(ALLOWLIST_JSON).expect("許可リストが JSON ではありません");
        Allowlist {
            version: v["version"].as_str().unwrap_or("").to_owned(),
            items: v["items"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        }
    })
}

/// 渡す範囲（0014 の `scope`）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    /// 縮約版（既定）
    Reduced,
    /// FPが項目を足した版（足せるのは文章の項目だけ）
    Custom { added: BTreeSet<String> },
}

impl Scope {
    pub fn name(&self) -> &'static str {
        match self {
            Scope::Reduced => "reduced",
            Scope::Custom { .. } => "custom",
        }
    }

    fn added(&self) -> HashSet<String> {
        match self {
            Scope::Reduced => HashSet::new(),
            Scope::Custom { added } => added.iter().cloned().collect(),
        }
    }
}

/// FPが足せる項目か（文章の項目だけ。それ以外は縮約版に入っているか、どの版でも渡さないもの）
pub fn is_addable(item: &str) -> bool {
    TEXT_ITEMS.iter().any(|(i, _)| *i == item) || SOURCE_TEXT_ITEMS.contains(&item)
}

/// 縮約した結果（AIに渡す形の元）
#[derive(Debug, Clone)]
pub struct Reduced {
    /// 縮約した計算の入力（物の ID は仮名）。エンジンへの要求の `input` としてそのまま計算できる
    pub input: Value,
    /// 包んだ文章（足したときだけ）
    pub texts: Vec<Value>,
    /// 渡した項目の一覧（入力項目IDと文章の項目。0014 の `fields`）
    pub fields: Vec<String>,
}

/// 共有ごとの物の ID の仮名（共有の間は同じ）
#[derive(Debug, Clone, Default)]
pub struct Pseudonyms {
    fwd: HashMap<String, String>,
    back: HashMap<String, String>,
}

impl Pseudonyms {
    /// 世帯の中の乱数IDを集め、並びの順番を保って新しい乱数IDを振る
    pub fn for_input(input: &Value) -> Pseudonyms {
        let mut ids = BTreeSet::new();
        collect_uuids(input, &mut ids);
        let mut fresh: Vec<String> = Vec::with_capacity(ids.len());
        let mut seen = HashSet::new();
        while fresh.len() < ids.len() {
            let u = random_uuid_v4();
            if !ids.contains(&u) && seen.insert(u.clone()) {
                fresh.push(u);
            }
        }
        fresh.sort();
        let mut p = Pseudonyms::default();
        for (orig, alias) in ids.into_iter().zip(fresh) {
            p.back.insert(alias.clone(), orig.clone());
            p.fwd.insert(orig, alias);
        }
        p
    }

    fn alias(&mut self, orig: &str) -> String {
        if let Some(a) = self.fwd.get(orig) {
            return a.clone();
        }
        // 共有の後に足された物
        let mut a = random_uuid_v4();
        while self.back.contains_key(&a) || a == orig {
            a = random_uuid_v4();
        }
        self.fwd.insert(orig.to_owned(), a.clone());
        self.back.insert(a.clone(), orig.to_owned());
        a
    }

    /// 仮名から元の ID へ（知らない仮名は None）
    pub fn original(&self, alias: &str) -> Option<&str> {
        self.back.get(alias).map(String::as_str)
    }

    fn apply(&mut self, v: &Value) -> Value {
        match v {
            Value::String(s) if is_uuid(s) => Value::String(self.alias(s)),
            Value::Array(a) => Value::Array(a.iter().map(|x| self.apply(x)).collect()),
            Value::Object(m) => {
                let mut out = Map::new();
                for (k, x) in m {
                    let k2 = if is_uuid(k) { self.alias(k) } else { k.clone() };
                    out.insert(k2, self.apply(x));
                }
                Value::Object(out)
            }
            other => other.clone(),
        }
    }

    /// プランの候補の値の中の仮名を元の ID に戻す。知らない乱数IDがあれば Err（その ID）
    pub fn restore(&self, v: &Value) -> Result<Value, String> {
        match v {
            Value::String(s) if is_uuid(s) => self
                .original(s)
                .map(|o| Value::String(o.to_owned()))
                .ok_or_else(|| s.clone()),
            Value::Array(a) => a
                .iter()
                .map(|x| self.restore(x))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Value::Object(m) => {
                let mut out = Map::new();
                for (k, x) in m {
                    let k2 = if is_uuid(k) {
                        self.original(k)
                            .map(str::to_owned)
                            .ok_or_else(|| k.clone())?
                    } else {
                        k.clone()
                    };
                    out.insert(k2, self.restore(x)?);
                }
                Ok(Value::Object(out))
            }
            other => Ok(other.clone()),
        }
    }
}

/// 乱数ID（UUID の形。小文字・ハイフンつきの36文字）か
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
        })
}

fn collect_uuids(v: &Value, out: &mut BTreeSet<String>) {
    match v {
        Value::String(s) if is_uuid(s) => {
            out.insert(s.clone());
        }
        Value::Array(a) => a.iter().for_each(|x| collect_uuids(x, out)),
        Value::Object(m) => {
            for (k, x) in m {
                if is_uuid(k) {
                    out.insert(k.clone());
                }
                collect_uuids(x, out);
            }
        }
        _ => {}
    }
}

/// UUID 第4版（0004 の4）
pub fn random_uuid_v4() -> String {
    let mut b = ai_ipc::random_bytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

struct PendingText {
    item: String,
    author: String,
    object: Option<String>,
    body: String,
}

struct Walk<'s> {
    schemas: &'s schema::Schemas,
    allow: &'s BTreeSet<String>,
    added: HashSet<String>,
    fields: BTreeSet<String>,
    texts: Vec<PendingText>,
}

impl<'s> Walk<'s> {
    fn value(&mut self, v: &Value, nodes: &[Node<'s>], owner: Option<&str>) -> Option<Value> {
        match v {
            Value::Object(m) => {
                let me = m
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|s| is_uuid(s))
                    .or(owner)
                    .map(str::to_owned);
                let mut out = Map::new();
                for (k, cv) in m {
                    let child = self.schemas.property(nodes, k);
                    if child.is_empty() {
                        continue; // スキーマに無い項目は渡さない
                    }
                    if let Some(item) = x_item(&child) {
                        if let Some((_, author)) = TEXT_ITEMS.iter().find(|(i, _)| *i == item) {
                            if self.added.contains(item) {
                                if let Some(body) = cv.as_str() {
                                    self.texts.push(PendingText {
                                        item: item.to_owned(),
                                        author: (*author).to_owned(),
                                        object: me.clone(),
                                        body: body.to_owned(),
                                    });
                                    self.fields.insert(item.to_owned());
                                }
                            }
                            continue;
                        }
                        if !self.allow.contains(item) {
                            continue;
                        }
                        self.fields.insert(item.to_owned());
                    }
                    if let Some(kept) = self.value(cv, &child, me.as_deref()) {
                        out.insert(k.clone(), kept);
                    }
                }
                Some(Value::Object(out))
            }
            Value::Array(a) => {
                let items = self.schemas.items(nodes);
                if items.is_empty() {
                    return None;
                }
                Some(Value::Array(
                    a.iter()
                        .filter_map(|x| self.value(x, &items, owner))
                        .collect(),
                ))
            }
            Value::String(_) => {
                let system = nodes
                    .iter()
                    .any(|n| SYSTEM_STRINGS.contains(&location(n).as_str()));
                (system || constrained_string(nodes)).then(|| v.clone())
            }
            other => Some(other.clone()),
        }
    }
}

/// 縮約する（アプリ本体の中のこの1か所だけで行う）。`pseudonyms` は共有ごとに持ち、読むたびに同じものを渡す
pub fn reduce(
    source: &SharedHouseholdSource,
    scope: &Scope,
    pseudonyms: &mut Pseudonyms,
) -> Reduced {
    let schemas = schema::schemas();
    let mut root = Vec::new();
    schemas.expand(schemas.root(), &mut root);
    let added = scope.added();
    let mut walk = Walk {
        schemas,
        allow: &allowlist().items,
        added: added.clone(),
        fields: BTreeSet::new(),
        texts: Vec::new(),
    };
    let input = walk
        .value(&source.input, &root, None)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let input = pseudonyms.apply(&input);
    let mut fields = walk.fields;
    let mut texts: Vec<Value> = Vec::new();
    for t in walk.texts {
        let mut w = wrap_client_text(&t.author, &t.body);
        w["item"] = Value::String(t.item);
        w["object"] = t
            .object
            .map(|o| Value::String(pseudonyms.alias(&o)))
            .unwrap_or(Value::Null);
        texts.push(w);
    }
    for t in &source.texts {
        if SOURCE_TEXT_ITEMS.contains(&t.item.as_str()) && added.contains(t.item.as_str()) {
            let mut w = wrap_client_text(&t.author, &t.body);
            w["item"] = Value::String(t.item.clone());
            w["object"] = t
                .object
                .as_deref()
                .filter(|o| is_uuid(o))
                .map(|o| Value::String(pseudonyms.alias(o)))
                .unwrap_or(Value::Null);
            texts.push(w);
            fields.insert(t.item.clone());
        }
    }
    Reduced {
        input,
        texts,
        fields: fields.into_iter().collect(),
    }
}

/// 縮約版で渡す項目の一覧（共有の画面の「渡す項目」に見せる。0015 の6）
pub fn reduced_items() -> Vec<String> {
    allowlist().items.iter().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn uuid_check() {
        assert!(is_uuid("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10"));
        assert!(!is_uuid("3F2B8C1E-9A4D-4E7B-8C21-5D0F6A9B7E10"));
        assert!(!is_uuid("s-1"));
        assert!(is_uuid(&random_uuid_v4()));
    }

    #[test]
    fn pseudonyms_keep_order_and_restore() {
        let a = "00000000-0000-4000-8000-000000000001";
        let b = "ffffffff-0000-4000-8000-000000000002";
        let input = json!({ "x": [a, b], "y": { "id": b } });
        let mut p = Pseudonyms::for_input(&input);
        let out = p.apply(&input);
        let pa = out["x"][0].as_str().unwrap().to_owned();
        let pb = out["x"][1].as_str().unwrap().to_owned();
        assert!(pa < pb, "並びの順番を保つ");
        assert_ne!(pa, a);
        assert_eq!(out["y"]["id"], pb.as_str());
        assert_eq!(p.restore(&json!({"t": pb})).unwrap(), json!({"t": b}));
        assert!(p.restore(&json!(random_uuid_v4())).is_err());
    }

    #[test]
    fn only_text_items_are_addable() {
        assert!(is_addable("periodicExpense.label"));
        assert!(is_addable("note.fp"));
        assert!(!is_addable("household.customerNumber"));
        assert!(!is_addable("labelsByMember"));
        assert!(!is_addable("member.birth"));
    }
}
