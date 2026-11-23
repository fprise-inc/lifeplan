//! 顧客番号の区分と通し番号、見本の中身の説明（0033・0247）。
//!
//! - 顧客番号は「区分の記号＋通し番号」（例 `A0042`）。区分の記号は英大文字1〜2字で、既定は A（顧問契約）・B（単発相談）・C（見込み客）。
//!   記号と名前は FP が設定で足す・変える。通し番号は一度付けたら変えず、使い回さない（事務所で共有しているときは事務所全体で1本）。
//! - 区分を変えると記号だけが変わり、通し番号はそのまま（`C0042` → `A0042`）。
//! - 関係する世帯は枝番（`A0042-1`）。法人と家計を並べる用途の枝番 `-C` も書式として許す。
//! - 自分の番号体系を持つ FP 向けに、自由な番号（英数字・ハイフン・下線の16字。0012）も入れられる。自由な番号は区分を変えても付け替えない。
//! - 今までの「PCの接頭辞＋連番」の番号（接頭辞は A〜Z）は、番号の中身の欄が無いので自由な番号として読む。接頭辞が区分の記号と同じ
//!   （`A0001` など）でも、形だけを見て体系の番号とは読まない。
//! - 見本の世帯は顧客番号も番号も持たない（0247 の1。表示の番号は空）。名前（同じ棚とアプリのセットの見本の中で重ならない）・
//!   家族の形・本人の年代・絞り込みの項目で探す。前の見本番号（「家族の形-年代-順番」。例 `3-4-01`）は、前の形の一覧の欄と
//!   0.86 までの世帯ファイルを読むとき（移行）にだけ読む。

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
/// 見本のセットの ID・セットの中の見本の ID の長さの上限（0247 の3）
pub const MAX_ORIGIN_ID: usize = 64;

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

/// 見本の出どころ（セットの見本を直した版のときだけ持つ。0247 の1・5）。`set` はセットの ID（`作成者.名前`）、
/// `id` はそのセットの中の見本の ID、`rev` はセットの定義が持つ見本の中身の版（無ければ 0）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleOrigin {
    pub set: String,
    pub id: String,
    #[serde(default)]
    pub rev: u32,
}

/// 見本の中身の説明（0247 の1）。一覧の欄（PC の中の事務所データ・共有フォルダの一覧の欄のファイル）の `sample` と、
/// 世帯ファイルの `meta.sample`（`changed` を除く）で同じ形。
/// 前の形（見本番号 `no` を持ち、家族の形・年代を持たない）も読む。家族の形・年代は番号から読み（読めなければ 3・4）、番号は書かない
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "SampleInfoRead")]
pub struct SampleInfo {
    pub name: String,
    #[serde(default)]
    pub traits: Vec<String>,
    /// 家族の形（1 単身・2 夫婦のみ・3 夫婦と子・4 ひとり親・5 シニア）
    pub family: u8,
    /// 本人の年代（2〜7）
    pub age: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<SampleOrigin>,
    /// 最初の状態から変わっているか（無ければ false。0247 の6）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub changed: bool,
    /// 前の形で読んだときの見本番号（移行の印。書かない。0247 の8）
    #[serde(skip)]
    pub legacy_no: Option<String>,
}

/// 読むときの形（前の形の `no` も受け付ける）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleInfoRead {
    #[serde(default)]
    no: Option<String>,
    name: String,
    #[serde(default)]
    traits: Vec<String>,
    #[serde(default)]
    family: Option<u8>,
    #[serde(default)]
    age: Option<u8>,
    #[serde(default)]
    origin: Option<SampleOrigin>,
    #[serde(default)]
    changed: bool,
}

impl From<SampleInfoRead> for SampleInfo {
    fn from(r: SampleInfoRead) -> SampleInfo {
        let from_no = r.no.as_deref().and_then(parse_sample_no);
        SampleInfo {
            name: r.name,
            traits: r.traits,
            family: r.family.or(from_no.map(|x| x.0)).unwrap_or(3),
            age: r.age.or(from_no.map(|x| x.1)).unwrap_or(4),
            origin: r.origin,
            changed: r.changed,
            // 新しい形の欄（家族の形）があれば移行は済んでいる
            legacy_no: if r.family.is_none() { r.no } else { None },
        }
    }
}

impl SampleInfo {
    /// 前の形（見本番号つき）で読んだ一覧の欄か
    pub fn is_legacy(&self) -> bool {
        self.legacy_no.is_some()
    }
}

/// 見本を作る・登録するときの指定（名前・絞り込みの項目・家族の形 1〜5・本人の年代 2〜7・セットの見本を直した版なら出どころ）
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    pub family: u8,
    pub age: u8,
    pub name: String,
    #[serde(default)]
    pub traits: Vec<String>,
    #[serde(default)]
    pub origin: Option<SampleOrigin>,
}

/// 世帯の番号の中身（一覧の札・事務所データに持つ）。
/// - 体系の番号: `serial` があり、表示の番号は `記号＋通し番号[-枝番]`。区分を使わないときは `category` が無く、表示の番号は通し番号だけ（`0001`）
/// - 自由な番号: `serial` が無い（`category` はあってもよい。区分で絞り込むため）
/// - 見本: `sample` がある（顧客番号を持たない。表示の番号は空。0247）
/// - 架空の世帯: `fictional` が true（顧客の一覧に「架空」の印つきで出る。番号の付け方はお客さまの世帯と同じ）
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
    /// 架空の世帯（AIの候補から「架空」として作った世帯。セミナー・研修に使う。お客さまの情報を含まない）。
    /// アプリ本体が作るときだけ付け、外すのは「お客さまの世帯にする」だけ（一方向。お客さまの世帯を架空にはしない）。
    /// 見本には付けない。欄の無い札・事務所データはお客さまの世帯
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fictional: bool,
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
    n >= 1 && n <= max && s.trim() == s && !s.chars().any(|c| c.is_control() || invisible(c))
}

/// 見えない文字（幅の無い空白・つなぎ・向きの制御・語をつなぐ印・BOM・やわらかいハイフン）。名前に入ると、同じに見えて違う名前ができる（0247 の1）
fn invisible(c: char) -> bool {
    matches!(c, '\u{00AD}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FEFF}')
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
/// FP が入れた番号を読むときだけに使う（保存してある古い番号を読み直すのには使わない。`label_from_meta`）
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

/// 前の見本番号（`3-4-01`）を読む（家族の形・年代・順番）。前の形の一覧の欄と 0.86 までの世帯ファイルを読むときだけ使う（0247 の8）
pub(crate) fn parse_sample_no(s: &str) -> Option<(u8, u8, u8)> {
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

/// 家族の形の言葉（前の見本番号の世帯ファイルから一覧を作り直すときの仮の名前に使う）
fn family_text(family: u8) -> &'static str {
    match family {
        1 => "単身",
        2 => "夫婦のみ",
        3 => "夫婦と子",
        4 => "ひとり親",
        _ => "シニア",
    }
}

/// セットの ID・見本の ID の書式（英字で始まる英数字。セットの ID は `作成者.名前` の点区切り。0004・0247 の3）
fn valid_origin_part(s: &str, dotted: bool) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    !s.is_empty()
        && s.len() <= MAX_ORIGIN_ID
        && (if dotted {
            parts.len() >= 2
        } else {
            parts.len() == 1
        })
        && parts.iter().all(|p| {
            p.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && p.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// 見本の指定の検査
pub fn check_sample_request(r: &SampleRequest) -> Result<(), StoreError> {
    check_shape(r.family, r.age)?;
    if !valid_text(&r.name, MAX_SAMPLE_NAME) {
        return Err(StoreError::SAMPLE);
    }
    if let Some(o) = &r.origin {
        if !valid_origin_part(&o.set, true) || !valid_origin_part(&o.id, false) {
            return Err(StoreError::SAMPLE);
        }
    }
    check_traits(&r.traits)
}

/// 家族の形（1〜5）・本人の年代（2〜7）の検査
pub fn check_shape(family: u8, age: u8) -> Result<(), StoreError> {
    if !(1..=5).contains(&family) || !(2..=7).contains(&age) {
        return Err(StoreError::SAMPLE);
    }
    Ok(())
}

pub fn check_traits(traits: &[String]) -> Result<(), StoreError> {
    if traits.len() > MAX_TRAITS || !traits.iter().all(|t| valid_text(t, MAX_TRAIT)) {
        return Err(StoreError::SAMPLE);
    }
    Ok(())
}

/// 見本の名前を比べる形（前後の空白を除き、Unicode の NFC にそろえる。0247 の1）
pub fn sample_name_key(name: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    name.trim().nfc().collect()
}

/// 重なった名前の後ろに「（2）」「（3）」…を付けた、`taken` に無い名前（40字を超えるときは元の名前を切る。0247 の8）。
/// 見つけた名前は `taken` に足す
pub fn unique_sample_name(name: &str, taken: &mut std::collections::HashSet<String>) -> String {
    let key = sample_name_key(name);
    if !key.is_empty() && taken.insert(key.clone()) {
        return name.trim().to_owned();
    }
    let base = if key.is_empty() {
        "見本".to_owned()
    } else {
        key
    };
    for n in 2u32.. {
        let tail = format!("（{n}）");
        let room = MAX_SAMPLE_NAME.saturating_sub(tail.chars().count());
        let head: String = base.chars().take(room).collect();
        let cand = format!("{}{tail}", head.trim_end());
        if taken.insert(sample_name_key(&cand)) {
            return cand;
        }
    }
    unreachable!("名前の候補は尽きない")
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

/// 世帯ファイルの本文の `meta` から一覧の欄の (表示の番号, 番号の中身) を作り直す（事務所データが古い世代に戻った・共有フォルダの
/// 一覧の欄のファイルが無いとき。0247 の1・8）。
/// - `meta.sample` があれば見本（名前・項目・家族の形・年代・出どころがそのまま戻る。表示の番号は空）
/// - 無くて、0.86 までのファイル（`meta.formatVersion` が 0.87 より前）で `meta.customerNo` が前の見本番号の形のときだけ、前と同じく
///   見本として戻す（名前は「見本（夫婦と子・40代）」の形。重なりは呼ぶ側が [`unique_sample_name`] で直す）
/// - それ以外は顧客の世帯（自由な番号。区分の記号の形でも体系の番号にしない。0.87 からのファイルの `3-4-10` も顧客番号のまま）
pub fn label_from_meta(meta: Option<&serde_json::Value>) -> (String, Label) {
    use serde_json::Value;
    let text = |k: &str| meta.and_then(|m| m.get(k)).and_then(Value::as_str);
    if let Some(v) = meta.and_then(|m| m.get("sample")).filter(|v| v.is_object()) {
        let mut info: SampleInfo = serde_json::from_value(v.clone()).unwrap_or(SampleInfo {
            name: String::new(),
            traits: vec![],
            family: 3,
            age: 4,
            origin: None,
            changed: false,
            legacy_no: None,
        });
        if check_shape(info.family, info.age).is_err() {
            info.family = 3;
            info.age = 4;
        }
        if !valid_text(&info.name, MAX_SAMPLE_NAME) {
            info.name = format!("見本（{}・{}0代）", family_text(info.family), info.age);
        }
        if check_traits(&info.traits).is_err() {
            info.traits = vec![];
        }
        // 直した版は、ファイルがある間は最初の状態から変わっている（0247 の6）
        info.changed = info.origin.is_some();
        info.legacy_no = None;
        return (
            String::new(),
            Label {
                sample: Some(info),
                ..Label::default()
            },
        );
    }
    let customer_no = text("customerNo").unwrap_or("");
    let old_file = text("formatVersion")
        .and_then(crate::migrate::parse)
        .is_none_or(|v| v < (0, 87));
    if old_file {
        if let Some((family, age, _)) = parse_sample_no(customer_no) {
            return (
                String::new(),
                Label {
                    sample: Some(SampleInfo {
                        name: format!("見本（{}・{age}0代）", family_text(family)),
                        traits: vec![],
                        family,
                        age,
                        origin: None,
                        changed: false,
                        legacy_no: None,
                    }),
                    ..Label::default()
                },
            );
        }
    }
    let no = if crate::store::valid_customer_no(customer_no) {
        customer_no.to_owned()
    } else {
        "NO-NUMBER".to_owned()
    };
    (no, Label::default())
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
    fn old_sample_numbers_are_read_only_for_migration() {
        assert_eq!(parse_sample_no("3-4-01"), Some((3, 4, 1)));
        assert_eq!(parse_sample_no("5-7-10"), Some((5, 7, 10)));
        for s in [
            "6-4-01", "3-1-01", "3-8-01", "3-4-00", "3-4-1", "34-01", "3-4-001", "",
        ] {
            assert_eq!(parse_sample_no(s), None, "{s}");
        }
        // 前の形の一覧の欄: 家族の形・年代は番号から読み、番号は書かない
        let old: SampleInfo = serde_json::from_value(serde_json::json!({
            "no": "2-6-11", "name": "研修用", "traits": ["賃貸"]
        }))
        .unwrap();
        assert_eq!((old.family, old.age), (2, 6));
        assert!(old.is_legacy());
        assert_eq!(old.legacy_no.as_deref(), Some("2-6-11"));
        let written = serde_json::to_value(&old).unwrap();
        assert_eq!(
            written,
            serde_json::json!({"name": "研修用", "traits": ["賃貸"], "family": 2, "age": 6})
        );
        // 読めない番号は 3・4
        let broken: SampleInfo =
            serde_json::from_value(serde_json::json!({"no": "x", "name": "a"})).unwrap();
        assert_eq!((broken.family, broken.age), (3, 4));
        // 新しい形（番号を持たない）。出どころと「変わっている」は任意
        let new: SampleInfo = serde_json::from_value(serde_json::json!({
            "name": "退職前後の夫婦・60代", "traits": ["会社員"], "family": 3, "age": 6,
            "origin": {"set": "official.basic", "id": "sampleSeniorRental", "rev": 1}, "changed": true
        }))
        .unwrap();
        assert!(!new.is_legacy());
        assert_eq!(new.origin.as_ref().unwrap().rev, 1);
        let back = serde_json::to_value(&new).unwrap();
        assert_eq!(back["changed"], true);
        assert!(back.get("no").is_none());
        // 新しい形に前の番号が残っていても、移行は済んだものとして扱う
        let both: SampleInfo = serde_json::from_value(
            serde_json::json!({"no": "3-4-10", "name": "a", "family": 1, "age": 2}),
        )
        .unwrap();
        assert!(!both.is_legacy());
        assert_eq!((both.family, both.age), (1, 2));
    }

    #[test]
    fn sample_requests() {
        let ok = SampleRequest {
            family: 3,
            age: 4,
            name: "夫婦と子・研修用".into(),
            traits: vec!["共働き".into()],
            origin: None,
        };
        assert!(check_sample_request(&ok).is_ok());
        let with_origin = SampleRequest {
            origin: Some(SampleOrigin {
                set: "official.corporateOwner".into(),
                id: "sampleOwnerCompany".into(),
                rev: 1,
            }),
            ..ok.clone()
        };
        assert!(check_sample_request(&with_origin).is_ok());
        let origin = |set: &str, id: &str| SampleRequest {
            origin: Some(SampleOrigin {
                set: set.into(),
                id: id.into(),
                rev: 0,
            }),
            ..ok.clone()
        };
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
                name: "あ".repeat(41),
                ..ok.clone()
            },
            SampleRequest {
                traits: vec!["".into()],
                ..ok.clone()
            },
            origin("basic", "x"),
            origin("official.basic", "a.b"),
            origin("official.", "x"),
            origin("official.basic", ""),
            origin("1x.basic", "x"),
            origin("official.basic", "../x"),
        ] {
            assert_eq!(
                check_sample_request(&bad),
                Err(StoreError::SAMPLE),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn sample_names() {
        // 比べるのは前後の空白を除き NFC にそろえた形（合成済みの「が」と、か＋濁点は同じ）
        assert_eq!(sample_name_key(" 夫婦 "), "夫婦");
        assert_eq!(sample_name_key("か\u{3099}"), sample_name_key("が"));
        let mut taken = std::collections::HashSet::new();
        assert_eq!(unique_sample_name("研修用", &mut taken), "研修用");
        assert_eq!(unique_sample_name("研修用", &mut taken), "研修用（2）");
        assert_eq!(unique_sample_name("研修用", &mut taken), "研修用（3）");
        assert_eq!(
            unique_sample_name("研修用（2）", &mut taken),
            "研修用（2）（2）"
        );
        // 40字を超えるときは元の名前を切る
        let long = "あ".repeat(40);
        let mut t = std::collections::HashSet::new();
        unique_sample_name(&long, &mut t);
        let second = unique_sample_name(&long, &mut t);
        assert_eq!(second.chars().count(), 40);
        assert!(second.ends_with("（2）"));
    }

    #[test]
    fn labels_rebuilt_from_the_household_file() {
        use serde_json::json;
        let sample = json!({"name": "研修用", "traits": ["賃貸"], "family": 2, "age": 6,
            "origin": {"set": "official.basic", "id": "sampleSeniorRental", "rev": 1}});
        // meta.sample があれば見本（表示の番号は空・出どころつきは変わっている）
        let (no, l) = label_from_meta(Some(&json!({"formatVersion": "0.87", "sample": sample})));
        assert_eq!(no, "");
        let info = l.sample.unwrap();
        assert_eq!(
            (info.name.as_str(), info.family, info.age),
            ("研修用", 2, 6)
        );
        assert!(info.changed);
        // 0.87 からのファイルは、前の見本番号の形の顧客番号でも顧客のまま
        let (no, l) = label_from_meta(Some(
            &json!({"formatVersion": "0.87", "customerNo": "3-4-10"}),
        ));
        assert_eq!(no, "3-4-10");
        assert!(!l.is_sample());
        // 0.86 までのファイルは、前の見本番号の形なら見本（仮の名前）
        let (no, l) = label_from_meta(Some(
            &json!({"formatVersion": "0.86", "customerNo": "3-4-10"}),
        ));
        assert_eq!(no, "");
        assert_eq!(l.sample.unwrap().name, "見本（夫婦と子・40代）");
        let (_, l) = label_from_meta(Some(&json!({"customerNo": "5-7-01"})));
        assert_eq!(l.sample.unwrap().name, "見本（シニア・70代）");
        // 顧客の世帯（区分の記号の形でも体系の番号にしない）・番号の無いファイル
        for old in ["A0001", "B0042", "C0007", "Z0001"] {
            let (no, l) =
                label_from_meta(Some(&json!({"formatVersion": "0.86", "customerNo": old})));
            assert_eq!((no.as_str(), l), (old, Label::default()), "{old}");
        }
        assert_eq!(label_from_meta(None).0, "NO-NUMBER");
        assert_eq!(
            label_from_meta(Some(&json!({"customerNo": "山田"}))).0,
            "NO-NUMBER"
        );
        // 壊れた meta.sample でも見本のまま（顧客の一覧に出さない）
        let (no, l) = label_from_meta(Some(
            &json!({"formatVersion": "0.87", "customerNo": "A0001", "sample": {"family": 9}}),
        ));
        assert_eq!(no, "");
        let info = l.sample.unwrap();
        assert_eq!((info.family, info.age), (3, 4));
        assert_eq!(info.name, "見本（夫婦と子・40代）");
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
        let s = Label {
            category: Some("A".into()),
            serial: Some(42),
            branch: Some("C".into()),
            sample: None,
            fictional: false,
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
