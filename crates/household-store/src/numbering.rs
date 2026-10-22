//! 顧客番号の区分と通し番号、見本の番号（0033）。
//!
//! - 顧客番号は「区分の記号＋通し番号」（例 `A0042`）。区分の記号は英大文字1〜2字で、既定は A（顧問契約）・B（単発相談）・C（見込み客）。
//!   記号と名前は FP が設定で足す・変える。通し番号は一度付けたら変えず、使い回さない（事務所で共有しているときは事務所全体で1本）。
//! - 区分を変えると記号だけが変わり、通し番号はそのまま（`C0042` → `A0042`）。
//! - 関係する世帯は枝番（`A0042-1`）。法人と家計を並べる用途の枝番 `-C` も書式として許す。
//! - 自分の番号体系を持つ FP 向けに、自由な番号（英数字・ハイフン・下線の16字。0012）も入れられる。自由な番号は区分を変えても付け替えない。
//! - 今までの「PCの接頭辞＋連番」の番号（接頭辞は A〜Z）は、番号の中身の欄が無いので自由な番号として読む。接頭辞が区分の記号と同じ
//!   （`A0001` など）でも、形だけを見て体系の番号とは読まない。
//! - 見本の世帯は顧客番号を持たず、見本番号「家族の形-年代-順番」（例 `3-4-01`）を持つ。順番 01〜09 はアプリに入っている見本、
//!   10〜 は FP が作った見本。

use serde::{Deserialize, Serialize};

use crate::StoreError;

/// 通し番号の桁数（足りなければ桁を増やす: 9999 の次は 10000）
pub const SERIAL_DIGITS: usize = 4;
/// 通し番号の上限（6桁）
pub const MAX_SERIAL: u32 = 999_999;
/// 区分の数の上限
pub const MAX_CATEGORIES: usize = 20;
/// 区分の名前の長さの上限（文字）
pub const MAX_CATEGORY_NAME: usize = 20;
/// 新しい世帯の既定の区分（見込み客）
pub const DEFAULT_CATEGORY: &str = "C";
/// 見本の名前の長さの上限（文字）
pub const MAX_SAMPLE_NAME: usize = 40;
/// 見本の絞り込みの項目の数と長さの上限
pub const MAX_TRAITS: usize = 12;
pub const MAX_TRAIT: usize = 12;
/// FP が作る見本の順番の始まり（01〜09 はアプリに入っている見本）
pub const FIRST_OWN_SAMPLE: u8 = 10;
/// 見本の順番の上限（2桁）
pub const MAX_SAMPLE_ORDER: u8 = 99;

/// 区分（記号と名前）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub code: String,
    pub name: String,
}

/// 既定の区分
pub fn default_categories() -> Vec<Category> {
    [("A", "顧問契約"), ("B", "単発相談"), ("C", "見込み客")]
        .into_iter()
        .map(|(c, n)| Category {
            code: c.into(),
            name: n.into(),
        })
        .collect()
}

/// 区分の設定の変更の1行（`from` は今の記号。新しく足す区分は空）
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryEdit {
    #[serde(default)]
    pub from: Option<String>,
    pub code: String,
    pub name: String,
}

/// 見本の中身の説明（見本番号・名前・絞り込みの項目）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleInfo {
    pub no: String,
    pub name: String,
    #[serde(default)]
    pub traits: Vec<String>,
}

/// 見本を作る・登録するときの指定（家族の形 1〜5・本人の年代 2〜7・名前・絞り込みの項目）
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    pub family: u8,
    pub age: u8,
    pub name: String,
    #[serde(default)]
    pub traits: Vec<String>,
}

/// 世帯の番号の中身（一覧の札・事務所データに持つ）。
/// - 体系の番号: `serial` があり、表示の番号は `記号＋通し番号[-枝番]`。区分を使わないときは `category` が無く、表示の番号は通し番号だけ（`0001`）
/// - 自由な番号: `serial` が無い（`category` はあってもよい。区分で絞り込むため）
/// - 見本: `sample` がある（顧客番号を持たない。表示の番号は見本番号）
///
/// 欄の無い古い札・事務所データは、区分なしの自由な番号として読む（今までの「PCの接頭辞＋連番」の番号は壊さない。
/// 接頭辞が区分の記号と同じでも、表示の番号の形から体系の番号を作り直さない）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serial: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<SampleInfo>,
}

impl Label {
    pub fn is_sample(&self) -> bool {
        self.sample.is_some()
    }
    /// 体系の番号の表示（体系の番号でなければ None）。区分が無ければ通し番号だけ
    pub fn display(&self) -> Option<String> {
        Some(format_no(
            self.category.as_deref().unwrap_or(""),
            self.serial?,
            self.branch.as_deref(),
        ))
    }
}

/// 区分の設定（区分の一覧と、区分を使うかを決めたか）。`decided` が false の間は、画面が初めて世帯の一覧を使うときに
/// 「区分を使いますか？」と1回だけ聞く。決めた後で区分が空なら、区分を使わない（番号は通し番号だけ。例 `0001`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySettings {
    pub categories: Vec<Category>,
    pub decided: bool,
}

/// 区分の記号の書式（英大文字1〜2字）
pub fn valid_code(c: &str) -> bool {
    (1..=2).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_uppercase())
}

fn valid_text(s: &str, max: usize) -> bool {
    let n = s.chars().count();
    n >= 1 && n <= max && s.trim() == s && !s.chars().any(char::is_control)
}

/// 枝番の書式（1〜99 か C）
pub fn valid_branch(b: &str) -> bool {
    b == "C"
        || (!b.is_empty()
            && b.len() <= 2
            && !b.starts_with('0')
            && b.bytes().all(|c| c.is_ascii_digit()))
}

/// 表示の番号（`A0042`・`A0042-1`・`A0042-C`。区分を使わないときは記号が空で `0042`）
pub fn format_no(code: &str, serial: u32, branch: Option<&str>) -> String {
    let base = format!("{code}{serial:0width$}", width = SERIAL_DIGITS);
    match branch {
        Some(b) => format!("{base}-{b}"),
        None => base,
    }
}

/// 体系の番号として読めるか（記号が区分にあるときだけ）。`A42` も `A0042` と読む。
/// 区分を使わないとき（区分が空）は、数字だけ（`42`・`0042-1`）を区分なしの通し番号と読む（区分の記号は None）。
/// FP が入れた番号を読むときだけに使う（保存してある古い番号を読み直すのには使わない。`label_from_no`）
pub fn parse_structured(
    s: &str,
    categories: &[Category],
) -> Option<(Option<String>, u32, Option<String>)> {
    let (main, branch) = match s.split_once('-') {
        Some((m, b)) => (m, Some(b)),
        None => (s, None),
    };
    if let Some(b) = branch {
        if !valid_branch(b) {
            return None;
        }
    }
    let split = main.find(|c: char| c.is_ascii_digit())?;
    let (code, digits) = main.split_at(split);
    let known = if code.is_empty() {
        categories.is_empty()
    } else {
        valid_code(code) && categories.iter().any(|c| c.code == code)
    };
    if !known
        || digits.is_empty()
        || digits.len() > 6
        || !digits.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let serial: u32 = digits.parse().ok()?;
    if serial == 0 {
        return None;
    }
    Some((
        (!code.is_empty()).then(|| code.to_owned()),
        serial,
        branch.map(str::to_owned),
    ))
}

/// 見本番号（`3-4-01`）
pub fn sample_no(family: u8, age: u8, order: u8) -> String {
    format!("{family}-{age}-{order:02}")
}

/// 見本番号を読む（家族の形・年代・順番）
pub fn parse_sample_no(s: &str) -> Option<(u8, u8, u8)> {
    let b = s.as_bytes();
    if b.len() != 6 || b[1] != b'-' || b[3] != b'-' {
        return None;
    }
    let family = (b[0] as char).to_digit(10)? as u8;
    let age = (b[2] as char).to_digit(10)? as u8;
    let order: u8 = s[4..].parse().ok()?;
    ((1..=5).contains(&family) && (2..=7).contains(&age) && order >= 1)
        .then_some((family, age, order))
}

/// 見本の指定の検査
pub fn check_sample_request(r: &SampleRequest) -> Result<(), StoreError> {
    if !(1..=5).contains(&r.family)
        || !(2..=7).contains(&r.age)
        || !valid_text(&r.name, MAX_SAMPLE_NAME)
    {
        return Err(StoreError::SAMPLE);
    }
    check_traits(&r.traits)
}

pub fn check_traits(traits: &[String]) -> Result<(), StoreError> {
    if traits.len() > MAX_TRAITS || !traits.iter().all(|t| valid_text(t, MAX_TRAIT)) {
        return Err(StoreError::SAMPLE);
    }
    Ok(())
}

/// 同じ家族の形・年代で、FP が作る見本の次の空き番号（10〜99）
pub fn next_sample_order<'a>(
    family: u8,
    age: u8,
    used: impl IntoIterator<Item = &'a str>,
) -> Option<u8> {
    let taken: std::collections::HashSet<u8> = used
        .into_iter()
        .filter_map(parse_sample_no)
        .filter(|(f, a, _)| *f == family && *a == age)
        .map(|(_, _, o)| o)
        .collect();
    (FIRST_OWN_SAMPLE..=MAX_SAMPLE_ORDER).find(|o| !taken.contains(o))
}

/// 区分の設定を当てた結果（新しい区分の一覧と、記号の付け替え（前の記号 → 新しい記号））
pub type CategoryChange = (Vec<Category>, Vec<(String, String)>);

/// 区分の設定の変更を当てる。使っている区分（`in_use` の記号）を消すことはできない（記号を変えるのはよい）。
/// 空の変更は「区分を使わない」（使っている区分があれば消せないので同じく止める）。
/// 返すのは新しい区分の一覧と、記号の付け替え（前の記号 → 新しい記号）
pub fn apply_category_edits(
    current: &[Category],
    edits: &[CategoryEdit],
    in_use: &std::collections::HashSet<String>,
) -> Result<CategoryChange, StoreError> {
    if edits.len() > MAX_CATEGORIES {
        return Err(StoreError::CATEGORY);
    }
    let mut seen_code = std::collections::HashSet::new();
    let mut seen_from = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(edits.len());
    let mut renames = vec![];
    for e in edits {
        if !valid_code(&e.code)
            || !valid_text(&e.name, MAX_CATEGORY_NAME)
            || !seen_code.insert(e.code.clone())
        {
            return Err(StoreError::CATEGORY);
        }
        if let Some(f) = &e.from {
            if !current.iter().any(|c| &c.code == f) || !seen_from.insert(f.clone()) {
                return Err(StoreError::CATEGORY);
            }
            if f != &e.code {
                renames.push((f.clone(), e.code.clone()));
            }
        }
        out.push(Category {
            code: e.code.clone(),
            name: e.name.clone(),
        });
    }
    // 使っている区分は残す（記号を変えるのはよい）
    if in_use
        .iter()
        .any(|c| !seen_from.contains(c) && current.iter().any(|x| &x.code == c))
    {
        return Err(StoreError::CATEGORY_IN_USE);
    }
    Ok((out, renames))
}

/// 世帯ファイルの本文から一覧を作り直すとき（事務所データが古い世代に戻ったなど）の番号の中身。
/// 見本番号の形なら見本として戻す（名前は番号から仮に付ける）。それ以外は自由な番号として戻す（区分の記号の形でも体系の番号にしない）
pub fn label_from_no(customer_no: &str) -> Label {
    match parse_sample_no(customer_no) {
        Some(_) => Label {
            sample: Some(SampleInfo {
                no: customer_no.to_owned(),
                name: format!("見本 {customer_no}"),
                traits: vec![],
            }),
            ..Label::default()
        },
        None => Label::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert_eq!(format_no("A", 42, None), "A0042");
        assert_eq!(format_no("AK", 42, Some("1")), "AK0042-1");
        assert_eq!(format_no("C", 12345, Some("C")), "C12345-C");
        let cats = default_categories();
        assert_eq!(
            parse_structured("A0042", &cats),
            Some((Some("A".into()), 42, None))
        );
        assert_eq!(
            parse_structured("A42", &cats),
            Some((Some("A".into()), 42, None))
        );
        assert_eq!(
            parse_structured("B0042-1", &cats),
            Some((Some("B".into()), 42, Some("1".into())))
        );
        assert_eq!(
            parse_structured("C0042-C", &cats),
            Some((Some("C".into()), 42, Some("C".into())))
        );
        // 区分に無い記号・枝番の形が違う・0番は自由な番号
        for s in [
            "Z0001",
            "a0042",
            "A0042-0",
            "A0042-01",
            "A0042-100",
            "A0042-X",
            "A0000",
            "A",
            "0042",
            "AKZ0042",
            "A1234567",
        ] {
            assert_eq!(parse_structured(s, &cats), None, "{s}");
        }
        // 区分を使わないとき: 数字だけを区分なしの通し番号と読む。記号つき（今までの PC の接頭辞の番号を含む）は自由な番号
        assert_eq!(format_no("", 1, None), "0001");
        assert_eq!(parse_structured("42", &[]), Some((None, 42, None)));
        assert_eq!(
            parse_structured("0042-1", &[]),
            Some((None, 42, Some("1".into())))
        );
        for s in ["A0001", "0000", "1234567", "0042-X"] {
            assert_eq!(parse_structured(s, &[]), None, "{s}");
        }
        // 区分を使うときは、数字だけは自由な番号のまま
        assert_eq!(parse_structured("0042", &cats), None);
        let plain = Label {
            serial: Some(7),
            ..Label::default()
        };
        assert_eq!(plain.display().as_deref(), Some("0007"));
    }

    #[test]
    fn sample_numbers() {
        assert_eq!(sample_no(3, 4, 1), "3-4-01");
        assert_eq!(parse_sample_no("3-4-01"), Some((3, 4, 1)));
        assert_eq!(parse_sample_no("5-7-10"), Some((5, 7, 10)));
        for s in [
            "6-4-01", "3-1-01", "3-8-01", "3-4-00", "3-4-1", "34-01", "3-4-001",
        ] {
            assert_eq!(parse_sample_no(s), None, "{s}");
        }
        let used = ["3-4-01", "3-4-10", "3-4-11", "3-3-12", "2-4-10"];
        assert_eq!(next_sample_order(3, 4, used), Some(12));
        assert_eq!(next_sample_order(3, 3, used), Some(10));
        let full: Vec<String> = (10..=99).map(|o| sample_no(1, 2, o)).collect();
        assert_eq!(
            next_sample_order(1, 2, full.iter().map(String::as_str)),
            None
        );
    }

    #[test]
    fn sample_requests() {
        let ok = SampleRequest {
            family: 3,
            age: 4,
            name: "夫婦と子・研修用".into(),
            traits: vec!["共働き".into()],
        };
        assert!(check_sample_request(&ok).is_ok());
        for bad in [
            SampleRequest {
                family: 0,
                ..ok.clone()
            },
            SampleRequest {
                age: 8,
                ..ok.clone()
            },
            SampleRequest {
                name: "".into(),
                ..ok.clone()
            },
            SampleRequest {
                name: " 前後の空白".into(),
                ..ok.clone()
            },
            SampleRequest {
                traits: vec!["".into()],
                ..ok.clone()
            },
        ] {
            assert_eq!(check_sample_request(&bad), Err(StoreError::SAMPLE));
        }
    }

    #[test]
    fn category_edits() {
        let cur = default_categories();
        let e = |from: Option<&str>, code: &str, name: &str| CategoryEdit {
            from: from.map(str::to_owned),
            code: code.into(),
            name: name.into(),
        };
        let used: std::collections::HashSet<String> = ["A".to_owned(), "C".to_owned()].into();
        // 名前を変え、記号を変え（C → MI）、足す。使っていない B は消してよい
        let (cats, renames) = apply_category_edits(
            &cur,
            &[
                e(Some("A"), "A", "顧問"),
                e(Some("C"), "MI", "見込み"),
                e(None, "S", "セミナー"),
            ],
            &used,
        )
        .unwrap();
        assert_eq!(
            cats.iter().map(|c| c.code.as_str()).collect::<Vec<_>>(),
            ["A", "MI", "S"]
        );
        assert_eq!(renames, [("C".to_owned(), "MI".to_owned())]);
        // 使っている区分は消せない
        assert_eq!(
            apply_category_edits(&cur, &[e(Some("A"), "A", "顧問")], &used),
            Err(StoreError::CATEGORY_IN_USE)
        );
        // 空の変更は「区分を使わない」。使っている区分があれば止める
        assert_eq!(
            apply_category_edits(&cur, &[], &Default::default()),
            Ok((vec![], vec![]))
        );
        assert_eq!(
            apply_category_edits(&cur, &[], &used),
            Err(StoreError::CATEGORY_IN_USE)
        );
        // 記号の書式・重なり・空の名前・知らない元の記号
        for bad in [
            vec![e(None, "m", "x")],
            vec![e(None, "ABC", "x")],
            vec![e(None, "K", "x"), e(None, "K", "y")],
            vec![e(None, "K", "")],
            vec![e(Some("Z"), "K", "x")],
        ] {
            assert_eq!(
                apply_category_edits(&cur, &bad, &Default::default()),
                Err(StoreError::CATEGORY)
            );
        }
    }

    #[test]
    fn labels_read_from_old_data() {
        // 欄の無い古い札は、区分なしの自由な番号
        let l: Label = serde_json::from_str("{}").unwrap();
        assert_eq!(l, Label::default());
        assert_eq!(l.display(), None);
        // 今までの「PCの接頭辞＋連番」の番号は、接頭辞が既定の区分の記号（A・B・C）と同じでも体系の番号にしない
        for old in ["A0001", "B0042", "C0007", "Z0001"] {
            assert_eq!(label_from_no(old), Label::default(), "{old}");
        }
        assert!(label_from_no("3-4-10").is_sample());
        let s = Label {
            category: Some("A".into()),
            serial: Some(42),
            branch: Some("C".into()),
            sample: None,
        };
        assert_eq!(s.display().as_deref(), Some("A0042-C"));
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"category":"A","serial":42,"branch":"C"}"#
        );
        // 開発中に保存した M・T・P の区分はそのまま区分として読む
        let dev: Label = serde_json::from_str(r#"{"category":"P","serial":3}"#).unwrap();
        assert_eq!(dev.display().as_deref(), Some("P0003"));
    }
}
