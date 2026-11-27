//! 画面の操作の手引き（`search_app_guide`・`get_app_guide`。0227）。FP が AI に「プランを保存するにはどこを押す？」のように
//! アプリの画面の操作を聞いたとき、AI が推測で手順を作らず、同梱した手引きの節を読んで答えるための物。世帯の情報は含まない。
//!
//! 正本は docs/app-guide/NN-<画面>.md（ビルドで埋め込む。build.rs）。1ファイルが1つの画面（かまとまり）で、節は次の形:
//!
//! ```text
//! ## 題 {#画面.名前}
//! 探す言葉: 言葉、言葉
//! 要点: 1〜2文の答え
//! 関係: 画面.名前、画面.名前（任意）
//!
//! 本文（です・ます。画面のボタン・見出しの名前は、画面の文のまま「」で書く）
//! ```
//!
//! 「」の中が今の画面の文にあることは、app/test/app-guide.test.ts が確かめる（画面の言葉を変えて手引きを直し忘れたら落ちる）。
//! 探し方は対応範囲の一覧（coverage.rs）と同じ「2文字の並び」の重なり。

use crate::coverage::{bigrams, normalize};
use crate::engine::assets::APP_GUIDE;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::sync::OnceLock;

/// 手引きに無い操作を聞かれたときに添える案内
pub const NOT_IN_GUIDE: &str = "画面の操作の手引きに、この操作は見当たりません。推測で手順を作らず「手引きに見当たらない」と FP に伝え、アプリの画面で確認してもらってください。アプリに欲しい操作なら、FP がアプリの「要望・不具合を送る」から送れます（ここからは送れません）。";

pub struct Section {
    pub id: String,
    pub title: String,
    pub screen: String,
    pub keywords: Vec<String>,
    pub summary: String,
    pub related: Vec<String>,
    pub body: String,
    /// 探すための文（正規化した物と重み）
    fields: Vec<(String, u32)>,
    /// そのまま問いに入っていれば点を足す言葉（題と探す言葉。正規化した物）
    names: Vec<String>,
}

pub struct Screen {
    pub id: String,
    pub title: String,
    pub intro: String,
}

pub struct Guide {
    pub screens: Vec<Screen>,
    pub sections: Vec<Section>,
    /// 読めなかった所（ファイルの名前と理由）。空でなければ試験で落とす
    pub problems: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|p| {
            let mut cs = p.chars();
            cs.next().is_some_and(|c| c.is_ascii_lowercase())
                && cs.all(|c| c.is_ascii_alphanumeric())
        })
}

fn split_list(s: &str) -> Vec<String> {
    s.split(['、', ',', '，'])
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(str::to_owned)
        .collect()
}

/// 1つのファイルを読む（screen は「NN-」と「.md」を外した名前）
fn parse_file(file: &str, text: &str, g: &mut Guide) {
    let screen = file
        .get(3..)
        .and_then(|s| s.strip_suffix(".md"))
        .unwrap_or(file)
        .to_owned();
    let mut lines = text.lines().peekable();
    let Some(title) = lines.next().and_then(|l| l.strip_prefix("# ")) else {
        g.problems
            .push(format!("{file}: 1行目は「# 画面の題」にしてください"));
        return;
    };
    let mut intro = Vec::new();
    while let Some(l) = lines.peek() {
        if l.starts_with("## ") {
            break;
        }
        intro.push(*l);
        lines.next();
    }
    g.screens.push(Screen {
        id: screen.clone(),
        title: title.trim().to_owned(),
        intro: intro.join("\n").trim().to_owned(),
    });
    while let Some(head) = lines.next() {
        let Some(h) = head.strip_prefix("## ") else {
            continue;
        };
        let Some((t, rest)) = h.rsplit_once("{#") else {
            g.problems.push(format!(
                "{file}: 節の見出し「{h}」の終わりに {{#id}} がありません"
            ));
            continue;
        };
        let id = rest.trim_end().trim_end_matches('}').trim().to_owned();
        if !valid_id(&id) {
            g.problems.push(format!(
                "{file}: 節の id「{id}」は英小文字で始まる「画面.名前」の形にしてください"
            ));
        }
        let mut keywords = Vec::new();
        let mut summary = String::new();
        let mut related = Vec::new();
        let mut body = Vec::new();
        let mut in_head = true;
        while let Some(l) = lines.peek() {
            if l.starts_with("## ") {
                break;
            }
            let l = lines.next().unwrap_or_default();
            if in_head {
                if let Some(v) = l.strip_prefix("探す言葉:") {
                    keywords = split_list(v);
                    continue;
                }
                if let Some(v) = l.strip_prefix("要点:") {
                    summary = v.trim().to_owned();
                    continue;
                }
                if let Some(v) = l.strip_prefix("関係:") {
                    related = split_list(v);
                    continue;
                }
                if l.trim().is_empty() {
                    continue;
                }
                in_head = false;
            }
            body.push(l);
        }
        let body = body.join("\n").trim().to_owned();
        let title = t.trim().to_owned();
        if summary.is_empty() || keywords.is_empty() || body.is_empty() {
            g.problems.push(format!(
                "{file}: 節 {id} に「探す言葉:」「要点:」と本文が要ります"
            ));
        }
        let mut fields = vec![(normalize(&title), 6), (normalize(&summary), 3)];
        fields.extend(keywords.iter().map(|k| (normalize(k), 6)));
        fields.push((normalize(&body), 1));
        if let Some(s) = g.screens.last() {
            fields.push((normalize(&s.title), 1));
        }
        let names = std::iter::once(&title)
            .chain(keywords.iter())
            .map(|t| normalize(t))
            .filter(|t| t.chars().count() >= 2)
            .collect();
        g.sections.push(Section {
            id,
            title,
            screen: screen.clone(),
            keywords,
            summary,
            related,
            body,
            fields,
            names,
        });
    }
}

pub fn guide() -> &'static Guide {
    static G: OnceLock<Guide> = OnceLock::new();
    G.get_or_init(|| {
        let mut g = Guide {
            screens: Vec::new(),
            sections: Vec::new(),
            problems: Vec::new(),
        };
        for (file, text) in APP_GUIDE {
            parse_file(file, text, &mut g);
        }
        let mut seen = BTreeSet::new();
        for s in &g.sections {
            if !seen.insert(s.id.clone()) {
                g.problems.push(format!("節の id {} が2つあります", s.id));
            }
        }
        for s in &g.sections {
            for r in &s.related {
                if !seen.contains(r) {
                    g.problems
                        .push(format!("節 {} の「関係:」の {r} がありません", s.id));
                }
            }
        }
        g
    })
}

pub fn count() -> usize {
    guide().sections.len()
}

fn screen_title(id: &str) -> &'static str {
    guide()
        .screens
        .iter()
        .find(|s| s.id == id)
        .map_or("", |s| s.title.as_str())
}

/// 問いへの点（0 は当たらない。coverage.rs と同じ数え方）
fn score(s: &Section, q: &str, grams: &BTreeSet<String>) -> u32 {
    if grams.is_empty() {
        return 0;
    }
    let mut hit = 0u32;
    for g in grams {
        hit += s
            .fields
            .iter()
            .filter(|(t, _)| t.contains(g.as_str()))
            .map(|(_, w)| *w)
            .max()
            .unwrap_or(0);
    }
    let mut v = hit * 100 / u32::try_from(grams.len()).unwrap_or(1);
    let mut bonus: Vec<u32> = s
        .names
        .iter()
        .filter(|n| q.contains(n.as_str()))
        .map(|n| 100 + 40 * u32::try_from(n.chars().count().min(10)).unwrap_or(0))
        .collect();
    bonus.sort_unstable_by(|a, b| b.cmp(a));
    v += bonus.iter().take(4).sum::<u32>();
    v
}

fn brief(s: &Section) -> Value {
    json!({
        "id": s.id,
        "title": s.title,
        "screen": screen_title(&s.screen),
        "summary": s.summary,
    })
}

/// 探す。戻り値は点の高い順（最大 limit 件）
pub fn search(query: &str, limit: usize, app_version: &str) -> Value {
    let q = normalize(query);
    let grams = bigrams(&q);
    let mut found: Vec<(u32, &Section)> = guide()
        .sections
        .iter()
        .map(|s| (score(s, &q, &grams), s))
        .filter(|(v, _)| *v >= 120)
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let best = found.first().map_or(0, |f| f.0);
    found.retain(|f| f.0 * 4 >= best);
    let matches: Vec<Value> = found
        .iter()
        .take(limit)
        .map(|(v, s)| {
            let mut b = brief(s);
            b["score"] = json!(v);
            b
        })
        .collect();
    let mut out = Map::new();
    out.insert("query".into(), json!(query));
    out.insert("appVersion".into(), json!(app_version));
    out.insert("matches".into(), Value::Array(matches.clone()));
    if matches.is_empty() {
        out.insert(
            "note".into(),
            json!("画面の操作の手引きに当たる節がありませんでした。言い方を変える（画面のタブ・ボタンの名前、やりたいことを短く）か、get_app_guide（id なし）で目次を見てください。"),
        );
        out.insert("notInGuide".into(), json!(NOT_IN_GUIDE));
    } else {
        out.insert(
            "note".into(),
            json!("score は問いとの重なりの目安（大きいほど近い）。答える前に get_app_guide で節の本文を読み、本文の手順どおりに答えてください。"),
        );
    }
    Value::Object(out)
}

/// 1つの節の中身（無ければ None）
pub fn get(id: &str, app_version: &str) -> Option<Value> {
    let g = guide();
    let s = g.sections.iter().find(|s| s.id == id)?;
    let related: Vec<Value> = s
        .related
        .iter()
        .filter_map(|r| g.sections.iter().find(|x| x.id == *r))
        .map(brief)
        .collect();
    Some(json!({
        "id": s.id,
        "title": s.title,
        "screen": { "id": s.screen, "title": screen_title(&s.screen) },
        "summary": s.summary,
        "keywords": s.keywords,
        "body": s.body,
        "related": related,
        "appVersion": app_version,
        "note": "本文は、この版のアプリの画面の手引きです。「」の中は画面のボタン・見出し・タブの名前そのままなので、言い換えずに「」のまま FP に伝えてください。本文に無い手順・ボタンを推測で足さないでください（無い操作は「手引きに見当たらない」と伝える）。",
    }))
}

/// 画面ごとの目次（節の id・題だけ）
pub fn contents(app_version: &str) -> Value {
    let g = guide();
    let screens: Vec<Value> = g
        .screens
        .iter()
        .map(|sc| {
            let ss: Vec<Value> = g
                .sections
                .iter()
                .filter(|s| s.screen == sc.id)
                .map(|s| json!({ "id": s.id, "title": s.title }))
                .collect();
            json!({ "id": sc.id, "title": sc.title, "intro": sc.intro, "sections": ss })
        })
        .collect();
    json!({
        "appVersion": app_version,
        "count": count(),
        "screens": screens,
        "note": "画面の操作の手引きの目次です。節の中身は get_app_guide に id を渡して読みます。ここに無い操作は、推測で手順を作らず「手引きに見当たらない」と伝えてください。",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top(q: &str) -> String {
        search(q, 5, "0")["matches"][0]["id"]
            .as_str()
            .unwrap_or("")
            .to_owned()
    }

    #[test]
    fn embedded_guide_is_read_without_problems() {
        let g = guide();
        assert!(g.problems.is_empty(), "{:#?}", g.problems);
        assert!(count() >= 40, "{}", count());
        assert!(g.screens.len() >= 8);
        for s in &g.sections {
            assert!(valid_id(&s.id), "{}", s.id);
            assert!(!s.summary.is_empty() && !s.body.is_empty(), "{}", s.id);
        }
    }

    #[test]
    fn reads_the_section_format() {
        let mut g = Guide {
            screens: Vec::new(),
            sections: Vec::new(),
            problems: Vec::new(),
        };
        parse_file(
            "01-test.md",
            "# 試しの画面\n\n前書き\n\n## 保存する {#test.save}\n探す言葉: 保存、しまう\n要点: 自動で保存します。\n関係: test.other\n\n本文の1行目\n\n本文の2行目\n## 見出しだけ\n",
            &mut g,
        );
        assert_eq!(g.screens[0].id, "test");
        assert_eq!(g.screens[0].intro, "前書き");
        let s = &g.sections[0];
        assert_eq!(s.id, "test.save");
        assert_eq!(s.keywords, vec!["保存", "しまう"]);
        assert_eq!(s.related, vec!["test.other"]);
        assert_eq!(s.body, "本文の1行目\n\n本文の2行目");
        assert_eq!(g.problems.len(), 1, "{:?}", g.problems);
        assert!(!valid_id("Test.save") && !valid_id("save") && valid_id("ai.planCandidates"));
    }

    #[test]
    fn finds_common_questions() {
        assert_eq!(top("プランを保存するにはどこを押す？"), "results.planSave");
        assert_eq!(
            top("お客さまに URL でヒアリングを送るには？"),
            "import.webCreate"
        );
        assert_eq!(top("AI に世帯を渡すには"), "ai.share");
        assert_eq!(top("新しい世帯を作る"), "households.create");
        assert_eq!(top("提案書を PDF にしたい"), "export.report");
        assert_eq!(top("同意を記録する"), "ai.consent");
        assert_eq!(top("ロゴを入れたい"), "office.branding");
        // AI との接続は「接続する」「つなぐ」のどちらで聞かれても事務所全体の設定の節、登録は登録の節
        assert_eq!(top("Claude と接続したい"), "ai.connect");
        assert_eq!(top("Claude とつなぎたい"), "ai.connect");
        assert_eq!(top("Claude に登録するには"), "ai.register");
        assert_eq!(top("ChatGPT は接続できる？"), "ai.register");
    }

    #[test]
    fn unknown_operation_points_to_not_in_guide() {
        let v = search("量子コンピュータの保守契約", 5, "0");
        assert_eq!(v["matches"], json!([]));
        assert!(v["notInGuide"]
            .as_str()
            .unwrap()
            .contains("推測で手順を作らず"));
        assert!(get("no.such", "0").is_none());
        let first = &guide().sections[0];
        let g = get(&first.id, "0").unwrap();
        assert_eq!(g["title"], first.title.as_str());
        assert!(g["body"].as_str().unwrap().len() > 10);
        let toc = contents("0");
        assert_eq!(toc["count"], count());
    }
}
