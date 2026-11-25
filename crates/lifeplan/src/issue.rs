//! 不具合を調べて報告をまとめる（0234）: アプリのエラーの記録を読む道具（get_error_log）の答えの形と、
//! FP が「要望・不具合を送る」のフォームにそのまま貼れる報告文を組み立てる道具（draft_issue_report）。
//!
//! - 報告文は AI が渡した見立て・根拠・見本の世帯での再現の手順を、決まった見出しで並べるだけ。どこにも送らない・フォームを開かない・
//!   URL に載せない（0087 の6 の骨格。アプリもこの道具も何も送らない。送るのは FP がフォームに貼って行う）
//! - 組み立てた文は、propose_issue_report でアプリの「送る報告の確認画面」に出せる（0259。アプリが起動していて AI接続がオンのとき）。
//!   FP が画面で中身を確かめて「送る」を押すと、アプリが文をクリップボードに写してフォームを開く（文は URL に入れない）
//! - お客さまの名前・生年月日・実際の金額・世帯を識別する値は入れない決まりを文で伝え、共有の ID の形の値は報告文から伏せ、
//!   生年月日のような日付には注意（cautions）を添える（名前は形で見分けられないので、AI と FP が確かめる）

use crate::samples;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

/// アプリが起動していない・AI接続がオフのとき（エラーの記録は読めない）
pub const NOT_RUNNING_ERROR_LOG: &str = "アプリが起動していないか、AI接続がオフのため、エラーの記録を読めません。FP に、アプリの「要望・不具合を送る」の「エラーの記録」で「記録を写す」を押して、この会話に貼ってもらってください（記録には世帯の中身は入っていません）。";

/// エラーの記録の読み方（AI に添える）
const ERROR_LOG_NOTE: &str = "この PC のアプリで起きたエラーの記録です（新しい順。同じエラーは1件にまとめ、count が回数）。日時・アプリの版・OS・画面（place）・操作（action）・種類（kindLabel）・文（message）だけで、お客さまの名前・金額・生年月日・メモ・ファイルの場所は入っていません（文の中の日本語・数字・引用符の中・場所はアプリが伏せています: … # <場所>）。どの世帯で起きたかは分かりません。報告に入れるときは line をそのまま写してください。";

/// FP の送り方（報告文には入れず、答えの `howToSend` で AI に渡す。報告文はフォームの内容の欄に貼る物なので、送り方の案内は混ぜない。0259）
pub const HOW_TO_SEND: &str = "送り方: アプリが起動していて AI接続がオンなら、propose_issue_report の items に kind: bug・screen・text（この文）の1件として入れ（ほかに話された要望・不具合があれば、1件ずつに分けて同じ items に並べ）、アプリの「送る報告の確認画面」に出せます。FP が中身を確かめて「送る」を押すと、アプリが文をクリップボードに写して、ブラウザでフォームを開きます（FP はフォームの内容の欄に貼り付けて送ります）。出せないときは、FP がアプリの「要望・不具合を送る」で「報告の文を書いて送る」を押し、この文を貼ります。アプリと AI は何も送りません。";

/// propose_issue_report を呼べないとき（アプリが起動していない・AI接続がオフ）
pub const NOT_RUNNING_PROPOSE: &str = "アプリが起動していないか、AI接続がオフのため、送る報告の確認画面に出せませんでした（何も送っていません）。報告の文を FP に見せ、アプリの「要望・不具合を送る」で「報告の文を書いて送る」を押して、この文を貼ってもらってください。";

/// 報告文に入れない値の決まり（報告文の終わりと道具の説明で同じ文）
pub const PRIVACY_LINE: &str = "この報告には、お客さまの名前・生年月日・実際の金額・世帯を識別する値（共有の ID・顧客番号など）を入れていません。";

const MAX_FIELD_CHARS: usize = 1000;
const MAX_LIST: usize = 20;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ErrorLogArgs {
    /// 返す件数（新しい順。1〜100。既定 30）
    #[schemars(range(min = 1, max = 100))]
    pub limit: Option<u8>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct IssueReportArgs {
    /// 何が起きたか（1〜2文。例「結果のタブで、65歳の時点の金融資産が前の版より大きく減った」「入力のタブで計算できませんでしたと出る」）
    pub summary: String,
    /// 画面（例「結果」「入力」「資産と負債」）
    pub screen: Option<String>,
    /// 行・欄（例「キャッシュフロー表の 税・社会保険料」「金融資産残高」）
    pub row: Option<String>,
    /// 何年目・何年・何歳の時点（例「2035年（10年目）」「本人65歳」）
    pub when: Option<String>,
    /// 期待した値（見本の世帯の値か、言葉で。例「前の年と同じくらい」）
    pub expected: Option<String>,
    /// 実際の値（見本の世帯の値か、言葉で）
    pub actual: Option<String>,
    /// AI の見立て: input＝入力が原因（ここを直せば戻る）・calculation＝計算の仕組みの不具合の疑い・unknown＝まだ分からない
    pub diagnosis: String,
    /// 見立ての根拠（道具の名前と、答えの要点。例「check_inputs: 住宅ローンの残高が空（確かめの一覧の行）」「explain_value: 2035年の所得税の式に…」）。1〜20件
    pub evidence: Vec<String>,
    /// 入力が原因のとき、どこを直せば戻るか（入力項目と欄の名前）
    pub fix: Option<String>,
    /// 再現に使った見本の世帯の id（list_sample_households）。見本で再現できなかったときは省く
    pub sample_household_id: Option<String>,
    /// 見本の世帯に足す変更（言葉で。例「本人の退職の年齢を 60歳にする」「住宅ローンを変動金利・残り25年にする」）。20件まで
    pub reproduce_changes: Option<Vec<String>>,
    /// アプリの画面で再現する手順（例「見本の棚から開く」「結果のタブでキャッシュフロー表を開く」）。20件まで
    pub reproduce_steps: Option<Vec<String>>,
    /// 見本の世帯に変更を足して、同じことが起きたか（calculate で確かめた結果）。省くと確かめていない
    pub reproduced: Option<bool>,
    /// エラーの記録（get_error_log の line）のうち、関係する行。20件まで
    pub error_log_lines: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProposeIssueReportArgs {
    /// 報告の件（1〜20件）。FP が話した要望・不具合・質問を1件ずつに分けて並べ、まとめて1回で渡す
    pub items: Vec<ProposeIssueItem>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProposeIssueItem {
    /// 種類: bug（不具合。思ったとおりに動かない）・request（要望。こうしてほしい）・question（質問）
    pub kind: String,
    /// どの画面のことか（入力・結果・資産と負債・万一のとき・提案書・事務所の設定・保存・AI 接続・URL で答えるヒアリング・その他・分からない のどれか。分からなければ省く）
    pub screen: Option<String>,
    /// 内容（不具合なら draft_issue_report の text をそのまま。要望・質問は何をしたら・どうなったか・どうしてほしいかを短く。お客さまの名前・金額は書かない。12,000文字まで）
    pub text: String,
}

/// 件の種類（道具の引数）
pub const ISSUE_KINDS: [&str; 3] = ["bug", "request", "question"];

fn clean(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t = hide_share_ids(&t);
    if t.chars().count() > MAX_FIELD_CHARS {
        let mut c: String = t.chars().take(MAX_FIELD_CHARS - 1).collect();
        c.push('…');
        c
    } else {
        t
    }
}

fn given(v: &Option<String>) -> Option<String> {
    v.as_deref().map(clean).filter(|s| !s.is_empty())
}

fn list(v: &Option<Vec<String>>) -> Vec<String> {
    v.iter()
        .flatten()
        .map(|s| clean(s))
        .filter(|s| !s.is_empty())
        .collect()
}

/// 共有の ID（s- と16進32文字）の形の値を伏せる
fn hide_share_ids(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let starts = chars[i] == 's'
            && chars.get(i + 1) == Some(&'-')
            && (i == 0 || !chars[i - 1].is_ascii_alphanumeric());
        if starts {
            let hex = chars[i + 2..]
                .iter()
                .take_while(|c| c.is_ascii_hexdigit())
                .count();
            if hex >= 16 {
                out.push_str("（共有の ID は書きません）");
                i += 2 + hex;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 生年月日のような日付（年・月・日がそろった形）があるか
fn has_full_date(s: &str) -> bool {
    let c: Vec<char> = s.chars().collect();
    let digits = |from: usize| c[from..].iter().take_while(|x| x.is_ascii_digit()).count();
    let mut i = 0;
    while i < c.len() {
        if c[i].is_ascii_digit() && (i == 0 || !c[i - 1].is_ascii_digit()) {
            let y = digits(i);
            if y == 4 {
                let mut j = i + 4;
                let sep = c.get(j).copied();
                if matches!(sep, Some('-' | '/' | '.' | '年')) {
                    j += 1;
                    let m = digits(j);
                    if (1..=2).contains(&m) {
                        j += m;
                        let sep2 = c.get(j).copied();
                        let ok = match sep {
                            Some('年') => sep2 == Some('月'),
                            s => sep2 == s,
                        };
                        if ok && (1..=2).contains(&digits(j + 1)) {
                            return true;
                        }
                    }
                }
            }
            i += y.max(1);
        } else {
            i += 1;
        }
    }
    false
}

/// get_error_log の答え（アプリが返した記録から、新しい順に limit 件）
pub fn error_log_answer(log: &Value, limit: Option<u8>) -> Value {
    let all = log["entries"].as_array().cloned().unwrap_or_default();
    let n = usize::from(limit.unwrap_or(30).clamp(1, 100));
    let shown: Vec<Value> = all.iter().take(n).cloned().collect();
    json!({
        "count": all.len(),
        "returned": shown.len(),
        "max": log["max"],
        "entries": shown,
        "note": ERROR_LOG_NOTE,
        "next": if all.is_empty() {
            "エラーの記録はありません。画面で何が起きたかを FP に聞き、calculate・check_inputs・explain_value で調べてください。"
        } else {
            "関係する行を、draft_issue_report の error_log_lines に line のまま入れてください。"
        },
    })
}

/// 報告文を組み立てる（Err は AI に返す理由）
pub fn draft(a: &IssueReportArgs, version: &str) -> Result<Value, String> {
    let summary = clean(&a.summary);
    if summary.is_empty() {
        return Err("summary に何が起きたかを書いてください。".into());
    }
    let label = match a.diagnosis.trim() {
        "input" => "入力が原因（ここを直せば戻る）",
        "calculation" => "計算の仕組みの不具合の疑い",
        "unknown" => "まだ分からない",
        other => {
            return Err(format!(
                "diagnosis は input・calculation・unknown のどれかです（{other} は使えません）。"
            ))
        }
    };
    let evidence: Vec<String> = a
        .evidence
        .iter()
        .map(|s| clean(s))
        .filter(|s| !s.is_empty())
        .collect();
    if evidence.is_empty() || evidence.len() > MAX_LIST {
        return Err("evidence に、見立ての根拠（道具の名前と答えの要点）を1〜20件書いてください。推測で決めつけず、道具の結果を示します。".into());
    }
    let changes = list(&a.reproduce_changes);
    let steps = list(&a.reproduce_steps);
    let lines = list(&a.error_log_lines);
    if changes.len() > MAX_LIST || steps.len() > MAX_LIST || lines.len() > MAX_LIST {
        return Err("reproduce_changes・reproduce_steps・error_log_lines は20件までです。".into());
    }
    let sample = given(&a.sample_household_id);
    let sample_title = match &sample {
        Some(id) => {
            let Some(s) = samples::get(id) else {
                return Err(format!(
                    "見本の世帯 {id} はありません。list_sample_households で確かめてください。"
                ));
            };
            Some(
                s["title"]
                    .as_str()
                    .or_else(|| s["description"].as_str())
                    .unwrap_or(id)
                    .to_owned(),
            )
        }
        None => None,
    };
    let mut cautions: Vec<String> = Vec::new();
    let mut t = String::from("【ファイナンシアの不具合の報告】\n");
    t.push_str(&format!("アプリの版: {version}\n"));
    t.push_str(&format!("何が起きたか: {summary}\n"));
    let place: Vec<String> = [
        given(&a.screen).map(|s| format!("画面 {s}")),
        given(&a.row).map(|s| format!("行 {s}")),
        given(&a.when),
    ]
    .into_iter()
    .flatten()
    .collect();
    if !place.is_empty() {
        t.push_str(&format!("場所: {}\n", place.join("・")));
    }
    if let Some(e) = given(&a.expected) {
        t.push_str(&format!("期待した値: {e}\n"));
    }
    if let Some(e) = given(&a.actual) {
        t.push_str(&format!("実際の値: {e}\n"));
    }
    t.push_str(&format!("AI の見立て: {label}\n"));
    t.push_str("根拠:\n");
    for e in &evidence {
        t.push_str(&format!("- {e}\n"));
    }
    if let Some(f) = given(&a.fix) {
        t.push_str(&format!("直し方: {f}\n"));
    } else if a.diagnosis.trim() == "input" {
        cautions.push("見立てが「入力が原因」なのに fix（どこを直せば戻るか）がありません。入力項目と欄の名前を書いてください。".into());
    }
    t.push_str("再現の手順（見本の世帯で）:\n");
    match &sample_title {
        Some(title) => {
            let id = sample.as_deref().unwrap_or_default();
            let mut n = 1;
            t.push_str(&format!("{n}. 見本の世帯「{title}」（{id}）を開く\n"));
            for c in &changes {
                n += 1;
                t.push_str(&format!("{n}. {c}\n"));
            }
            for s in &steps {
                n += 1;
                t.push_str(&format!("{n}. {s}\n"));
            }
            t.push_str(match a.reproduced {
                Some(true) => "見本での再現: できた\n",
                Some(false) => {
                    "見本での再現: できなかった（実際の世帯の値が要るかは、FP が決めてください）\n"
                }
                None => "見本での再現: まだ確かめていない\n",
            });
            if a.reproduced != Some(true) {
                cautions.push("見本の世帯で同じことが起きるかを calculate で確かめて、reproduced に書いてください。".into());
            }
        }
        None => {
            t.push_str("見本の世帯では再現できていません。実際の世帯の値が要るかは、FP が決めてください。\n");
            for s in &steps {
                t.push_str(&format!("- {s}\n"));
            }
            cautions.push("見本の世帯で再現できていません。お客さまの値を報告に書くかは FP が決めます。書くときも、名前・生年月日・世帯を識別する値は書きません。".into());
        }
    }
    if !lines.is_empty() {
        t.push_str("エラーの記録:\n");
        for l in &lines {
            t.push_str(&format!("- {l}\n"));
        }
    }
    t.push_str(PRIVACY_LINE);
    let written: Vec<String> = [
        given(&a.screen),
        given(&a.row),
        given(&a.when),
        given(&a.expected),
        given(&a.actual),
        given(&a.fix),
    ]
    .into_iter()
    .flatten()
    .chain([summary.clone()])
    .chain(evidence.iter().cloned())
    .chain(changes.iter().cloned())
    .chain(steps.iter().cloned())
    .collect();
    // エラーの記録の行の日時は、起きた日時なので見ない
    if written.iter().any(|s| has_full_date(s)) {
        cautions.push("報告文に年・月・日のそろった日付があります。お客さまの生年月日などでないか確かめ、要らなければ消してください（見本の世帯の値と、エラーの記録の日時は書いてよい）。".into());
    }
    if a.diagnosis.trim() == "calculation" && sample_title.is_none() {
        cautions.push("計算の仕組みの不具合の疑いは、見本の世帯に変更を足して再現できると、直す側が確かめやすくなります。".into());
    }
    Ok(json!({
        "text": t,
        "cautions": cautions,
        "howToSend": HOW_TO_SEND,
        "next": "text をそのまま FP に見せ、中身を確かめてもらってください。cautions があれば直してから。FP に送るよう頼まれたら、propose_issue_report の items に kind: bug・screen・text の1件として渡し（ほかの要望・不具合も1件ずつに分けて同じ items に並べ、まとめて1回で）、アプリの「送る報告の確認画面」に出します。FP がその画面で確かめて「送る」を押し、開いたフォームに貼って送ります（この道具も AI も送りません。フォームも開きません。文を URL に載せません）。",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> IssueReportArgs {
        IssueReportArgs {
            summary: "結果のタブで、65歳の時点の金融資産が大きく減った".into(),
            screen: Some("結果".into()),
            row: Some("金融資産残高".into()),
            when: Some("2041年（15年目）".into()),
            expected: Some("前の年と同じくらい".into()),
            actual: Some("前の年より 800万円 少ない".into()),
            diagnosis: "input".into(),
            evidence: vec!["check_inputs: 退職金の受け取りの年が空".into()],
            fix: Some("「退職」の入力項目の退職金の受け取りの年".into()),
            sample_household_id: Some("salariedCoupleTwoKids".into()),
            reproduce_changes: Some(vec!["退職金の受け取りの年を空にする".into()]),
            reproduce_steps: Some(vec!["結果のタブでキャッシュフロー表を開く".into()]),
            reproduced: Some(true),
            error_log_lines: None,
        }
    }

    #[test]
    fn the_report_has_the_fixed_headings_and_the_send_steps() {
        let v = draft(&args(), "0.1.0").unwrap();
        let t = v["text"].as_str().unwrap();
        for w in [
            "【ファイナンシアの不具合の報告】",
            "アプリの版: 0.1.0",
            "何が起きたか: 結果のタブで",
            "場所: 画面 結果・行 金融資産残高・2041年（15年目）",
            "期待した値: 前の年と同じくらい",
            "実際の値: 前の年より 800万円 少ない",
            "AI の見立て: 入力が原因（ここを直せば戻る）",
            "根拠:\n- check_inputs: 退職金の受け取りの年が空",
            "直し方:",
            "再現の手順（見本の世帯で）:\n1. 見本の世帯「",
            "（salariedCoupleTwoKids）を開く\n2. 退職金の受け取りの年を空にする\n3. 結果のタブで",
            "見本での再現: できた",
            PRIVACY_LINE,
        ] {
            assert!(t.contains(w), "{w} がありません: {t}");
        }
        // 報告文はフォームの内容の欄に貼る物なので、送り方の案内は入れず、howToSend で AI に渡す（0259）
        assert!(t.ends_with(PRIVACY_LINE), "{t}");
        assert!(!t.contains("送り方"), "{t}");
        assert_eq!(v["howToSend"], HOW_TO_SEND);
        assert!(
            HOW_TO_SEND.contains("propose_issue_report")
                && HOW_TO_SEND.contains("「送る報告の確認画面」")
        );
        assert!(v["next"].as_str().unwrap().contains("propose_issue_report"));
        assert_eq!(v["cautions"], json!([]));
    }

    #[test]
    fn without_a_sample_the_fp_decides() {
        let mut a = args();
        a.sample_household_id = None;
        a.diagnosis = "calculation".into();
        let v = draft(&a, "0.1.0").unwrap();
        let t = v["text"].as_str().unwrap();
        assert!(
            t.contains(
                "見本の世帯では再現できていません。実際の世帯の値が要るかは、FP が決めてください。"
            ),
            "{t}"
        );
        let c = v["cautions"].to_string();
        assert!(
            c.contains("FP が決めます") && c.contains("再現できると"),
            "{c}"
        );
    }

    #[test]
    fn share_ids_are_hidden_and_full_dates_are_flagged() {
        let mut a = args();
        a.summary = "share s-9f8e7d6c5b4a39281706f5e4d3c2b1a0 で計算できない".into();
        a.evidence = vec!["calculate: 1985年4月12日 生まれの人の年金が0".into()];
        let v = draft(&a, "0.1.0").unwrap();
        let t = v["text"].as_str().unwrap();
        assert!(!t.contains("9f8e7d6c"), "{t}");
        assert!(t.contains("（共有の ID は書きません）"));
        assert!(v["cautions"].to_string().contains("生年月日"));
        assert!(
            has_full_date("1985-04-12")
                && has_full_date("2026/1/2")
                && has_full_date("1990年12月3日")
        );
        assert!(
            !has_full_date("2041年（15年目）")
                && !has_full_date("2026-11")
                && !has_full_date("12345-1-2")
        );
    }

    #[test]
    fn bad_arguments_are_refused() {
        let mut a = args();
        a.diagnosis = "bug".into();
        assert!(draft(&a, "0.1.0")
            .unwrap_err()
            .contains("input・calculation・unknown"));
        let mut a = args();
        a.evidence = vec![" ".into()];
        assert!(draft(&a, "0.1.0").unwrap_err().contains("evidence"));
        let mut a = args();
        a.sample_household_id = Some("noSuchSample".into());
        assert!(draft(&a, "0.1.0")
            .unwrap_err()
            .contains("list_sample_households"));
        let mut a = args();
        a.summary = "  ".into();
        assert!(draft(&a, "0.1.0").is_err());
        let mut a = args();
        a.reproduce_steps = Some(vec!["x".into(); 21]);
        assert!(draft(&a, "0.1.0").is_err());
        // 長い文は切る・改行は空白に
        let mut a = args();
        a.summary = format!("{}\n次の行", "あ".repeat(3000));
        let v = draft(&a, "0.1.0").unwrap();
        // エラーの記録の行の日時では注意を出さない
        let mut b = args();
        b.error_log_lines = Some(vec![
            "2026-11-20 10:03・版 0.1.0・macOS・結果・計算・計算できなかった: E_HOST_MEMORY".into(),
        ]);
        let w = draft(&b, "0.1.0").unwrap();
        assert!(w["text"]
            .as_str()
            .unwrap()
            .contains("エラーの記録:\n- 2026-11-20 10:03"));
        assert_eq!(w["cautions"], json!([]));
        let first = v["text"]
            .as_str()
            .unwrap()
            .lines()
            .nth(2)
            .unwrap()
            .to_owned();
        assert!(
            first.chars().count() <= MAX_FIELD_CHARS + 10,
            "{}",
            first.chars().count()
        );
    }

    #[test]
    fn error_log_answers_are_limited_and_explained() {
        let log = json!({ "entries": (0..50).map(|i| json!({ "line": format!("l{i}") })).collect::<Vec<_>>(), "max": 100 });
        let v = error_log_answer(&log, Some(5));
        assert_eq!(v["count"], 50);
        assert_eq!(v["returned"], 5);
        assert_eq!(v["entries"][0]["line"], "l0");
        assert!(v["note"].as_str().unwrap().contains("名前・金額・生年月日"));
        let empty = error_log_answer(&json!({ "entries": [], "max": 100 }), None);
        assert_eq!(empty["count"], 0);
        assert!(empty["next"].as_str().unwrap().contains("check_inputs"));
    }
}
