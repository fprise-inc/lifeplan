//! 差し替えられる文の一覧（`list_custom_texts`。0212・0016 の追記）: アプリに同梱した説明の一覧（`texts-reference@1.0`）と
//! 名前の一覧（`terms-reference@1.0`）を、分野・id の頭・言葉で絞って返す（読むだけ）。
//!
//! - FP の AI が、カスタム層の `settings/texts.json`（文）・`settings/terms.json`（名前）の下書きを書くための材料。
//!   接続口はカスタム層のファイルを書かない。効くのは、FP がアプリの事務所の既定値の画面で承認した後だけ
//! - 中身はアプリ本体が埋め込む一覧と同じ（app/scripts/textsCatalog.ts が作る。crates/lifeplan/dist に写す）。顧客の情報は含まない

use crate::engine::assets::{TERMS_CATALOG_JSON, TEXTS_CATALOG_JSON};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// 分野（一覧の `kind`）の名前。文の一覧と名前の一覧で鍵が同じ物（field）は、どちらの一覧かで意味が違う
fn kind_label(file: &str, kind: &str) -> &'static str {
    match (file, kind) {
        ("texts", "field") => "入力の欄の「?」の説明",
        ("texts", "notice") => "結果のタブの計算の知らせ",
        ("texts", "estimate") => "入力の欄の「推定」の根拠の文",
        ("texts", "result") => "結果の画面の文（結論の1文・取り崩しの条件・グラフの注・ポイント・夢と予定・万一のときの結論の1文）",
        ("terms", "field") => "入力の欄の名前",
        ("terms", "row") => "キャッシュフロー表の行の名前（提案書・持ち帰り用のレポートも同じ名前）",
        _ => "",
    }
}

/// 書き方の手引き（答えにいつも添える）
fn how_to(file: &str) -> Value {
    if file == "terms" {
        json!({
            "file": "settings/terms.json",
            "shape": { "schema": "terms@1.0", "entries": [{ "id": "row:cf.expense.living", "name": "基本の生活費", "basedOn": "（一覧の hash をそのまま写す）" }] },
            "rules": [
                "行は id・name・basedOn だけ。名前は1行・40字まで。消す・足すは無い（公式の名前に戻すときは行を消す）",
                "basedOn には一覧の hash をそのまま写す（アプリの更新で公式の名前が変わったことを見つけるのに使う）",
                "vars のある名前（人ごとの行など）は、その印（例 {person}）を名前に入れる",
            ],
        })
    } else {
        json!({
            "file": "settings/texts.json",
            "shape": { "schema": "texts@1.0", "entries": [{ "id": "result:invest/conditionNone", "do": "replace", "text": "取り崩しの予定は入れず、収支が足りない年だけ金融資産から使う場合", "basedOn": "（一覧の hash をそのまま写す）" }] },
            "rules": [
                "do は ops に載った物だけ（replace＝書き換える・append＝公式の文の後ろに段落を足す・hide＝消す）。結果の画面の文（result:…）は書き換えるだけで、消せるのはグラフの注だけ",
                "差し込みの印 {name} は、その行の vars に載った物だけ（知らない印があると承認できない）。数字の入る印（vars の number が true）を落とすと、計算の値が画面に出なくなるので注意が出る。差し込む値は単位まで入る（例 {age} は「84歳」）",
                "文はただの文字。HTML・Markdown として読まない。改行（\\n）は段落の区切り。{ } の字そのものは {{ }}。上限は説明（field）が1,000字、ほかは300字",
                "basedOn には一覧の hash をそのまま写す（アプリの更新で公式の文が変わったことを見つけるのに使う）",
                "audience が customer の文は、お客さまと一緒に見る画面に出る（事務所の文であることは画面に出さない）",
            ],
        })
    }
}

struct Catalogs {
    texts: Vec<Value>,
    terms: Vec<Value>,
}

fn catalogs() -> &'static Catalogs {
    static C: OnceLock<Catalogs> = OnceLock::new();
    C.get_or_init(|| {
        let read = |s: &str| -> Vec<Value> {
            serde_json::from_str::<Value>(s)
                .ok()
                .and_then(|v| v["entries"].as_array().cloned())
                .unwrap_or_default()
        };
        Catalogs {
            texts: read(TEXTS_CATALOG_JSON),
            terms: read(TERMS_CATALOG_JSON),
        }
    })
}

/// 一覧の分野の鍵（file ごと）
pub fn kinds(file: &str) -> Vec<String> {
    let list = if file == "terms" {
        &catalogs().terms
    } else {
        &catalogs().texts
    };
    let mut k: Vec<String> = list
        .iter()
        .filter_map(|e| e["kind"].as_str().map(str::to_owned))
        .collect();
    k.sort();
    k.dedup();
    k
}

/// 1件を、AI が読みやすい形にする（印ごとに意味と、数字の入る印か）
fn shape(e: &Value) -> Value {
    let help = e["varsHelp"].as_object();
    let numbers: Vec<&str> = e["numberVars"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let vars: Vec<Value> = e["vars"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|n| {
                    let mut v = Map::new();
                    v.insert("name".into(), json!(n));
                    if let Some(m) = help.and_then(|h| h.get(n)) {
                        v.insert("meaning".into(), m.clone());
                    }
                    if numbers.contains(&n) {
                        v.insert("number".into(), json!(true));
                    }
                    Value::Object(v)
                })
                .collect()
        })
        .unwrap_or_default();
    let mut o = Map::new();
    for k in ["id", "kind", "where", "audience", "text"] {
        o.insert(k.into(), e[k].clone());
    }
    o.insert("vars".into(), Value::Array(vars));
    o.insert("ops".into(), e["ops"].clone());
    if let Some(n) = e.get("noticeKind") {
        o.insert("noticeKind".into(), n.clone());
    }
    o.insert("hash".into(), e["hash"].clone());
    Value::Object(o)
}

/// 絞り方
pub struct Filter<'a> {
    pub file: &'a str,
    pub kind: Option<&'a str>,
    pub prefix: Option<&'a str>,
    pub query: Option<&'a str>,
    pub limit: usize,
    pub offset: usize,
}

/// 一覧を絞って返す。絞らなければ分野ごとの数と、各分野の最初の数件の id（目次）も添える
pub fn list(f: &Filter) -> Value {
    let all = if f.file == "terms" {
        &catalogs().terms
    } else {
        &catalogs().texts
    };
    let q = f.query.map(str::to_lowercase);
    let hits: Vec<&Value> = all
        .iter()
        .filter(|e| f.kind.is_none_or(|k| e["kind"] == k))
        .filter(|e| {
            f.prefix
                .is_none_or(|p| e["id"].as_str().is_some_and(|id| id.starts_with(p)))
        })
        .filter(|e| {
            q.as_deref().is_none_or(|q| {
                ["id", "where", "text"]
                    .iter()
                    .any(|k| e[*k].as_str().is_some_and(|s| s.to_lowercase().contains(q)))
            })
        })
        .collect();
    let total = hits.len();
    let page: Vec<Value> = hits
        .iter()
        .skip(f.offset)
        .take(f.limit)
        .map(|e| shape(e))
        .collect();
    let areas: Vec<Value> = kinds(f.file)
        .iter()
        .map(|k| {
            let n = all.iter().filter(|e| e["kind"] == k.as_str()).count();
            json!({ "kind": k, "name": kind_label(f.file, k), "count": n })
        })
        .collect();
    let mut out = json!({
        "file": f.file,
        "areas": areas,
        "total": total,
        "offset": f.offset,
        "entries": page,
        "howTo": how_to(f.file),
        "approval": "この接続口はカスタム層のファイルを書きません。FP の AI がカスタム層のフォルダ（アプリの事務所の既定値の画面に場所が出る。既定は書類のフォルダの lifeplan-custom）の settings/ に下書きを書き、FP がアプリの事務所の既定値の画面の「説明の文（カスタム層）」「名前（カスタム層）」で中身を確かめて承認したときだけ画面に出ます。計算の結果は変わりません。",
    });
    if f.offset + page_len(&out) < total {
        out["next"] = json!({ "offset": f.offset + f.limit });
    }
    out
}

fn page_len(v: &Value) -> usize {
    v["entries"].as_array().map_or(0, Vec::len)
}
