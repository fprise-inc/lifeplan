//! 縮約のための、世帯の入力の JSON Schema（engine/schemas）の読み方。
//! 値の各項目について、スキーマの上の場所と入力項目ID（`x-item`）を引く。全体の検証はしない（検証は計算エンジンの仕事）。
//! 渡してよいかを決めるために、文字列の値と地図の鍵だけは、その場所の形（列挙・定数・正規表現）と照らす。

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub(crate) const INPUT_ID: &str = "urn:financia:schema:engine.input";
const COMMON_ID: &str = "urn:financia:schema:common";
const REGULATION_VALUE_ID: &str = "urn:financia:schema:regulation.value";

const INPUT_JSON: &str = include_str!("../../../engine/schemas/engine.input.json");
const COMMON_JSON: &str = include_str!("../../../engine/schemas/common.json");
const REGULATION_VALUE_JSON: &str = include_str!("../../../engine/schemas/regulation.value.json");

/// たどる深さの上限（$ref の巡回で止まらないように）
const MAX_DEPTH: usize = 48;

pub(crate) struct Schemas {
    docs: Vec<(&'static str, Value)>,
}

/// スキーマの1か所（どの文書の、どの JSON Pointer か）
#[derive(Clone, Debug)]
pub(crate) struct Node<'a> {
    pub doc: &'static str,
    pub ptr: String,
    pub v: &'a Value,
}

pub(crate) fn schemas() -> &'static Schemas {
    static S: OnceLock<Schemas> = OnceLock::new();
    S.get_or_init(|| {
        let parse = |s: &str| {
            serde_json::from_str::<Value>(s).expect("埋め込んだスキーマが JSON ではありません")
        };
        Schemas {
            docs: vec![
                (INPUT_ID, parse(INPUT_JSON)),
                (COMMON_ID, parse(COMMON_JSON)),
                (REGULATION_VALUE_ID, parse(REGULATION_VALUE_JSON)),
            ],
        }
    })
}

impl Schemas {
    fn doc(&self, id: &str) -> Option<(&'static str, &Value)> {
        self.docs
            .iter()
            .find(|(d, _)| *d == id)
            .map(|(d, v)| (*d, v))
    }

    /// 入力の最上位
    pub fn root(&self) -> Node<'_> {
        let (doc, v) = self.doc(INPUT_ID).expect("入力のスキーマ");
        Node {
            doc,
            ptr: String::new(),
            v,
        }
    }

    fn resolve_ref(&self, from: &'static str, r: &str) -> Option<Node<'_>> {
        let (base, frag) = match r.split_once('#') {
            Some((b, f)) => (b, f),
            None => (r, ""),
        };
        let (doc, root) = if base.is_empty() {
            self.doc(from)?
        } else {
            self.doc(base)?
        };
        let v = if frag.is_empty() {
            root
        } else {
            root.pointer(frag)?
        };
        Some(Node {
            doc,
            ptr: frag.to_owned(),
            v,
        })
    }

    /// その場所に当てはまるスキーマを、$ref・allOf・anyOf・oneOf・then・else をたどって全部集める
    pub fn expand<'a>(&'a self, n: Node<'a>, out: &mut Vec<Node<'a>>) {
        self.expand_inner(n, out, 0);
    }

    fn expand_inner<'a>(&'a self, n: Node<'a>, out: &mut Vec<Node<'a>>, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        let Some(obj) = n.v.as_object() else {
            out.push(n);
            return;
        };
        if let Some(r) = obj.get("$ref").and_then(Value::as_str) {
            if let Some(t) = self.resolve_ref(n.doc, r) {
                self.expand_inner(t, out, depth + 1);
            }
        }
        for k in ["allOf", "anyOf", "oneOf"] {
            if let Some(list) = obj.get(k).and_then(Value::as_array) {
                for (i, sub) in list.iter().enumerate() {
                    self.expand_inner(
                        Node {
                            doc: n.doc,
                            ptr: format!("{}/{k}/{i}", n.ptr),
                            v: sub,
                        },
                        out,
                        depth + 1,
                    );
                }
            }
        }
        for k in ["then", "else"] {
            if let Some(sub) = obj.get(k) {
                self.expand_inner(
                    Node {
                        doc: n.doc,
                        ptr: format!("{}/{k}", n.ptr),
                        v: sub,
                    },
                    out,
                    depth + 1,
                );
            }
        }
        out.push(n);
    }

    /// 物（object）の項目 key に当たるスキーマ（たどった後）
    pub fn property<'a>(&'a self, parents: &[Node<'a>], key: &str) -> Vec<Node<'a>> {
        let mut direct = Vec::new();
        for p in parents {
            if let Some(s) = p.v.get("properties").and_then(|ps| ps.get(key)) {
                direct.push(Node {
                    doc: p.doc,
                    ptr: format!("{}/properties/{}", p.ptr, escape(key)),
                    v: s,
                });
            }
        }
        if direct.is_empty() {
            // properties に無い項目は additionalProperties（地図の形）
            for p in parents {
                if let Some(s) = p.v.get("additionalProperties").filter(|s| s.is_object()) {
                    direct.push(Node {
                        doc: p.doc,
                        ptr: format!("{}/additionalProperties", p.ptr),
                        v: s,
                    });
                }
            }
        }
        let mut out = Vec::new();
        for d in direct {
            self.expand(d, &mut out);
        }
        out
    }

    /// 配列の要素に当たるスキーマ（たどった後）
    pub fn items<'a>(&'a self, parents: &[Node<'a>]) -> Vec<Node<'a>> {
        let mut out = Vec::new();
        for p in parents {
            if let Some(s) = p.v.get("items").filter(|s| s.is_object()) {
                self.expand(
                    Node {
                        doc: p.doc,
                        ptr: format!("{}/items", p.ptr),
                        v: s,
                    },
                    &mut out,
                );
            }
        }
        out
    }
}

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// 集めたスキーマの入力項目ID
pub(crate) fn x_item<'a>(nodes: &[Node<'a>]) -> Option<&'a str> {
    nodes
        .iter()
        .find_map(|n| n.v.get("x-item").and_then(Value::as_str))
}

/// 文字列の形を決める語（この版のスキーマは `format` を使っていない。使われても照らせないので、合わないとみなす）
const SHAPE_KEYS: [&str; 4] = ["enum", "const", "pattern", "format"];

/// 文字列が形の決まった欄のもので、値がその形に合うか。形の決まっていない文字列は人が書いた文章になりうるので false。
/// 当てはまるスキーマのうち、形を決めているどれか1つの、列挙・定数・正規表現のすべてに合えば true
pub(crate) fn string_fits(nodes: &[Node<'_>], s: &str) -> bool {
    nodes
        .iter()
        .filter(|n| SHAPE_KEYS.iter().any(|k| n.v.get(*k).is_some()))
        .any(|n| node_accepts(n.v, s))
}

fn node_accepts(v: &Value, s: &str) -> bool {
    if let Some(e) = v.get("enum") {
        if !e
            .as_array()
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(s)))
        {
            return false;
        }
    }
    if let Some(c) = v.get("const") {
        if c.as_str() != Some(s) {
            return false;
        }
    }
    if let Some(p) = v.get("pattern") {
        if !p.as_str().is_some_and(|p| pattern_matches(p, s)) {
            return false;
        }
    }
    v.get("format").is_none()
}

/// JSON Schema の正規表現で照らす（`\d` は ECMAScript と同じく 0〜9 だけ。読めない正規表現は合わないとみなす）
fn pattern_matches(pattern: &str, s: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Regex>>>> = OnceLock::new();
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    cache
        .entry(pattern.to_owned())
        .or_insert_with(|| Regex::new(&pattern.replace("\\d", "[0-9]")).ok())
        .as_ref()
        .is_some_and(|r| r.is_match(s))
}

impl Schemas {
    /// 物の鍵 key を渡してよいか: `properties` にある名前か、地図の形（`additionalProperties`）なら鍵の形（`propertyNames`）に合うもの。
    /// 鍵の形の決まっていない地図の鍵は渡さない
    pub fn key_fits(&self, parents: &[Node<'_>], key: &str) -> bool {
        if parents
            .iter()
            .any(|p| p.v.get("properties").and_then(|ps| ps.get(key)).is_some())
        {
            return true;
        }
        let mut names = Vec::new();
        for p in parents {
            if let Some(pn) = p.v.get("propertyNames") {
                self.expand(
                    Node {
                        doc: p.doc,
                        ptr: format!("{}/propertyNames", p.ptr),
                        v: pn,
                    },
                    &mut names,
                );
            }
        }
        string_fits(&names, key)
    }
}

/// スキーマの場所の文字列（文書の ID＋JSON Pointer）
pub(crate) fn location(n: &Node<'_>) -> String {
    format!("{}#{}", n.doc, n.ptr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_x_item_through_refs() {
        let s = schemas();
        let mut root = Vec::new();
        s.expand(s.root(), &mut root);
        let household = s.property(&root, "household");
        assert!(!household.is_empty());
        let members = s.property(&household, "members");
        let member = s.items(&members);
        let birth = s.property(&member, "birth");
        assert_eq!(x_item(&birth), Some("member.birth"));
        let ym = s.property(&birth, "birthYearMonth");
        assert!(string_fits(&ym, "1990-04"));
        assert!(!string_fits(&ym, "1990-13"));
        assert!(!string_fits(&ym, "1990-04 名前"));
        let id = s.property(&member, "id");
        assert!(
            string_fits(&id, "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10"),
            "構成員の ID は UUID の形"
        );
        assert!(!string_fits(&id, "名前"));
        let sex = s.property(&member, "sex");
        assert!(string_fits(&sex, "female"));
        assert!(!string_fits(&sex, "名前"));
    }

    #[test]
    fn digits_follow_ecmascript() {
        assert!(pattern_matches("^-?\\d+(\\.\\d+)?$", "12.5"));
        assert!(
            !pattern_matches("^-?\\d+(\\.\\d+)?$", "１２"),
            "全角の数字は \\d に入らない"
        );
        assert!(!pattern_matches("(", "x"), "読めない正規表現は合わない");
    }
}
