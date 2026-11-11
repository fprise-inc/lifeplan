//! 入力の形の説明と、直し方の分かるエラー（0196）。
//!
//! - 計算の入力（エンジンへの要求の `input`）の形を、エンジンと同じスキーマ（`engine/schemas/engine.input.json`・`common.json`。
//!   ビルドの時に埋め込む）から、区分ごとに短く返す（欄・必須・選べる値・入力項目ID・見本の世帯から取った例）。全体（約208KB）は返さない。
//! - 計算できなかったとき（エンジンが入力の形の誤りを1つだけ、場所と記号で返したとき）に、同じスキーマで入力を確かめ直し、
//!   足りない欄の名前・選べる値・正しい形（「ID は UUID で」「金額は値の箱で」など）を返す。判定はいつもエンジンが正で、
//!   ここの確かめは直し方の手がかりだけ（エンジンが通した入力を止めることはない）。
//! - 答えには入力の値を写さない（欄の名前・場所・スキーマの中身だけ）。渡された世帯の入力でも同じ。

use crate::engine::assets::HOUSEHOLDS;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

const INPUT_SCHEMA: &str = include_str!("../../../engine/schemas/engine.input.json");
const COMMON_SCHEMA: &str = include_str!("../../../engine/schemas/common.json");
const COMMON_ID: &str = "urn:financia:schema:common#";

/// 直し方の手がかりとして返す問題の数の上限（答えを小さくする）
const MAX_PROBLEMS: usize = 20;
/// 例（見本の世帯から取った物）の大きさの上限。超えたら例を省き、見本の世帯の ID だけを返す
const MAX_EXAMPLE_BYTES: usize = 3000;

struct Schemas {
    input: Value,
    common: Value,
}

fn schemas() -> &'static Schemas {
    static S: OnceLock<Schemas> = OnceLock::new();
    S.get_or_init(|| Schemas {
        input: serde_json::from_str(INPUT_SCHEMA).unwrap_or(Value::Null),
        common: serde_json::from_str(COMMON_SCHEMA).unwrap_or(Value::Null),
    })
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Doc {
    Input,
    Common,
}

fn root(doc: Doc) -> &'static Value {
    match doc {
        Doc::Input => &schemas().input,
        Doc::Common => &schemas().common,
    }
}

type S = &'static Value;

/// $ref をたどる（共通の定義は urn:financia:schema:common#、同じ文書の中は #）。3つ目は $defs の名前
fn follow(doc: Doc, r: &str) -> Option<(Doc, S, Option<&'static str>)> {
    let (d, ptr) = if let Some(rest) = r.strip_prefix(COMMON_ID) {
        (Doc::Common, rest)
    } else {
        (doc, r.strip_prefix('#')?)
    };
    let v = root(d).pointer(ptr)?;
    let name = root(d)
        .get("$defs")
        .and_then(Value::as_object)
        .and_then(|m| {
            m.iter()
                .find(|(_, x)| std::ptr::eq(*x, v))
                .map(|(k, _)| k.as_str())
        });
    Some((d, v, name))
}

// ---------- よく出る形（共通の定義）の呼び名と説明 ----------

struct Known {
    label: &'static str,
    legend: &'static str,
}

fn known(doc: Doc, name: &str) -> Option<Known> {
    let k = |label, legend| Some(Known { label, legend });
    match (doc, name) {
        (Doc::Common, "uuid") => k("UUID", "UUID 第4版の文字（小文字・ハイフンつき。3つ目の組は 4 で、4つ目の組は 8・9・a・b のどれかで始まる。例 \"3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f\"）。\"self\" などの名前は使えない。新しい物の ID は get_input_guide の freshIds を使ってよい"),
        (Doc::Common, "yearMonth") => k("年月", "\"YYYY-MM\" の文字（例 \"2030-04\"）"),
        (Doc::Common, "date") => k("日付", "\"YYYY-MM-DD\" の文字"),
        (Doc::Common, "rate") => k("率", "10進の文字列（数にしない。1.5% は \"0.015\"。小数12桁まで）"),
        (Doc::Common, "yen") => k("円", "円の整数（万円にしない。例 1200000）"),
        (Doc::Common, "nonNegativeYen") => k("円", "円の整数（万円にしない。例 1200000）"),
        (Doc::Common, "boxYen") => k("金額の箱", "値の箱 {\"value\": 円の整数, \"state\": \"confirmed\", \"origin\": {\"kind\": \"manual\"}}（数だけを書かない。origin.kind を \"ai\" にすると FP の承認の記録 approval が要るので \"manual\" に）"),
        (Doc::Common, "boxRate") => k("率の箱", "値の箱 {\"value\": \"0.01\", \"state\": \"confirmed\", \"origin\": {\"kind\": \"manual\"}}（value は率の文字）"),
        (Doc::Common, "boxBoolean") => k("真偽の箱", "値の箱 {\"value\": true, \"state\": \"confirmed\", \"origin\": {\"kind\": \"manual\"}}"),
        (Doc::Common, "timepoint") => k("時点", "{\"at\": \"YYYY-MM\"}（年月）・{\"memberAge\": {\"member\": 構成員の UUID, \"years\": 60}}（その人がその年齢に達する月）・{\"event\": events の UUID} のどれか（年月の文字だけを書かない）"),
        (Doc::Input, "timepointOrNull") => k("時点か null", "時点（{\"at\": \"YYYY-MM\"} など）か null（null は「最初から」「最後まで」）"),
        (Doc::Common, "birth") => k("生年月", "{\"birthYearMonth\": \"YYYY-MM\", \"bornOnFirst\": false}"),
        (Doc::Common, "year") => k("年", "整数の年（例 2030）"),
        (Doc::Common, "yearSeries") => k("年ごとの列", "{\"default\": \"0.01\"}（率の文字。年ごとに変えるときは \"byYear\": {\"2030\": \"0.02\"}。数や文字だけを書かない）"),
        (Doc::Common, "valueStates") => k("値の状態", "画面の側の記録。AI が組み立てる入力では省く"),
        (Doc::Common, "money") => k("外貨の金額", "{\"amount\": 整数, \"currency\": \"USD\"}"),
        (Doc::Common, "dottedId") => k("点区切りのID", "小文字で始まる点区切りの ID（例 \"a.b\"）"),
        _ => None,
    }
}

/// 説明の文を短くする（頭の設計記録の番号「0008 の2:」などを外し、長ければ切る）
fn short(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"^(?:[0-9][0-9.]*(?:\s*の(?:[0-9]+|追記)(?:（[^）]*）)?)?(?:・[0-9][0-9.]*(?:\s*の(?:[0-9]+|追記)(?:（[^）]*）)?)?)*)\s*[:：]\s*").unwrap()
    });
    let t = re.replace(text.trim(), "");
    let mut out: String = t.chars().take(90).collect();
    if t.chars().count() > 90 {
        out.push('…');
    }
    out
}

fn title_of(s: &Value) -> Option<String> {
    s.get("title")
        .or_else(|| s.get("description"))
        .and_then(Value::as_str)
        .map(short)
}

// ---------- 形の呼び名（区分の説明とエラーの両方で使う） ----------

#[derive(Default)]
struct Legend(BTreeSet<(Doc, &'static str)>);

impl Legend {
    fn add(&mut self, doc: Doc, name: &'static str) {
        self.0.insert((doc, name));
    }
    fn to_value(&self) -> Value {
        let mut m = Map::new();
        for (d, name) in &self.0 {
            if let Some(k) = known(*d, name) {
                m.insert(k.label.to_owned(), json!(k.legend));
            }
        }
        Value::Object(m)
    }
}

fn fmt_values(vals: &[Value]) -> String {
    let list: Vec<String> = vals
        .iter()
        .take(14)
        .map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect();
    let mut s = list.join("|");
    if vals.len() > 14 {
        s.push_str("|…");
    }
    s
}

/// 1つの欄の形を短い文字にする（例「金額の箱」「選択 rent|own」「物（price*・downPayment*・costs*…）」「物の配列」）
fn label(doc: Doc, s: S, legend: &mut Legend, depth: u8) -> String {
    if let Some(b) = s.as_bool() {
        return if b {
            "（自由）".into()
        } else {
            "（使えない）".into()
        };
    }
    if let Some(r) = s.get("$ref").and_then(Value::as_str) {
        if let Some((d, t, name)) = follow(doc, r) {
            if let Some(n) = name {
                if let Some(k) = known(d, n) {
                    legend.add(d, n);
                    return k.label.to_owned();
                }
            }
            return label(d, t, legend, depth);
        }
    }
    if let Some(e) = s.get("enum").and_then(Value::as_array) {
        return format!("選択 {}", fmt_values(e));
    }
    if let Some(c) = s.get("const") {
        return format!("値 {c}");
    }
    for key in ["oneOf", "anyOf"] {
        if let Some(list) = s.get(key).and_then(Value::as_array) {
            let parts: Vec<String> = list.iter().map(|b| label(doc, b, legend, depth)).collect();
            if !parts.is_empty() && parts.iter().all(|p| !p.is_empty()) {
                if parts.iter().all(|p| p.starts_with('物')) {
                    return "物".into();
                }
                return format!("どれか（{}）", parts.join("・"));
            }
        }
    }
    if let Some(list) = s.get("allOf").and_then(Value::as_array) {
        if s.get("type").is_none() && s.get("properties").is_none() {
            if let Some(first) = list.first() {
                return label(doc, first, legend, depth);
            }
        }
    }
    let ty = s.get("type");
    let one = |t: &str| ty.and_then(Value::as_str) == Some(t);
    if one("object") || (ty.is_none() && s.get("properties").is_some()) {
        let (props, req) = props_of(doc, s);
        if props.is_empty() {
            if let Some(ap) = s.get("additionalProperties").filter(|a| a.is_object()) {
                return format!("物（鍵ごとに {}）", label(doc, ap, legend, depth + 1));
            }
            return "物".into();
        }
        if depth > 0 {
            return "物".into();
        }
        let names: Vec<String> = props
            .iter()
            .filter(|(k, _)| *k != "valueStates")
            .take(12)
            .map(|(k, _)| {
                if req.contains(*k) {
                    format!("{k}*")
                } else {
                    (*k).to_owned()
                }
            })
            .collect();
        let more = if props.len() > 13 { "…" } else { "" };
        return format!("物（{}{more}）", names.join("・"));
    }
    if one("array") {
        if let Some(items) = s.get("items") {
            let inner = label(doc, items, legend, depth + 1);
            return if inner.starts_with('物') {
                "物の配列".into()
            } else {
                format!("配列（{inner}）")
            };
        }
        return "配列".into();
    }
    if one("integer") {
        return match (s.get("minimum"), s.get("maximum")) {
            (Some(a), Some(b)) => format!("整数 {a}〜{b}"),
            (Some(a), None) => format!("整数 {a}〜"),
            (None, Some(b)) => format!("整数 〜{b}"),
            _ => "整数".into(),
        };
    }
    if one("number") {
        return "数".into();
    }
    if one("boolean") {
        return "真偽".into();
    }
    if one("string") {
        return match s.get("maxLength") {
            Some(n) => format!("文字（{n}字まで）"),
            None => "文字".into(),
        };
    }
    if one("null") {
        return "null".into();
    }
    if let Some(list) = ty.and_then(Value::as_array) {
        return list
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("か");
    }
    String::new()
}

/// 物の欄（properties）と必須（required）を、allOf の中も合わせて集める（$ref はたどる）
/// 欄の名前と、その形（文書とスキーマ）
type Props = Vec<(&'static str, (Doc, S))>;

fn props_of(doc: Doc, s: S) -> (Props, BTreeSet<&'static str>) {
    let mut props: Props = Vec::new();
    let mut req = BTreeSet::new();
    collect_props(doc, s, &mut props, &mut req, 0);
    (props, req)
}

fn collect_props(doc: Doc, s: S, props: &mut Props, req: &mut BTreeSet<&'static str>, depth: u8) {
    if depth > 6 {
        return;
    }
    if let Some(r) = s.get("$ref").and_then(Value::as_str) {
        if let Some((d, t, _)) = follow(doc, r) {
            collect_props(d, t, props, req, depth + 1);
        }
    }
    if let Some(m) = s.get("properties").and_then(Value::as_object) {
        for (k, v) in m {
            // 値の箱の共通の欄（state: true など）は、共通の定義の側の形を使う
            if v.as_bool() == Some(true) && props.iter().any(|(n, _)| n == k) {
                continue;
            }
            if let Some(slot) = props.iter_mut().find(|(n, _)| n == k) {
                if v.as_bool() != Some(true) {
                    slot.1 = (doc, v);
                }
            } else {
                props.push((k.as_str(), (doc, v)));
            }
        }
    }
    if let Some(list) = s.get("required").and_then(Value::as_array) {
        for k in list.iter().filter_map(Value::as_str) {
            req.insert(k);
        }
    }
    if let Some(list) = s.get("allOf").and_then(Value::as_array) {
        for b in list {
            if b.get("if").is_none() {
                collect_props(doc, b, props, req, depth + 1);
            }
        }
    }
}

/// $ref をたどった先（と、その文書）。$ref の横の欄（title など）は呼ぶ側で読む
fn deref(doc: Doc, s: S) -> (Doc, S) {
    let mut cur = (doc, s);
    for _ in 0..8 {
        match cur.1.get("$ref").and_then(Value::as_str) {
            Some(r) if cur.1.get("properties").is_none() => match follow(cur.0, r) {
                Some((d, t, _)) => cur = (d, t),
                None => break,
            },
            _ => break,
        }
    }
    cur
}

/// 欄1つを1行の文字にする: 「名前*: 形 — 説明 [入力項目ID]」（* は必須）
fn field_line(name: &str, required: bool, doc: Doc, s: S, legend: &mut Legend) -> String {
    let mut line = format!(
        "{name}{}: {}",
        if required { "*" } else { "" },
        label(doc, s, legend, 0)
    );
    let desc = title_of(s).or_else(|| {
        let (d, t) = deref(doc, s);
        let _ = d;
        t.get("description")
            .and_then(Value::as_str)
            .filter(|_| s.get("$ref").is_some() && t.get("properties").is_some())
            .map(short)
    });
    if let Some(d) = desc {
        line.push_str(" — ");
        line.push_str(&d);
    }
    if let Some(item) = s.get("x-item").and_then(Value::as_str) {
        line.push_str(&format!(" [{item}]"));
    }
    line
}

/// if の条件を文にする（簡単な形だけ。読めない形は None）
fn cond_text(s: &Value) -> Option<String> {
    if let Some(list) = s.get("required").and_then(Value::as_array) {
        if s.get("properties").is_none() {
            let names: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
            return Some(format!("{} があるとき", names.join("・")));
        }
    }
    if let Some(n) = s.get("not") {
        if let Some(list) = n.get("required").and_then(Value::as_array) {
            let names: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
            return Some(format!("{} が無いとき", names.join("・")));
        }
    }
    let m = s.get("properties")?.as_object()?;
    let mut parts = Vec::new();
    for (k, v) in m {
        if let Some(c) = v.get("const") {
            parts.push(format!("{k} が {}", fmt_values(std::slice::from_ref(c))));
        } else if let Some(e) = v.get("enum").and_then(Value::as_array) {
            parts.push(format!("{k} が {}", fmt_values(e)));
        } else {
            parts.push(format!("{k} の {}", cond_text(v)?));
        }
    }
    Some(format!("{}のとき", parts.join("・")))
}

fn then_text(s: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(list) = s.get("required").and_then(Value::as_array) {
        let names: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
        parts.push(format!("{} も必須", names.join("・")));
    }
    if let Some(n) = s.get("not") {
        if let Some(list) = n.get("required").and_then(Value::as_array) {
            let names: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
            parts.push(format!("{} は書かない", names.join("・")));
        } else {
            parts.push("組み合わせの決まりあり".into());
        }
    }
    if let Some(m) = s.get("properties").and_then(Value::as_object) {
        for (k, v) in m {
            if let Some(c) = v.get("const") {
                parts.push(format!("{k} は {c}"));
            }
        }
    }
    if parts.is_empty() {
        "形の決まりあり".into()
    } else {
        parts.join("・")
    }
}

/// 物の if/then（allOf の中）を文の一覧にする
fn conditions(doc: Doc, s: S) -> Vec<String> {
    let (d, t) = deref(doc, s);
    let mut out = Vec::new();
    let mut list: Vec<&Value> = Vec::new();
    if t.get("if").is_some() {
        list.push(t);
    }
    if let Some(a) = t.get("allOf").and_then(Value::as_array) {
        list.extend(a.iter().filter(|b| b.get("if").is_some()));
    }
    let _ = d;
    for b in list {
        if let (Some(c), Some(th)) = (cond_text(&b["if"]), b.get("then")) {
            out.push(format!("{c}: {}", then_text(th)));
        }
    }
    out
}

/// oneOf の枝の短い説明（必須の欄と、決まった値）
fn branch_summary(doc: Doc, b: S, legend: &mut Legend) -> String {
    let (d, t) = deref(doc, b);
    if let Some(r) = b.get("$ref").and_then(Value::as_str) {
        if let Some((kd, _, Some(n))) = follow(doc, r) {
            if let Some(k) = known(kd, n) {
                legend.add(kd, n);
                return k.label.to_owned();
            }
        }
    }
    let (props, req) = props_of(d, t);
    let consts: Vec<String> = props
        .iter()
        .filter_map(|(k, (_, v))| v.get("const").map(|c| format!("{k} が {c}")))
        .collect();
    let mut s = String::new();
    if !consts.is_empty() {
        s.push_str(&consts.join("・"));
        s.push_str(" の形");
    }
    let reqs: Vec<&str> = req.iter().copied().collect();
    if !reqs.is_empty() {
        if !s.is_empty() {
            s.push('（');
        }
        s.push_str(&format!("必須 {}", reqs.join("・")));
        if let Some(n) = t
            .get("not")
            .and_then(|n| n.get("required"))
            .and_then(Value::as_array)
        {
            let names: Vec<&str> = n.iter().filter_map(Value::as_str).collect();
            s.push_str(&format!("。{} とは一緒にしない", names.join("・")));
        }
        if !consts.is_empty() {
            s.push('）');
        }
    }
    if s.is_empty() {
        s = label(d, t, legend, 1);
    }
    s
}

// ---------- 区分の説明 ----------

/// 主な区分（AI が世帯を組み立てるときによく使う順）。鍵・場所・呼び名・手本・注意
struct Section {
    key: &'static str,
    path: &'static str,
    name: &'static str,
    recipes: &'static [&'static str],
    tips: &'static [&'static str],
}

const SECTIONS: &[Section] = &[
    Section { key: "plan", path: "", name: "計算の基準（baseMonth・endYear・calcConventions など入力の一番上）", recipes: &[], tips: &["baseMonth は計算の基準の月（ふつうは今月）、endYear は表の最後の年（本人が90〜100歳になる年が目安）。calcConventions はふつう {\"aggregation\": \"cash\", \"investmentTiming\": \"midYear\", \"compatibility\": null}"] },
    Section { key: "members", path: "/household/members", name: "構成員（本人・配偶者・子・親など）", recipes: &["newChild"], tips: &["kind が self の人を1人入れる。配偶者は kind spouse と relations の spouse の両方が要る", "子を足しただけでは教育費・子の生活費は増えない（児童手当だけ入る）。教育は goals の education、生活費は livingExpenses も。手本は get_input_recipe の newChild"] },
    Section { key: "relations", path: "/household/relations", name: "関係（夫婦・親子）", recipes: &["newChild"], tips: &["夫婦は {\"type\": \"spouse\", \"a\": 本人の UUID, \"b\": 配偶者の UUID, \"marriage\": \"legal\", \"from\": null, \"to\": null}、親子は {\"type\": \"parentOf\", \"parent\": UUID, \"child\": UUID}"] },
    Section { key: "employmentPeriods", path: "/household/employmentPeriods", name: "働き方の期間（会社員・パート・自営業・休業など）", recipes: &["retire"], tips: &["会社員などの type（regular・contract・partTime・civilServant）では healthInsurance・pensionCategory・employer・salary が必須。自営業 selfEmployed は business", "協会けんぽは healthInsurance {\"kind\": \"kyokaikenpo\", \"insurer\": \"kyokaikenpo.13\"}（末尾は都道府県の番号 01〜47。13 は東京）。扶養の配偶者は {\"kind\": \"dependent\"} と pensionCategory \"none\"", "退職の年齢を変えるときは、生活費の退職の段階・積立の終わりも一緒に動かす。手本は get_input_recipe の retire"] },
    Section { key: "accounts", path: "/household/accounts", name: "口座・資産（預金・NISA・iDeCo・課税口座・不動産など）", recipes: &["startNisaIdeco"], tips: &["預金は {\"kind\": \"deposit\", \"owner\": UUID, \"marketValue\": 金額の箱, \"asOf\": \"YYYY-MM\", \"contributions\": []}", "積立は contributions の {\"from\": 時点, \"to\": 時点か null, \"monthly\": 円}。to が null なら退職の月まで"] },
    Section { key: "residences", path: "/household/residences", name: "住まい（賃貸・持ち家の期間）", recipes: &["buyHome"], tips: &["家を買うときは purchase（price・downPayment・costs）を書かないと頭金・諸費用が入らない。住宅ローンは debts に別に足し、住宅ローン控除は debts の housing と events の moveIn で判定する。手本は get_input_recipe の buyHome", "賃貸から買い替えるときは、賃貸の to を購入の前の月にする"] },
    Section { key: "debts", path: "/household/debts", name: "ローン（住宅ローン・車・奨学金など）", recipes: &["buyHome", "prepayment"], tips: &["既に借りているローンは principal・start（借入の時）に加えて balance・balanceAsOf（今の残高）を書く", "繰上返済は prepayments に {\"at\": 時点, \"amount\": 円, \"mode\": \"shortenTerm\"}（mode は必須）。手本は get_input_recipe の prepayment"] },
    Section { key: "insuranceContracts", path: "/household/insuranceContracts", name: "保険の契約", recipes: &[], tips: &["項目が多いので、まず見本の世帯（例 salariedCoupleTwoKids・singleEarnerTwoKids）の契約をまねる"] },
    Section { key: "goals", path: "/household/goals", name: "目標（教育の進路）", recipes: &["newChild"], tips: &["教育は {\"kind\": \"education\", \"owner\": 子の UUID, \"education\": {\"stages\": [{\"stage\": \"elementary\", \"sector\": \"public\"}, …]}}。費用は統計の目安で入る"] },
    Section { key: "livingExpenses", path: "/household/livingExpenses", name: "生活費", recipes: &["newChild", "retire"], tips: &["総額は {\"mode\": \"total\", \"monthly\": 金額の箱}。退職後・子の独立後は stages に {\"at\": 時点, \"label\": \"retirement\", \"ratio\": \"0.8\"}"] },
    Section { key: "periodicExpenses", path: "/household/periodicExpenses", name: "周期的な支出（旅行・家電など）", recipes: &[], tips: &[] },
    Section { key: "incomeFlows", path: "/household/incomeFlows", name: "入るお金の行（相続・贈与・その他の収入）", recipes: &[], tips: &[] },
    Section { key: "pensionRecords", path: "/household/pensionRecords", name: "公的年金の記録（ねんきん定期便など）", recipes: &[], tips: &["無ければ働き方の期間から推計する（答えの知らせに N_ESTIMATED が出る）"] },
    Section { key: "retirementBenefits", path: "/household/retirementBenefits", name: "退職金・企業年金", recipes: &[], tips: &[] },
    Section { key: "events", path: "/household/events", name: "イベント（入居など。時点の {\"event\": UUID} が指す）", recipes: &["buyHome"], tips: &[] },
    Section { key: "assumptions", path: "/assumptions", name: "前提（運用利回り・物価上昇率など）", recipes: &[], tips: &["どれも年ごとの列 {\"default\": \"0.01\"}（率の文字）。investmentReturn は必須"] },
    Section { key: "contingencies", path: "/contingencies", name: "万一の想定（死亡・障害・就業不能。1件まで）", recipes: &["contingency"], tips: &["必要保障額の推移は /protection（{\"members\": [UUID…]}）を足すと計算する"] },
    Section { key: "protection", path: "/protection", name: "必要保障額の推移", recipes: &["contingency"], tips: &[] },
];

fn section_by_key(key: &str) -> Option<&'static Section> {
    SECTIONS.iter().find(|s| s.key == key)
}

/// 見本の世帯を探す順（アプリの主画面の見本を先に）
fn sample_order() -> Vec<(&'static str, Value)> {
    let mut v: Vec<(&'static str, Value)> = HOUSEHOLDS
        .iter()
        .map(|(id, _, json)| {
            let r: Value = serde_json::from_str(json).unwrap_or(Value::Null);
            (*id, r["input"].clone())
        })
        .collect();
    v.sort_by_key(|(id, _)| (*id != "salariedCoupleTwoKids", *id));
    v
}

/// 入力の中の場所（配列の番号は飛ばした道）の、最初に見つかった物
fn find_at<'a>(v: &'a Value, tokens: &[&str]) -> Option<&'a Value> {
    match v {
        Value::Array(a) => a.iter().find_map(|x| find_at(x, tokens)),
        _ => match tokens.split_first() {
            None => Some(v),
            Some((t, rest)) => find_at(v.get(*t)?, rest),
        },
    }
}

fn first_item(v: &Value) -> Option<&Value> {
    match v {
        Value::Array(a) => a.first(),
        Value::Null => None,
        other => Some(other),
    }
}

/// 場所の文字を、配列の番号を除いた道にする（"/household/residences/0/purchase" → ["household","residences","purchase"]。区分の鍵だけでもよい）
fn tokens_of(path: &str) -> Vec<String> {
    let p = path.trim().trim_start_matches('/');
    let mut t: Vec<String> = p
        .split(['/', '.'])
        .filter(|x| !x.is_empty() && *x != "-" && x.parse::<usize>().is_err())
        .map(|x| x.trim_end_matches("[]").to_owned())
        .collect();
    if let Some(first) = t.first() {
        let in_household = schemas().input["$defs"]["household"]["properties"]
            .get(first.as_str())
            .is_some();
        if in_household && schemas().input["properties"].get(first.as_str()).is_none() {
            t.insert(0, "household".into());
        }
    }
    t
}

/// 道をたどってスキーマの場所を探す（配列は中の物へ進む）。Err は見つからなかった所と、そこで使える欄
fn schema_at(tokens: &[String]) -> Result<(Doc, S, Option<S>), String> {
    let mut cur: (Doc, S) = (Doc::Input, &schemas().input);
    let mut field: Option<S> = None;
    for t in tokens {
        cur = into_items(cur.0, cur.1);
        let (props, _) = props_of(cur.0, cur.1);
        let found = props
            .iter()
            .find(|(k, _)| *k == t.as_str())
            .map(|(_, v)| *v);
        let found = found.or_else(|| branch_prop(cur.0, cur.1, t));
        match found {
            Some((d, s)) => {
                field = Some(s);
                cur = (d, s);
            }
            None => {
                let names: Vec<&str> = props.iter().map(|(k, _)| *k).collect();
                return Err(format!(
                    "{t} はここにありません。使える欄: {}",
                    names.join("・")
                ));
            }
        }
    }
    let (d, s) = into_items(cur.0, cur.1);
    Ok((d, s, field))
}

/// oneOf・anyOf の枝の中の欄
fn branch_prop(doc: Doc, s: S, name: &str) -> Option<(Doc, S)> {
    let (d, t) = deref(doc, s);
    for key in ["oneOf", "anyOf"] {
        for b in t.get(key).and_then(Value::as_array).into_iter().flatten() {
            let (bd, bt) = deref(d, b);
            let (props, _) = props_of(bd, bt);
            if let Some((_, v)) = props.into_iter().find(|(k, _)| *k == name) {
                return Some(v);
            }
        }
    }
    None
}

/// 配列なら中の物へ（$ref もたどる）
fn into_items(doc: Doc, s: S) -> (Doc, S) {
    let (mut d, mut t) = deref(doc, s);
    for _ in 0..4 {
        if t.get("type").and_then(Value::as_str) == Some("array") {
            if let Some(items) = t.get("items") {
                let x = deref(d, items);
                d = x.0;
                t = x.1;
                continue;
            }
        }
        break;
    }
    (d, t)
}

/// 物の欄の一覧・条件・枝
fn object_view(doc: Doc, s: S, legend: &mut Legend) -> Map<String, Value> {
    let (d, t) = deref(doc, s);
    let mut out = Map::new();
    let (mut props, req) = props_of(d, t);
    // 必須の欄を先に（それぞれの中はスキーマの並び）
    props.sort_by_key(|(k, _)| !req.contains(k));
    if !props.is_empty() {
        let lines: Vec<Value> = props
            .iter()
            .filter(|(k, _)| *k != "valueStates")
            .map(|(k, (pd, ps))| json!(field_line(k, req.contains(k), *pd, ps, legend)))
            .collect();
        out.insert("fields".into(), Value::Array(lines));
    }
    let conds = conditions(d, t);
    if !conds.is_empty() {
        out.insert("conditions".into(), json!(conds));
    }
    if let Some(list) = t.get("oneOf").and_then(Value::as_array) {
        let mut variants = Vec::new();
        for b in list {
            let (bd, bt) = deref(d, b);
            let (mut bp, br) = props_of(bd, bt);
            bp.sort_by_key(|(k, _)| !br.contains(k));
            if bp.is_empty() {
                variants.push(json!(branch_summary(d, b, legend)));
            } else {
                let lines: Vec<String> = bp
                    .iter()
                    .filter(|(k, _)| *k != "valueStates")
                    .map(|(k, (pd, ps))| field_line(k, br.contains(k), *pd, ps, legend))
                    .collect();
                variants.push(json!({ "when": branch_summary(d, b, legend), "fields": lines }));
            }
        }
        out.insert("variants".into(), Value::Array(variants));
    }
    out
}

/// 区分（または区分の中の物）の説明。name は区分の鍵（members など）か入力の中の場所（/household/residences/purchase など）
pub fn section(name: &str) -> Result<Value, String> {
    let name = name.trim();
    let sec = section_by_key(name).or_else(|| {
        let n = name.trim_end_matches('/');
        SECTIONS.iter().find(|s| !s.path.is_empty() && s.path == n)
    });
    let path = match sec {
        Some(s) => s.path.to_owned(),
        None => name.to_owned(),
    };
    let tokens = tokens_of(&path);
    let (d, s, field) = schema_at(&tokens)?;
    let mut legend = Legend::default();
    let mut out = Map::new();
    let shown: String = if tokens.is_empty() {
        "（入力の一番上）".into()
    } else {
        format!("/{}", tokens.join("/"))
    };
    out.insert("path".into(), json!(shown));
    if let Some(sec) = sec {
        out.insert("section".into(), json!(sec.key));
        out.insert("name".into(), json!(sec.name));
    }
    if let Some(f) = field {
        out.insert("type".into(), json!(label(Doc::Input, f, &mut legend, 1)));
        if let Some(t) = title_of(f) {
            out.insert("about".into(), json!(t));
        }
        // 親の物でこの欄が必須か
        if let Some((last, parent)) = tokens.split_last() {
            if let Ok((pd, ps, _)) = schema_at(parent) {
                let (_, req) = props_of(pd, ps);
                out.insert("required".into(), json!(req.contains(last.as_str())));
            }
        }
    }
    let (_, t) = deref(d, s);
    let is_object = t.get("properties").is_some()
        || t.get("allOf").is_some()
        || t.get("oneOf").is_some()
        || t.get("type").and_then(Value::as_str) == Some("object");
    if is_object {
        out.extend(object_view(d, s, &mut legend));
    } else if field.is_none() {
        out.insert("type".into(), json!(label(d, s, &mut legend, 0)));
    }
    if let Some(sec) = sec {
        if !sec.tips.is_empty() {
            out.insert("tips".into(), json!(sec.tips));
        }
        if !sec.recipes.is_empty() {
            out.insert(
                "recipes".into(),
                json!(format!(
                    "場面の手本（changes の形）: get_input_recipe の {}",
                    sec.recipes.join("・")
                )),
            );
        }
    }
    // 見本の世帯から取った例
    let tok: Vec<&str> = tokens.iter().map(String::as_str).collect();
    if !tok.is_empty() {
        let mut from = None;
        let mut also = Vec::new();
        for (id, input) in sample_order() {
            let found = find_at(&input, &tok).and_then(first_item).cloned();
            if let Some(ex) = found {
                if from.is_none() {
                    from = Some((id, ex));
                } else if also.len() < 6 {
                    also.push(id);
                }
            }
        }
        if let Some((id, ex)) = from {
            if ex.to_string().len() <= MAX_EXAMPLE_BYTES {
                out.insert("example".into(), ex);
            } else {
                out.insert(
                    "example".into(),
                    json!("大きいので省きました。get_sample_household で exampleFrom の世帯を見てください"),
                );
            }
            out.insert("exampleFrom".into(), json!(id));
            if !also.is_empty() {
                out.insert("alsoIn".into(), json!(also));
            }
        }
    }
    let lg = legend.to_value();
    if lg.as_object().is_some_and(|m| !m.is_empty()) {
        out.insert("legend".into(), lg);
    }
    out.insert(
        "note".into(),
        json!("欄の「*」は必須。[ ] は入力項目ID（propose_scenario の item と同じ）。物の欄の中をさらに見るときは path に場所を足す（例 /household/residences/purchase）。"),
    );
    Ok(Value::Object(out))
}

/// 計算できる最小の入力（会社員と扶養のパートの夫婦・賃貸・預金・生活費）。get_input_guide の骨組み（テストで計算できることを確かめる）
pub fn skeleton() -> Value {
    let b = |v: i64| json!({ "value": v, "state": "confirmed", "origin": { "kind": "manual" } });
    json!({
        "baseMonth": "2026-10",
        "endYear": 2076,
        "calcConventions": { "aggregation": "cash", "investmentTiming": "midYear", "compatibility": null },
        "household": {
            "members": [
                { "id": "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8", "kind": "self", "birth": { "birthYearMonth": "1988-05", "bornOnFirst": false }, "sex": "male", "joins": null, "leaves": null, "expected": false },
                { "id": "7a2e3d4c-5b6f-4071-8283-a4b5c6d7e8f9", "kind": "spouse", "birth": { "birthYearMonth": "1990-09", "bornOnFirst": false }, "sex": "female", "joins": null, "leaves": null, "expected": false }
            ],
            "relations": [
                { "type": "spouse", "a": "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8", "b": "7a2e3d4c-5b6f-4071-8283-a4b5c6d7e8f9", "marriage": "legal", "from": null, "to": null }
            ],
            "events": [],
            "employmentPeriods": [
                { "id": "8b3f4e5d-6c70-4182-9394-b5c6d7e8f901", "member": "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8", "from": { "at": "2011-04" }, "to": { "at": "2053-04" }, "type": "regular",
                  "healthInsurance": { "kind": "kyokaikenpo", "insurer": "kyokaikenpo.13" }, "pensionCategory": "employee1", "employer": { "size": 300, "weeklyHours": "40" },
                  "salary": { "annual": b(5_000_000), "bonus": b(1_000_000) }, "unemploymentClaim": false },
                { "id": "9c405f6e-7d81-4293-a4a5-c6d7e8f90112", "member": "7a2e3d4c-5b6f-4071-8283-a4b5c6d7e8f9", "from": { "at": "2020-04" }, "to": { "at": "2050-08" }, "type": "partTime",
                  "healthInsurance": { "kind": "dependent" }, "pensionCategory": "none", "employer": { "size": 20, "weeklyHours": "20" },
                  "salary": { "annual": b(1_000_000), "bonus": b(0) }, "unemploymentClaim": false }
            ],
            "accounts": [
                { "id": "ad516a7f-8e92-43a4-b5b6-d7e8f9011223", "kind": "deposit", "owner": "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8", "marketValue": b(5_000_000), "asOf": "2026-09", "contributions": [] }
            ],
            "insuranceContracts": [],
            "residences": [
                { "id": "be627b80-9fa3-44b5-86c7-e8f901122334", "kind": "rent", "from": { "at": "2018-04" }, "to": null,
                  "rent": { "monthly": b(110_000), "renewalFee": "1", "renewalEveryMonths": 24 } }
            ],
            "livingExpenses": [
                { "id": "cf738c91-a0b4-45c6-97d8-f90112233445", "mode": "total", "monthly": b(250_000),
                  "stages": [ { "at": { "at": "2053-05" }, "label": "retirement", "ratio": "0.8" } ] }
            ]
        },
        "assumptions": {
            "investmentReturn": { "default": "0.02" },
            "depositReturn": { "default": "0.001" },
            "wageGrowth": { "default": "0.01" },
            "inflation": { "default": "0.01" }
        }
    })
}

/// UUID 第4版（小文字）
pub fn new_uuid() -> String {
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

/// 区分を指定しないときの答え: 形の決まり・区分の一覧・骨組み・新しい ID
pub fn overview() -> Value {
    let mut legend = Legend::default();
    let s = &schemas().input;
    let (top, top_req) = props_of(Doc::Input, s);
    let top_lines: Vec<Value> = top
        .iter()
        .filter(|(k, _)| {
            !matches!(
                *k,
                "valueStates" | "dataSet" | "estimateValues" | "estimateNoFill"
            )
        })
        .map(|(k, (d, v))| json!(field_line(k, top_req.contains(k), *d, v, &mut legend)))
        .collect();
    let hh = &s["$defs"]["household"];
    let (_, hh_req) = props_of(Doc::Input, hh);
    let sections: Vec<Value> = SECTIONS
        .iter()
        .filter(|x| !x.path.is_empty())
        .map(|x| {
            let last = x.path.rsplit('/').next().unwrap_or("");
            let req = x.path.starts_with("/household/") && hh_req.contains(last);
            json!(format!(
                "{}{}: {}（{}）",
                x.key,
                if req { "*" } else { "" },
                x.name,
                x.path
            ))
        })
        .collect();
    let ids: Vec<String> = (0..8).map(|_| new_uuid()).collect();
    json!({
        "about": "calculate の input（エンジンへの要求の input）の形の案内です。エンジンと同じスキーマから作っています。全体は大きいので、区分ごとに section で引いてください。",
        "rules": [
            "ID はどれも UUID 第4版の文字（小文字・ハイフンつき。\"self\" などの名前は使えない）。構成員・物の ID は世帯の中で別々にし、member・owner などはその ID で指す。新しい ID は freshIds を使ってよい",
            "金額の欄の多くは値の箱 {\"value\": 円の整数, \"state\": \"confirmed\", \"origin\": {\"kind\": \"manual\"}}。円は整数（万円にしない）",
            "率は10進の文字列（1.5% は \"0.015\"）。前提（assumptions）の率は年ごとの列 {\"default\": \"0.01\"}",
            "年月は \"YYYY-MM\"。時点の欄は {\"at\": \"YYYY-MM\"}・{\"memberAge\": {\"member\": UUID, \"years\": 60}}・{\"event\": UUID} のどれか",
            "household の members・relations・events・employmentPeriods・accounts・insuranceContracts は、空でも配列で書く",
            "書かなかった物は計算に入らない（家の頭金・諸費用、子の教育費・子の生活費など）。場面ごとの欄のそろえ方は get_input_recipe の手本を使う",
            "計算できなかったときは、答えの「直し方」に足りない欄・選べる値・正しい形が出る"
        ],
        "topLevel": top_lines,
        "sections": sections,
        "skeleton": skeleton(),
        "skeletonNote": "計算できる最小の入力の例（会社員と扶養のパートの夫婦・賃貸・預金・生活費）。これを写して直し、get_input_recipe の手本（子・家・NISA など）を重ねると、少ない回数で計算できます。",
        "freshIds": ids,
        "legend": legend.to_value(),
        "next": "区分の欄は get_input_guide に section（例 \"members\"・\"residences\"）か path（例 \"/household/residences/purchase\"）を渡して引く。場面の手本は get_input_recipe（recipe を省くと一覧）。"
    })
}

// ---------- 入力を確かめ直す（直し方の手がかり） ----------

/// 直し方の手がかりの1件（場所は input の中の JSON Pointer）
#[derive(Debug, Clone)]
pub struct Problem {
    pub at: String,
    pub keyword: &'static str,
    pub text: String,
}

fn regex_for(p: &str) -> Option<Regex> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Regex>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
    c.entry(p.to_owned())
        .or_insert_with(|| Regex::new(p).ok())
        .clone()
}

fn type_ok(t: &str, v: &Value) -> bool {
    match t {
        "object" => v.is_object(),
        "array" => v.is_array(),
        "string" => v.is_string(),
        "boolean" => v.is_boolean(),
        "null" => v.is_null(),
        "number" => v.is_number(),
        "integer" => v.is_i64() || v.is_u64() || v.as_f64().is_some_and(|f| f.fract() == 0.0),
        _ => true,
    }
}

fn esc(k: &str) -> String {
    k.replace('~', "~0").replace('/', "~1")
}

struct Checker {
    out: Vec<Problem>,
    limit: usize,
}

impl Checker {
    fn new(limit: usize) -> Self {
        Self {
            out: Vec::new(),
            limit,
        }
    }
    fn full(&self) -> bool {
        self.out.len() >= self.limit
    }
    fn push(&mut self, at: &str, keyword: &'static str, text: String) {
        if !self.full() && !self.out.iter().any(|p| p.at == at && p.text == text) {
            self.out.push(Problem {
                at: at.to_owned(),
                keyword,
                text,
            });
        }
    }

    fn valid(doc: Doc, s: S, v: &Value) -> bool {
        let mut c = Checker::new(1);
        c.check(doc, s, v, "");
        c.out.is_empty()
    }

    fn check(&mut self, doc: Doc, s: S, v: &Value, at: &str) {
        if self.full() {
            return;
        }
        if let Some(b) = s.as_bool() {
            if !b {
                self.push(at, "false", "この欄は使えません".into());
            }
            return;
        }
        if let Some(r) = s.get("$ref").and_then(Value::as_str) {
            if let Some((d, t, name)) = follow(doc, r) {
                let k = name.and_then(|n| known(d, n));
                if let Some(k) = k {
                    let mut sub = Checker::new(self.limit);
                    sub.check(d, t, v, at);
                    if sub.out.iter().any(|p| p.at == at) {
                        self.push(at, "type", format!("{}にします: {}", k.label, k.legend));
                    } else {
                        for p in sub.out {
                            self.push(&p.at, p.keyword, p.text);
                        }
                    }
                } else {
                    self.check(d, t, v, at);
                }
            }
        }
        if let Some(t) = s.get("type") {
            let ok = match t {
                Value::String(x) => type_ok(x, v),
                Value::Array(a) => a.iter().filter_map(Value::as_str).any(|x| type_ok(x, v)),
                _ => true,
            };
            if !ok {
                let mut lg = Legend::default();
                let want = label(doc, s, &mut lg, 1);
                self.push(
                    at,
                    "type",
                    format!(
                        "形が違います（{}にします）",
                        if want.is_empty() { t.to_string() } else { want }
                    ),
                );
                return;
            }
        }
        if let Some(e) = s.get("enum").and_then(Value::as_array) {
            if !e.contains(v) {
                self.push(at, "enum", format!("選べる値: {}", fmt_values(e)));
            }
        }
        if let Some(c) = s.get("const") {
            if c != v {
                self.push(at, "const", format!("値は {c} にします"));
            }
        }
        match v {
            Value::String(x) => {
                if let Some(p) = s.get("pattern").and_then(Value::as_str) {
                    if let Some(re) = regex_for(p) {
                        if !re.is_match(x) {
                            self.push(at, "pattern", format!("形が違います（{p}）"));
                        }
                    }
                }
                let n = x.chars().count() as u64;
                if let Some(m) = s.get("maxLength").and_then(Value::as_u64) {
                    if n > m {
                        self.push(at, "maxLength", format!("{m}字までにします"));
                    }
                }
                if let Some(m) = s.get("minLength").and_then(Value::as_u64) {
                    if n < m {
                        self.push(at, "minLength", format!("{m}字以上にします"));
                    }
                }
            }
            Value::Number(n) => {
                let f = n.as_f64().unwrap_or(0.0);
                if let Some(m) = s.get("minimum").and_then(Value::as_f64) {
                    if f < m {
                        self.push(at, "minimum", format!("{} 以上にします", s["minimum"]));
                    }
                }
                if let Some(m) = s.get("maximum").and_then(Value::as_f64) {
                    if f > m {
                        self.push(at, "maximum", format!("{} 以下にします", s["maximum"]));
                    }
                }
            }
            Value::Object(m) => self.check_object(doc, s, m, at),
            Value::Array(a) => {
                if let Some(items) = s.get("items") {
                    for (i, x) in a.iter().enumerate() {
                        self.check(doc, items, x, &format!("{at}/{i}"));
                    }
                }
                if let Some(n) = s.get("minItems").and_then(Value::as_u64) {
                    if (a.len() as u64) < n {
                        self.push(at, "minItems", format!("{n}件以上にします"));
                    }
                }
                if let Some(n) = s.get("maxItems").and_then(Value::as_u64) {
                    if (a.len() as u64) > n {
                        self.push(at, "maxItems", format!("{n}件までにします"));
                    }
                }
            }
            _ => {}
        }
        if let Some(list) = s.get("allOf").and_then(Value::as_array) {
            for b in list {
                self.check(doc, b, v, at);
            }
        }
        for key in ["oneOf", "anyOf"] {
            if let Some(list) = s.get(key).and_then(Value::as_array) {
                self.check_branches(doc, list, v, at);
            }
        }
        if let Some(n) = s.get("not") {
            if Self::valid(doc, n, v) {
                let text = match n.get("required").and_then(Value::as_array) {
                    Some(r) => format!(
                        "{} は書かないでください（ほかの欄と一緒にできません）",
                        r.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("・")
                    ),
                    None => "この組み合わせは使えません".into(),
                };
                self.push(at, "not", text);
            }
        }
        if let Some(cond) = s.get("if") {
            if Self::valid(doc, cond, v) {
                if let Some(th) = s.get("then") {
                    let before = self.out.len();
                    self.check(doc, th, v, at);
                    let ctext = cond_text(cond);
                    if let Some(c) = ctext {
                        for p in self.out.iter_mut().skip(before) {
                            if p.at == at {
                                p.text = format!("{c}: {}", p.text);
                            }
                        }
                    }
                }
            } else if let Some(el) = s.get("else") {
                self.check(doc, el, v, at);
            }
        }
    }

    fn check_object(&mut self, doc: Doc, s: S, m: &Map<String, Value>, at: &str) {
        let props = s.get("properties").and_then(Value::as_object);
        if let Some(req) = s.get("required").and_then(Value::as_array) {
            let missing: Vec<&str> = req
                .iter()
                .filter_map(Value::as_str)
                .filter(|k| !m.contains_key(*k))
                .collect();
            if !missing.is_empty() {
                // 足りない欄の形と説明（全体の欄の一覧から）
                let (all, _) = props_of(doc, s);
                let mut lg = Legend::default();
                let parts: Vec<String> = missing
                    .iter()
                    .map(|k| match all.iter().find(|(n, _)| n == k) {
                        Some((_, (d, ps))) => format!("{k}（{}）", label(*d, ps, &mut lg, 0)),
                        None => (*k).to_owned(),
                    })
                    .collect();
                self.push(at, "required", format!("足りない欄: {}", parts.join("・")));
            }
        }
        if let Some(p) = props {
            for (k, ps) in p {
                if let Some(x) = m.get(k) {
                    self.check(doc, ps, x, &format!("{at}/{}", esc(k)));
                }
            }
        }
        if let Some(names) = s.get("propertyNames") {
            for k in m.keys() {
                let kv = Value::String(k.clone());
                if !Self::valid(doc, names, &kv) {
                    let mut lg = Legend::default();
                    self.push(
                        &format!("{at}/{}", esc(k)),
                        "propertyNames",
                        format!("鍵の形が違います（{}）", label(doc, names, &mut lg, 1)),
                    );
                }
            }
        }
        match s.get("additionalProperties") {
            Some(Value::Bool(false)) => {
                let unknown: Vec<&str> = m
                    .keys()
                    .map(String::as_str)
                    .filter(|k| props.is_none_or(|p| !p.contains_key(*k)))
                    .collect();
                if !unknown.is_empty() {
                    let allowed: Vec<&str> = props
                        .map(|p| {
                            p.keys()
                                .map(String::as_str)
                                .filter(|k| *k != "valueStates")
                                .collect()
                        })
                        .unwrap_or_default();
                    let more = if allowed.len() > 30 { "…" } else { "" };
                    self.push(
                        at,
                        "additionalProperties",
                        format!(
                            "知らない欄: {}。使える欄: {}{more}",
                            unknown.join("・"),
                            allowed
                                .iter()
                                .take(30)
                                .copied()
                                .collect::<Vec<_>>()
                                .join("・")
                        ),
                    );
                }
            }
            Some(ap) if ap.is_object() => {
                for (k, x) in m {
                    if props.is_none_or(|p| !p.contains_key(k)) {
                        self.check(doc, ap, x, &format!("{at}/{}", esc(k)));
                    }
                }
            }
            _ => {}
        }
        if let Some(n) = s.get("minProperties").and_then(Value::as_u64) {
            if (m.len() as u64) < n {
                self.push(at, "minProperties", format!("欄を{n}つ以上にします"));
            }
        }
    }

    /// oneOf・anyOf: どれかの枝が通れば良い。通らなければ、合いそうな枝（ここで種類・決まった値が外れていない枝）の問題を返す
    fn check_branches(&mut self, doc: Doc, list: &'static [Value], v: &Value, at: &str) {
        let mut results: Vec<Vec<Problem>> = Vec::new();
        for b in list {
            let mut c = Checker::new(MAX_PROBLEMS);
            c.check(doc, b, v, at);
            if c.out.is_empty() {
                return;
            }
            results.push(c.out);
        }
        // 合いそうな枝: ここで形・知らない欄が外れておらず、すぐ下の欄の決まった値（関係の type など）も外れていない枝
        let child = |p: &str| {
            p.strip_prefix(at)
                .and_then(|r| r.strip_prefix('/'))
                .is_some_and(|r| !r.contains('/'))
        };
        let near: Vec<&Vec<Problem>> = results
            .iter()
            .filter(|ps| {
                !ps.iter().any(|p| {
                    (p.at == at && matches!(p.keyword, "type" | "const" | "additionalProperties"))
                        || (child(&p.at) && p.keyword == "const")
                })
            })
            .collect();
        let fewest = near.iter().map(|ps| ps.len()).min();
        let best: Vec<&&Vec<Problem>> = near.iter().filter(|ps| Some(ps.len()) == fewest).collect();
        if best.len() == 1 {
            for p in best[0].iter() {
                self.push(&p.at, p.keyword, p.text.clone());
            }
            return;
        }
        let mut lg = Legend::default();
        let parts: Vec<String> = list
            .iter()
            .map(|b| branch_summary(doc, b, &mut lg))
            .collect();
        self.push(
            at,
            "oneOf",
            format!("次の形のどれかにします: {}", parts.join(" / ")),
        );
    }
}

/// 入力をスキーマで確かめ直し、直し方の手がかりを返す（上限 MAX_PROBLEMS 件）。エンジンが通した入力には使わない
pub fn check_input(input: &Value) -> Vec<Problem> {
    let mut c = Checker::new(MAX_PROBLEMS);
    c.check(Doc::Input, &schemas().input, input, "");
    c.out
}

/// UUID の形の値のうち、世帯の中のどの物の id とも合わない物の場所（member・owner などの指し先の誤り）
pub fn unknown_refs(input: &Value) -> Vec<String> {
    static UUID: OnceLock<Regex> = OnceLock::new();
    let re = UUID.get_or_init(|| {
        Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
            .unwrap()
    });
    let mut ids = HashSet::new();
    fn collect_ids<'a>(v: &'a Value, ids: &mut HashSet<&'a str>) {
        match v {
            Value::Object(m) => {
                for (k, x) in m {
                    if k == "id" {
                        if let Some(s) = x.as_str() {
                            ids.insert(s);
                        }
                    }
                    collect_ids(x, ids);
                }
            }
            Value::Array(a) => a.iter().for_each(|x| collect_ids(x, ids)),
            _ => {}
        }
    }
    collect_ids(input, &mut ids);
    let mut out = Vec::new();
    fn walk(v: &Value, at: String, ids: &HashSet<&str>, re: &Regex, out: &mut Vec<String>) {
        if out.len() >= 10 {
            return;
        }
        match v {
            Value::Object(m) => {
                for (k, x) in m {
                    if k == "id" {
                        continue;
                    }
                    walk(x, format!("{at}/{}", esc(k)), ids, re, out);
                }
            }
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    walk(x, format!("{at}/{i}"), ids, re, out);
                }
            }
            Value::String(s) if re.is_match(s) && !ids.contains(s.as_str()) => out.push(at),
            _ => {}
        }
    }
    walk(input, String::new(), &ids, re, &mut out);
    out
}

/// エンジンのエラーのコードごとの直し方の目安
fn code_hint(code: &str) -> &'static str {
    match code {
        "E_INPUT_SCHEMA" => "入力の形がスキーマに合いません。",
        "E_TIMEPOINT_UNKNOWN" => "時点の欄（{\"event\": …}・{\"memberAge\": {\"member\": …}}）や member・owner が、世帯に無い構成員・イベントの ID を指しています。",
        "E_TIMEPOINT_CYCLE" => "時点の欄がお互いを指し合っています（イベントの時点を、そのイベント自身や、それを指す物の時点で決めない）。",
        "E_ID_FORMAT" => "ID の形が違います（UUID 第4版の小文字）。",
        "E_RATE_FORMAT" => "率の形が違います（10進の文字列。例 \"0.015\"）。",
        "E_UNSAFE_INTEGER" => "金額が大きすぎます（円の整数。桁を確かめてください）。",
        "E_PARAM_NO_VALUE" => "制度データに無い時点の値を使おうとしました（baseMonth・生年月・期間の年月が、制度データの範囲〔おおむね1940年代〜〕を外れていないか確かめてください）。",
        "E_ARGUMENT" => "入力の値の組み合わせが計算できない形です（関係する ID の欄を確かめてください）。",
        "E_NOT_REPLACEABLE" => "置き換えできない所を置き換えようとしました。",
        _ => "",
    }
}

/// 計算できなかったときに、エラーの文に足す「直し方」。input は計算に渡した入力（changes を当てた後）。値は写さない
pub fn engine_error_help(code: &str, ids: &Value, input: &Value) -> String {
    let mut lines: Vec<String> = Vec::new();
    let hint = code_hint(code);
    if !hint.is_empty() {
        lines.push(hint.to_owned());
    }
    // エンジンが返した場所（"/input/…:keyword"）
    let engine_at: Vec<(String, String)> = ids
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|s| s.rsplit_once(':'))
        .filter(|(p, _)| p.starts_with('/'))
        .map(|(p, k)| {
            let p = p.strip_prefix("/input").unwrap_or(p);
            (p.to_owned(), k.to_owned())
        })
        .collect();
    let mut problems = if code == "E_INPUT_SCHEMA" {
        check_input(input)
    } else {
        Vec::new()
    };
    // エンジンが言った場所を先に
    problems.sort_by_key(|p| !engine_at.iter().any(|(a, _)| *a == p.at));
    if problems.is_empty() {
        for (at, kw) in &engine_at {
            lines.push(format!(
                "- {}: スキーマの {kw} に合いません。{}",
                show_at(at),
                describe_at(at)
            ));
        }
    } else {
        lines.push(
            "直し方（同じスキーマで入力を確かめ直した結果。上から順に直してください）:".into(),
        );
        let mut seen = HashSet::new();
        for p in &problems {
            // 同じ形の説明は2回目から短く
            let text = match p.text.split_once("にします: ") {
                Some((head, _)) if !seen.insert(p.text.clone()) => {
                    format!("{head}にします（形は上と同じ）")
                }
                _ => p.text.clone(),
            };
            lines.push(format!("- {}: {text}", show_at(&p.at)));
        }
        if problems.len() >= MAX_PROBLEMS {
            lines.push(format!(
                "（ほかにもあるかもしれません。最初の{MAX_PROBLEMS}件だけです）"
            ));
        }
    }
    if code != "E_INPUT_SCHEMA" || problems.is_empty() {
        let refs = unknown_refs(input);
        if !refs.is_empty() {
            lines.push(format!(
                "世帯のどの物の id とも合わない ID が入っている場所: {}",
                refs.iter()
                    .map(|x| show_at(x))
                    .collect::<Vec<_>>()
                    .join("・")
            ));
        }
    }
    lines.push("区分ごとの欄・必須・選べる値・例は get_input_guide（section に区分の名前）、よくある場面の欄のそろえ方は get_input_recipe で引けます。".into());
    lines.join("\n")
}

fn show_at(at: &str) -> String {
    if at.is_empty() {
        "input（一番上）".into()
    } else {
        at.to_owned()
    }
}

/// エンジンが言った場所の欄の説明（確かめ直しで見つからなかったとき）
fn describe_at(at: &str) -> String {
    let tokens = tokens_of(at);
    match schema_at(&tokens) {
        Ok((d, s, field)) => {
            let mut lg = Legend::default();
            let f = field
                .map(|f| label(Doc::Input, f, &mut lg, 0))
                .unwrap_or_else(|| label(d, s, &mut lg, 0));
            let legend: Vec<String> = lg
                .to_value()
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| format!("{k}＝{}", v.as_str().unwrap_or("")))
                        .collect()
                })
                .unwrap_or_default();
            if legend.is_empty() {
                format!("ここは {f}")
            } else {
                format!("ここは {f}（{}）", legend.join("。"))
            }
        }
        Err(e) => e,
    }
}

/// changes を当てられなかったときに足す目安
pub const CHANGE_TIP: &str = "path は input の中の場所（例 /household/members/-）。配列の末尾に足すときは /-、配列がまだ無いときは配列ごと add（例 {\"op\":\"add\",\"path\":\"/household/goals\",\"value\":[…]}）。区分の名前と欄は get_input_guide、場面の手本は get_input_recipe で引けます。";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_sample_household_passes_the_checker() {
        // エンジンが通す見本の世帯を、ここの確かめが止めない（偽の問題を出さない）
        for (id, _, json) in HOUSEHOLDS {
            let r: Value = serde_json::from_str(json).unwrap();
            let p = check_input(&r["input"]);
            assert!(p.is_empty(), "{id}: {p:?}");
            assert!(
                unknown_refs(&r["input"]).is_empty(),
                "{id}: {:?}",
                unknown_refs(&r["input"])
            );
        }
        assert!(check_input(&skeleton()).is_empty());
    }

    #[test]
    fn finds_missing_fields_and_wrong_shapes_at_once() {
        let mut input = skeleton();
        input.as_object_mut().unwrap().remove("calcConventions");
        input["household"]["members"][0]["id"] = json!("self");
        input["household"]["members"][1]
            .as_object_mut()
            .unwrap()
            .remove("sex");
        input["household"]["accounts"][0]["marketValue"] = json!(5_000_000);
        input["assumptions"]["inflation"] = json!("0.02");
        input["household"]["residences"][0]["kind"] = json!("rental");
        let p = check_input(&input);
        let text: Vec<String> = p.iter().map(|x| format!("{} {}", x.at, x.text)).collect();
        let has = |at: &str, part: &str| {
            text.iter()
                .any(|t| t.starts_with(&format!("{at} ")) && t.contains(part))
        };
        assert!(has("", "calcConventions"), "{text:?}");
        assert!(has("/household/members/0/id", "UUID"), "{text:?}");
        assert!(has("/household/members/1", "sex"), "{text:?}");
        assert!(
            has("/household/accounts/0/marketValue", "値の箱"),
            "{text:?}"
        );
        assert!(has("/assumptions/inflation", "default"), "{text:?}");
        assert!(has("/household/residences/0/kind", "rent|own"), "{text:?}");
        // 値は写さない
        assert!(
            !text
                .iter()
                .any(|t| t.contains("5000000") || t.contains("rental")),
            "{text:?}"
        );
    }

    #[test]
    fn explains_variants_and_conditions() {
        let mut input = skeleton();
        input["household"]["relations"][0] =
            json!({ "type": "parentOf", "parent": "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" });
        input["household"]["employmentPeriods"][0]
            .as_object_mut()
            .unwrap()
            .remove("salary");
        input["household"]["livingExpenses"][0]["stages"][0]["at"] = json!("2053-05");
        let p = check_input(&input);
        let text: Vec<String> = p.iter().map(|x| format!("{} {}", x.at, x.text)).collect();
        assert!(
            text.iter()
                .any(|t| t.starts_with("/household/relations/0 ") && t.contains("child")),
            "{text:?}"
        );
        assert!(
            text.iter()
                .any(|t| t.starts_with("/household/employmentPeriods/0 ")
                    && t.contains("salary")
                    && t.contains("type が")),
            "{text:?}"
        );
        assert!(
            text.iter().any(
                |t| t.starts_with("/household/livingExpenses/0/stages/0/at ")
                    && t.contains("{\"at\"")
            ),
            "{text:?}"
        );
    }

    #[test]
    fn finds_ids_that_point_nowhere() {
        let mut input = skeleton();
        input["household"]["accounts"][0]["owner"] = json!("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
        assert_eq!(
            unknown_refs(&input),
            vec!["/household/accounts/0/owner".to_owned()]
        );
    }

    #[test]
    fn sections_are_short_and_have_examples() {
        for s in SECTIONS {
            let key = if s.path.is_empty() { "plan" } else { s.key };
            let v = section(key).unwrap_or_else(|e| panic!("{key}: {e}"));
            let n = v.to_string().len();
            assert!(n < 16 * 1024, "{key}: {n} バイト");
            if !s.path.is_empty() {
                assert!(
                    v["fields"].is_array() || v["variants"].is_array(),
                    "{key}: {v}"
                );
            }
        }
        let r = section("residences").unwrap();
        let lines: Vec<&str> = r["fields"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert!(
            lines.iter().any(|l| l.starts_with("kind*: 選択 rent|own")),
            "{lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|l| l.starts_with("purchase: 物（") && l.contains("price*")),
            "{lines:?}"
        );
        assert!(r["example"].is_object());
        let p = section("/household/residences/0/purchase").unwrap();
        assert!(
            p["fields"]
                .as_array()
                .unwrap()
                .iter()
                .any(|l| l.as_str().unwrap().starts_with("downPayment*: 円")),
            "{p}"
        );
        assert_eq!(p["required"], json!(false));
        let rel = section("relations").unwrap();
        assert_eq!(rel["variants"].as_array().unwrap().len(), 2, "{rel}");
        let emp = section("employmentPeriods").unwrap();
        assert!(
            emp["conditions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c.as_str().unwrap().contains("salary")),
            "{emp}"
        );
        assert!(section("nope").is_err());
        let o = overview();
        assert!(o.to_string().len() < 16 * 1024, "{}", o.to_string().len());
        assert_eq!(o["freshIds"].as_array().unwrap().len(), 8);
    }

    #[test]
    fn short_drops_record_numbers() {
        assert_eq!(short("0008 の2: 円の金額の値の箱"), "円の金額の値の箱");
        assert_eq!(short("0008 の追記（2026-10-10）: 贈与者"), "贈与者");
        assert_eq!(short("6.3: 必要保障額の推移"), "必要保障額の推移");
        assert_eq!(short("0044: 入るお金の行"), "入るお金の行");
    }

    #[test]
    fn new_ids_are_uuid_v4() {
        let re =
            Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
                .unwrap();
        for _ in 0..50 {
            assert!(re.is_match(&new_uuid()));
        }
    }
}
