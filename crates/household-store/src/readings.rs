//! 読み替え表（0035 の9・0036 の5）: 世帯ファイルの形式 0.16 までに保存された鍵（差分の key・対策に足した項目・仮の印の欄のキー）を、
//! 当て先（向き先＋入力項目ID＋場所。0036 の2）か合成の対策（0036 の3）に読み替える。
//!
//! 表の正本は `registry/readings.yaml`（と値の場所の `registry/items.yaml`）。ここでは、engine の `npm run gen` が作る写し
//! （`data/readings.json`）を組み込む。画面（`app/src/workspace/store/readings.ts`）と同じ決まりで読み、凍結した見本
//! （`tests/fixtures/readings/0.16/`）で同じ結果になることを確かめる。
//! 0.16 の世帯のデータには並びの要素の ID が無い。ID の無い要素は、0.17 の変換の段が振るのと同じ決まった ID（[`migration_id`]）で指す

use std::sync::OnceLock;

use serde_json::{json, Map, Value};

use crate::crypto;

const DATA: &str = include_str!("../data/readings.json");

enum Piece {
    Lit(String),
    Object,
    Member,
    Id,
    Num,
}

struct Entry {
    from: String,
    to: Value,
    pieces: Vec<Piece>,
}

struct Table {
    entries: Vec<Entry>,
    places: Map<String, Value>,
}

fn compile(from: &str) -> Vec<Piece> {
    let mut out = Vec::new();
    let mut lit = String::new();
    let mut rest = from;
    while !rest.is_empty() {
        let hit = [("{object}", 0u8), ("{member}", 1), ("{id}", 2), ("{n}", 3)]
            .into_iter()
            .find(|(p, _)| rest.starts_with(p));
        match hit {
            Some((p, k)) => {
                if !lit.is_empty() {
                    out.push(Piece::Lit(std::mem::take(&mut lit)));
                }
                out.push(match k {
                    0 => Piece::Object,
                    1 => Piece::Member,
                    2 => Piece::Id,
                    _ => Piece::Num,
                });
                rest = &rest[p.len()..];
            }
            None => {
                let c = rest.chars().next().expect("文字");
                lit.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    if !lit.is_empty() {
        out.push(Piece::Lit(lit));
    }
    out
}

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let doc: Value = serde_json::from_str(DATA).expect("data/readings.json");
        let entries = doc["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|e| {
                let from = e["from"].as_str().expect("from").to_owned();
                Entry {
                    pieces: compile(&from),
                    from,
                    to: e["to"].clone(),
                }
            })
            .collect();
        let places = doc["places"].as_object().expect("places").clone();
        Table { entries, places }
    })
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

/// 鍵に合う表の行と、入っている ID・番号
struct Matched<'t> {
    entry: &'t Entry,
    object: Option<String>,
    member: Option<String>,
    ids: Vec<String>,
    ns: Vec<usize>,
}

fn match_entry<'t>(entry: &'t Entry, key: &str) -> Option<Matched<'t>> {
    let mut m = Matched {
        entry,
        object: None,
        member: None,
        ids: Vec::new(),
        ns: Vec::new(),
    };
    let mut pos = 0;
    for p in &entry.pieces {
        let rest = &key[pos..];
        match p {
            Piece::Lit(l) => {
                if !rest.starts_with(l.as_str()) {
                    return None;
                }
                pos += l.len();
            }
            Piece::Num => {
                let n = rest.bytes().take_while(u8::is_ascii_digit).count();
                if n == 0 {
                    return None;
                }
                m.ns.push(rest[..n].parse().ok()?);
                pos += n;
            }
            _ => {
                let u = rest.get(..36)?;
                if !is_uuid(u) {
                    return None;
                }
                match p {
                    Piece::Object => m.object = Some(u.to_owned()),
                    Piece::Member => m.member = Some(u.to_owned()),
                    _ => m.ids.push(u.to_owned()),
                }
                pos += 36;
            }
        }
    }
    (pos == key.len()).then_some(m)
}

fn match_key(key: &str) -> Option<Matched<'static>> {
    table().entries.iter().find_map(|e| match_entry(e, key))
}

/// 0.17 の変換の段が古い要素に振る ID（0035 の10 の1）: 文字列 `lifeplan.migrate.0.17:<場所>` の SHA-256 の先頭16バイトに、
/// UUID 第4版の版と変種のビットを立て、小文字・ハイフンつきの36文字にする
pub fn migration_id(place: &str) -> String {
    let d = crypto::sha256(format!("lifeplan.migrate.0.17:{place}").as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[..16]);
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

/// 世帯の物の集まりから ID で物を探す（ID は世帯ファイルの中で一意。0004 の4）
pub fn find_object<'a>(input: &'a Value, id: &str) -> Option<&'a Value> {
    input
        .get("household")?
        .as_object()?
        .values()
        .filter_map(Value::as_array)
        .flatten()
        .find(|x| x.get("id").and_then(Value::as_str) == Some(id))
}

/// 物の中を歩く位置: 今の値と、決まった ID を作るときの親（ID を持ついちばん近い物か `assumptions`）と、そこからの欄の名前
#[derive(Clone)]
struct Cursor<'a> {
    node: Option<&'a Value>,
    parent: String,
    segs: Vec<String>,
}

fn place_of(c: &Cursor<'_>, index: usize) -> String {
    let mut p = vec![c.parent.clone()];
    p.extend(c.segs.iter().cloned());
    p.push(index.to_string());
    p.join("/")
}

/// 並びの要素へ進む（要素が ID を持てばそれ、無ければ決まった ID）
fn enter_element<'a>(c: &Cursor<'a>, index: usize) -> (Cursor<'a>, String) {
    let el = c.node.and_then(Value::as_array).and_then(|a| a.get(index));
    match el.and_then(|e| e.get("id")).and_then(Value::as_str) {
        Some(own) => (
            Cursor {
                node: el,
                parent: own.to_owned(),
                segs: Vec::new(),
            },
            own.to_owned(),
        ),
        None => {
            let id = migration_id(&place_of(c, index));
            let mut segs = c.segs.clone();
            segs.push(index.to_string());
            (
                Cursor {
                    node: el,
                    parent: c.parent.clone(),
                    segs,
                },
                id,
            )
        }
    }
}

fn walk<'a>(mut node: Option<&'a Value>, path: &[String]) -> Option<&'a Value> {
    for k in path {
        node = node.and_then(|n| n.as_object()).and_then(|o| o.get(k));
    }
    node
}

fn place_path(item: &str) -> Option<Vec<String>> {
    table().places.get(item)?["path"]
        .as_array()?
        .iter()
        .map(|s| s.as_str().map(str::to_owned))
        .collect()
}

fn start_cursor<'a>(input: &'a Value, target: &Value, item: &str) -> Option<Cursor<'a>> {
    let path = place_path(item)?;
    if let Some(plan) = target.get("plan").and_then(Value::as_str) {
        if plan == "contingency" {
            return None;
        }
        let node = walk(Some(input), &path);
        return Some(if path.first().map(String::as_str) == Some("assumptions") {
            Cursor {
                node,
                parent: "assumptions".into(),
                segs: path[1..].to_vec(),
            }
        } else {
            Cursor {
                node,
                parent: "input".into(),
                segs: path,
            }
        });
    }
    let id = target
        .get("object")
        .or_else(|| target.get("member"))
        .and_then(Value::as_str)?;
    let node = walk(find_object(input, id), &path);
    Some(Cursor {
        node,
        parent: id.to_owned(),
        segs: path,
    })
}

/// 当て先の値（値の箱ならその箱）。無ければ None
pub fn read_at<'a>(input: &'a Value, address: &Value) -> Option<&'a Value> {
    let item = address["item"].as_str()?;
    let mut c = start_cursor(input, &address["target"], item)?;
    for step in address["at"].as_array()? {
        let step = step.as_str()?;
        if let Some(arr) = c.node.and_then(Value::as_array) {
            let mut found = None;
            for i in 0..arr.len() {
                let (cur, id) = enter_element(&c, i);
                if id == step {
                    found = Some(cur);
                    break;
                }
            }
            c = found?;
        } else {
            let mut segs = c.segs.clone();
            segs.push(step.to_owned());
            c = Cursor {
                node: c.node.and_then(|n| n.get(step)),
                parent: c.parent,
                segs,
            };
        }
    }
    c.node
}

/// 計算基準月にしている働き方の期間。無ければ次に始まる期間、それも無ければ最後の期間（0.16 の画面と同じ決まり）
pub fn current_period_id(input: &Value, member: &str) -> Option<String> {
    let base = input["baseMonth"].as_str().unwrap_or("");
    let from_at = |p: &Value| p["from"]["at"].as_str().unwrap_or("").to_owned();
    let to_at = |p: &Value| -> Option<String> {
        match p.get("to") {
            Some(Value::Null) => None,
            Some(t) => Some(t["at"].as_str().unwrap_or("9999-12").to_owned()),
            None => Some("9999-12".into()),
        }
    };
    let mut ps: Vec<&Value> = input["household"]["employmentPeriods"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|p| p["member"].as_str() == Some(member))
                .collect()
        })
        .unwrap_or_default();
    ps.sort_by_key(|p| from_at(p));
    let cur = ps
        .iter()
        .find(|p| from_at(p).as_str() <= base && to_at(p).is_none_or(|t| t.as_str() >= base))
        .or_else(|| ps.iter().find(|p| from_at(p).as_str() > base))
        .or_else(|| ps.last());
    cur.and_then(|p| p["id"].as_str()).map(str::to_owned)
}

fn unresolved(reason: impl Into<String>) -> Value {
    json!({"kind": "unresolved", "reason": reason.into()})
}

fn resolve_with(m: &Matched<'_>, to: &Value, input: &Value) -> Option<Value> {
    if let Some(r) = to.get("unresolved").and_then(Value::as_str) {
        return Some(unresolved(r));
    }
    if let Some(lever) = to.get("lever").and_then(Value::as_str) {
        if let Some(el) = to.get("element") {
            let r = resolve_with(m, el, input)?;
            if r["kind"] != "address" {
                return Some(r);
            }
            let last = r["address"]["at"].as_array()?.last()?.clone();
            return Some(json!({"kind": "lever", "lever": lever, "object": last}));
        }
        let mut out = json!({"kind": "lever", "lever": lever});
        if to.get("object") == Some(&Value::Bool(true)) {
            if let Some(o) = &m.object {
                out["object"] = json!(o);
            }
        }
        if to.get("member") == Some(&Value::Bool(true)) {
            if let Some(o) = &m.member {
                out["member"] = json!(o);
            }
        }
        return Some(out);
    }
    let item = to["item"].as_str()?;
    let target = match to["target"].as_str()? {
        t @ ("assumptions" | "input") => json!({"plan": t}),
        _ if to.get("find").and_then(Value::as_str) == Some("currentPeriod") => {
            match m
                .member
                .as_deref()
                .and_then(|mm| current_period_id(input, mm))
            {
                Some(id) => json!({"object": id}),
                None => return Some(unresolved("今の働き方の期間がありません")),
            }
        }
        "member" => json!({"member": m.member.as_ref()?}),
        _ => json!({"object": m.object.as_ref()?}),
    };
    let Some(mut c) = start_cursor(input, &target, item) else {
        return Some(unresolved(format!("入力項目 {item} の場所がありません")));
    };
    let mut at: Vec<Value> = Vec::new();
    for step in to["at"].as_array()? {
        if let Some(s) = step.as_str() {
            at.push(json!(s));
            let mut segs = c.segs.clone();
            segs.push(s.to_owned());
            c = Cursor {
                node: c.node.and_then(|n| n.get(s)),
                parent: c.parent,
                segs,
            };
            continue;
        }
        let arr: &[Value] = c.node.and_then(Value::as_array).map_or(&[], Vec::as_slice);
        let index: usize = if let Some(k) = step.get("n").and_then(Value::as_u64) {
            *m.ns.get((k as usize).checked_sub(1)?)?
        } else if let Some(i) = step.get("nth").and_then(Value::as_u64) {
            i as usize
        } else if let Some(k) = step.get("id").and_then(Value::as_u64) {
            let want = m.ids.get((k as usize).checked_sub(1)?)?.clone();
            match arr
                .iter()
                .position(|e| e.get("id").and_then(Value::as_str) == Some(want.as_str()))
            {
                Some(i) => i,
                None => {
                    // 要素が無くなっていても、鍵の ID のまま当て先にする（当てるときに要確認になる。0036 の7）
                    at.push(json!(want));
                    c = Cursor {
                        node: None,
                        parent: want,
                        segs: Vec::new(),
                    };
                    continue;
                }
            }
        } else {
            let w = step.get("where").and_then(Value::as_object)?;
            match arr
                .iter()
                .position(|e| w.iter().all(|(k, v)| e.get(k) == Some(v)))
            {
                Some(i) => i,
                None => {
                    let cond: Vec<String> = w
                        .iter()
                        .map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or("")))
                        .collect();
                    return Some(unresolved(format!(
                        "当てはまる要素がありません（{}）",
                        cond.join("・")
                    )));
                }
            }
        };
        let (cur, id) = enter_element(&c, index);
        at.push(json!(id));
        c = cur;
    }
    let mut out = json!({"kind": "address", "address": {"target": target, "item": item, "at": at}});
    if let Some(method) = to.get("method") {
        out["method"] = method.clone();
    }
    Some(out)
}

/// 古い鍵を読み替える（表に無い鍵は None）。input は 0.16 の世帯の要求の `input`
pub fn resolve_key(key: &str, input: &Value) -> Option<Value> {
    let m = match_key(key)?;
    resolve_with(&m, &m.entry.to, input)
}

/// 仮の印の欄のキーを読み替える（`assumed:` の型を先に〔推定の出し方を持つ〕、無ければ `field:` の型）
pub fn resolve_assumed_key(key: &str, input: &Value) -> Option<Value> {
    resolve_key(&format!("assumed:{key}"), input)
        .or_else(|| resolve_key(&format!("field:{key}"), input))
}

/// 表の行の数（テスト用）
pub fn entry_count() -> usize {
    table().entries.len()
}

/// 入力項目ID が登録簿にあるか（値の場所を持つ項目。0035 の12 の検査）
pub fn item_known(item: &str) -> bool {
    table().places.contains_key(item)
}

/// 値の状態の欄（valueStates）の鍵の誤り（0035 の3・12 の検査）: 鍵の入力項目ID が登録簿に無い、同じ値を値の箱と行の両方に書いている、
/// 値の無い場所に行を書いている。input は 0.17 の世帯の要求の `input`。戻り値は誤りの説明
pub fn value_state_problems(input: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut check = |states: &Value, target: Value, owner: &str| {
        for key in states.as_object().into_iter().flat_map(|m| m.keys()) {
            let mut parts = key.split('/');
            let item = parts.next().unwrap_or("");
            if !item_known(item) {
                out.push(format!(
                    "{owner}: valueStates の鍵 {key} の入力項目ID が登録簿にありません"
                ));
                continue;
            }
            let at: Vec<Value> = parts.map(|p| Value::String(p.to_owned())).collect();
            let target = match &target {
                Value::String(s) if s == "plan" => {
                    serde_json::json!({"plan": if item.starts_with("assumptions.") { "assumptions" } else { "input" }})
                }
                t => t.clone(),
            };
            let address = serde_json::json!({"target": target, "item": item, "at": at});
            match read_at(input, &address) {
                None | Some(Value::Null) => {
                    let row = &states[key.as_str()];
                    if row["state"] != "notApplicable" {
                        out.push(format!(
                            "{owner}: valueStates の鍵 {key} の場所に値がありません"
                        ));
                    }
                }
                Some(v)
                    if v.get("state").is_some_and(Value::is_string)
                        && v.get("origin").is_some_and(Value::is_object) =>
                {
                    out.push(format!(
                        "{owner}: {key} は値の箱と valueStates の両方に状態を書いています"
                    ));
                }
                Some(_) => {}
            }
        }
    };
    if let Some(states) = input.get("valueStates") {
        check(states, Value::String("plan".into()), "要求の入力");
    }
    if let Some(h) = input.get("household").and_then(Value::as_object) {
        for (coll, list) in h {
            for obj in list.as_array().into_iter().flatten() {
                let (Some(states), Some(id)) = (obj.get("valueStates"), obj["id"].as_str()) else {
                    continue;
                };
                let target = if coll == "members" {
                    serde_json::json!({"member": id})
                } else {
                    serde_json::json!({"object": id})
                };
                check(states, target, &format!("{coll}/{id}"));
            }
        }
    }
    out
}

/// 表の行の型の一覧（テスト用）
pub fn entry_froms() -> Vec<&'static str> {
    table().entries.iter().map(|e| e.from.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_id_is_a_version_4_uuid_made_from_the_place() {
        let id = migration_id("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/0");
        assert!(is_uuid(&id));
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
        assert_eq!(
            id,
            migration_id("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/0")
        );
        assert_ne!(
            id,
            migration_id("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/1")
        );
    }

    #[test]
    fn keys_match_only_whole_patterns() {
        let u = "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10";
        assert!(match_key(&format!("field:housing/debt/{u}/principal")).is_some());
        assert!(match_key(&format!("field:housing/debt/{u}/principalX")).is_none());
        assert!(match_key("field:housing/debt/not-a-uuid/principal").is_none());
        assert!(match_key(&format!("field:living/{u}/stage/12/ratio")).is_some());
        assert!(entry_count() > 100);
    }
}
