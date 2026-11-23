//! メモと面談の履歴を AI に渡す前に、名前を伏せる（0249）。ファイナンシアはお名前を持たない決まり（0012）だが、FP が書いた文には
//! お名前が入りうるので、渡す前に次を通す（同意の文には書かないが、必ず通す）:
//!
//! 1. FP が渡すときに入れた伏せる言葉（お客さまの名字など）を、文のどこにあっても「（名前）」にする。言葉はメモリの上だけで使い、保存しない
//! 2. 敬称（さん・様・さま・くん・君・ちゃん・氏・殿・先生）の直前の名前らしい語を「（名前）」にする。続柄（ご主人・奥さま・お子さま・
//!    長女など）や一般の語（皆さま・お客さま・同様・担任の先生など）は伏せない
//! 3. 伏せた後にも名前らしい所が残っていそうな所（カタカナの名前らしい語・「〇〇家」・ひらがなの名前らしい語＋敬称・氏名の形）を目安として返す
//!    （画面の確かめで先に出す。目安で、漏れも空振りもある）
//!
//! 名前らしい語: 敬称の直前の、漢字・カタカナ・英字の続き（12字まで。空白か「・」をはさんだ前の名字も含める）。無ければ、敬称の前の
//! ひらがなの続き（2〜5字。助詞と同じ字でも切らない）と、そのすぐ前の漢字・カタカナ（名字）。1字の名字（王さん・今さん）も伏せる。
//!
//! 伏せる前に、半角カナを全角に、全角の英数字を半角にそろえる。伏せる言葉は、空白の有無・全角半角・英字の大小の違いを同じとみる。
//! 電話番号・メールアドレス・住所も置き換える（`contacts`）。

/// 伏せた所に入れる言葉
pub const NAME_MARK: &str = "（名前）";

/// メモと面談の記録の1つの欄の長さの上限（伏せた後に切る）
pub const NOTE_FIELD_MAX: usize = 4000;

/// 名前を伏せてから、行ごとに上限で切る（0249 の点検の直し: 切ってから伏せると、切れ目の敬称が落ちて名前が残る）。
/// 行が「見出し: 本文」の形なら本文の字数で切り（`caps` に見出しごとの上限、無ければ `default`）、「（名前）」の途中では切らない
pub fn mask_and_cut(
    text: &str,
    words: &[String],
    caps: &[(&str, usize)],
    default: usize,
) -> Masked {
    let m = mask_names(text, words);
    // 欄に分ける: 見出しの付いた行から欄が始まり、見出しの無い次の行（欄の中の改行）は同じ欄に入れる（上限は欄の全体にかける）。
    // `caps` があるとき（抜き出し）は、`caps` の見出しだけを欄の始まりとみる（欄の中の「注: …」のような行で上限を外さない）
    let label_of = |line: &str| -> Option<usize> {
        let p = line.find(": ")?;
        let label = &line[..p + 2];
        let known = if caps.is_empty() {
            line[..p].chars().count() <= 20
        } else {
            caps.iter().any(|(l, _)| *l == label)
        };
        known.then_some(p + 2)
    };
    let mut fields: Vec<(String, String)> = Vec::new();
    let mut open = false;
    for line in m.text.split('\n') {
        match label_of(line) {
            Some(p) => {
                fields.push((line[..p].to_owned(), line[p..].to_owned()));
                open = true;
            }
            // 見出しの付いた欄の続きの行（抜き出しのときだけ。ほかの文は行ごと）
            None if open && !caps.is_empty() => {
                if let Some(f) = fields.last_mut() {
                    f.1.push('\n');
                    f.1.push_str(line);
                }
            }
            None => {
                fields.push((String::new(), line.to_owned()));
                open = false;
            }
        }
    }
    let mut lines: Vec<String> = Vec::new();
    for (label, body) in fields {
        let cap = caps
            .iter()
            .find(|(l, _)| *l == label)
            .map_or(default, |(_, c)| *c);
        let chars: Vec<char> = body.chars().collect();
        if chars.len() <= cap {
            lines.push(format!("{label}{body}"));
            continue;
        }
        // 切れ目が伏せた所（「（名前）」「〔電話番号〕」など）の途中なら、その前で切る
        let mut n = cap;
        for (s, e) in all_spans(&chars) {
            if s < n && n < e {
                n = s;
            }
        }
        lines.push(format!("{label}{}…", chars[..n].iter().collect::<String>()));
    }
    let out: Vec<char> = lines.join("\n").chars().collect();
    Masked {
        spans: all_spans(&out),
        text: out.into_iter().collect(),
    }
}

/// 敬称（長い順に見る）
const HONORIFICS: [&str; 9] = [
    "ちゃん",
    "先生",
    "さん",
    "さま",
    "くん",
    "様",
    "君",
    "氏",
    "殿",
];

/// 敬称の前にあっても伏せない語（続柄・人を指す一般の語・「同様」「仕様」のような熟語の頭）。語の全体が一致するときだけ
const NOT_NAMES: &[&str] = &[
    // 続柄・家族
    "主人",
    "旦那",
    "奥",
    "子",
    "息子",
    "娘",
    "長男",
    "次男",
    "三男",
    "四男",
    "長女",
    "次女",
    "三女",
    "四女",
    "末子",
    "父",
    "母",
    "祖父",
    "祖母",
    "曾祖父",
    "曾祖母",
    "義父",
    "義母",
    "叔父",
    "叔母",
    "伯父",
    "伯母",
    "兄",
    "姉",
    "弟",
    "妹",
    "義兄",
    "義姉",
    "義弟",
    "義妹",
    "夫",
    "妻",
    "嫁",
    "婿",
    "孫",
    "甥",
    "姪",
    "親",
    "両親",
    "家族",
    "本人",
    "赤",
    "坊",
    "嬢",
    "姫",
    "王子",
    "ママ",
    "パパ",
    "ジジ",
    "ババ",
    // 人を指す一般の語
    "皆",
    "客",
    "医者",
    "担当",
    "先方",
    "相手",
    "社長",
    "会長",
    "部長",
    "課長",
    "係長",
    "店長",
    "大家",
    "上司",
    "同僚",
    "友達",
    "友人",
    "先輩",
    "後輩",
    "担任",
    "主治医",
    "医師",
    "税理士",
    "弁護士",
    "司法書士",
    "行政書士",
    "保険屋",
    "営業",
    "彼女",
    "各位",
    // 時を表す語・人数など（「毎月ちゃんと貯金」）
    "毎月",
    "毎日",
    "毎年",
    "毎週",
    "毎回",
    "今回",
    "今度",
    "次回",
    "前回",
    "今月",
    "来月",
    "先月",
    "今年",
    "来年",
    "去年",
    "今日",
    "明日",
    "昨日",
    "今後",
    "最近",
    "普段",
    "全部",
    "全員",
    "自分",
    "夫婦",
];

/// 敬称の前の語がこの語で終わるとき、名前としては伏せない（契約者様・法定相続人様。「者」で終わる語も伏せない）
const NOT_NAME_ENDINGS: &[&str] = &[
    "相続人",
    "受取人",
    "代理人",
    "保証人",
    "後見人",
    "管理人",
    "名義人",
    "依頼人",
    "仲介人",
    "世話人",
    "相談人",
];

/// 数字のすぐ後ろにあるとき、名前に入れない単位（「100万円田中さん」の「万円」・「3月田中さん」の「月」。いちばん長い1つだけ外す
/// 〔「3月本田さん」の「本」は名字に残す〕）
const UNITS: &[&str] = &[
    "万円", "億円", "千円", "万", "億", "千", "百", "円", "年", "ヶ月", "か月", "カ月", "月", "日",
    "時間", "時", "分", "秒", "歳", "才", "回", "件", "人", "名", "個", "社", "号", "割", "倍",
    "代", "期", "週", "台", "戸", "階", "丁目", "番地", "番", "本", "枚", "点",
];

/// 敬称の前の語と敬称で1つの言葉になるもの（名前としては伏せない）。1字の名字（王さん・今さん・神さん・上さん）は伏せる
const COMPOUNDS: &[&str] = &[
    "同様",
    "仕様",
    "模様",
    "多様",
    "異様",
    "左様",
    "有様",
    "一様",
    "今様",
    "王様",
    "神様",
    "仏様",
    "殿様",
    "上様",
    "何様",
    "両氏",
    "同氏",
    "各氏",
    "諸氏",
    "彼氏",
    "御殿",
    "苦労様",
    "陰様",
    "馳走様",
    "世話様",
    "愁傷様",
    "生憎様",
    "摂氏",
    "華氏",
];

/// 敬称の字で始まるが、敬称と読まない語（語の全体で見る）。前がひらがなの語のときだけ効く
/// （前が漢字・カタカナ・英字の名前らしい語なら、後ろに何が続いても敬称と読む。「田中さんから」「田中様相談」「田中氏名義」）
const NOT_HONORIFIC_WORDS: &[&str] = &[
    // 名前の後に来ても誤らない形だけ（「みどりさんまで」「みどりさんかの」「みどりさんみたい」「ひなたさまより」は名前と読む。6回目の点検）
    "さんかす",
    "さんかし",
    "さんかさ",
    "さんかせ",
    "さんかを",
    "さんかひ",
    "さんかしゃ",
    "さんこうに",
    "さんこうと",
    "さんこうま",
    "さんこうし",
    "さんぽ",
    "さんまを",
    "さんまの",
    "さんまが",
    "さんまは",
    "さんまも",
    "さんまや",
    "さんま定",
    "さんざん",
    "さんすう",
    "さんかく",
    "さんしょう",
    "さまざま",
    "さまよう",
    "さまよい",
    "さまよっ",
    "さまよわ",
    "さまよえ",
    "様子",
    "様々",
    "様式",
    "様相",
    "様態",
    "氏名",
    "氏族",
    "君主",
    "君臨",
    "殿堂",
    "殿下",
    "殿方",
    "ちゃんぽん",
    "ちゃんこ鍋",
    "ちゃんこを",
    "ちゃんばら",
    "ちゃんねる",
];

/// 前が名前らしい語でも、敬称と読まない語（「申請様式」「顧客氏名」。「氏名義」は「氏」＋「名義」と読む）
const NOT_HONORIFIC_STRONG: &[(&str, &str)] = &[("様式", ""), ("氏名", "氏名義")];

/// 「ちゃんと」の前にあるとき、「ちゃん」を敬称と読まないひらがなの語（「もうちゃんと決めた」）
const ADVERBS_BEFORE_CHANTO: &[&str] = &[
    "もう",
    "まだ",
    "いつも",
    "もっと",
    "ずっと",
    "きっと",
    "まず",
    "また",
    "あと",
    "それ",
    "これ",
    "みんな",
    "ちょっと",
];

/// 前に「お」「ご」が付くときだけ伏せない1字の語（お孫さん・お子さん・お客さん。「孫さん」は名字として伏せる）
const PREFIX_ONLY: &[&str] = &["孫", "子", "客"];

/// ひらがなの名前の頭にあるとき、前の漢字・カタカナを名字として一緒に伏せない字（助詞として読める字。「山田はなこさん」の「は」）
const STRONG_PARTICLES: &[char] = &['の', 'は', 'が', 'を', 'に', 'へ', 'で', 'と', 'も'];

/// ひらがなの続きのうち、敬称の前にあっても伏せない語
const NOT_NAMES_KANA: &[&str] = &[
    "おじい",
    "おばあ",
    "おじ",
    "おば",
    "おとう",
    "おかあ",
    "おにい",
    "おねえ",
    "おく",
    "みな",
    "おきゃく",
    "じい",
    "ばあ",
    "あか",
    "ぼっ",
    "おじょう",
    "じょう",
    "うと",
    "にい",
    "ねえ",
    "かあ",
    "とう",
    "おいしゃ",
    "おまわり",
    "おぼっ",
    "おこ",
    "むすこ",
    "むすめ",
    "おかみ",
    "おくさ",
    "だんな",
    "みなさ",
    // 名前でない語（たくさん・おかげさま・ごちそうさま・おつかれさま・お世話さま・お互いさま・この様に・する様に）
    "たく",
    "かげ",
    "ちそう",
    "つかれ",
    "せわ",
    "たがい",
    "この",
    "その",
    "あの",
    "どの",
    "する",
    "なる",
    "れる",
    "ある",
    "いる",
    "ない",
];

/// 伏せた後の文と、伏せた所（伏せた後の文の中の文字の位置。始まりと終わり）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Masked {
    pub text: String,
    pub spans: Vec<(usize, usize)>,
}

fn is_kanji(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '々' | '〆' | 'ヶ')
}

fn is_katakana(c: char) -> bool {
    matches!(c, '\u{30A1}'..='\u{30FA}' | 'ー' | 'ヽ' | 'ヾ')
}

fn is_hiragana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{3096}' | 'ゝ' | 'ゞ')
}

fn is_latin(c: char) -> bool {
    c.is_ascii_alphabetic() || matches!(c, 'Ａ'..='Ｚ' | 'ａ'..='ｚ')
}

/// 名前らしい語に入る字（漢字・カタカナ・英字）
fn is_name_char(c: char) -> bool {
    is_kanji(c) || is_katakana(c) || is_latin(c)
}

/// その位置の敬称（字が一致するか。敬称と読むかは、前の語と後ろの語で決める）
fn honorific_at(chars: &[char], i: usize) -> Option<usize> {
    HONORIFICS.iter().find_map(|h| {
        let hc: Vec<char> = h.chars().collect();
        (chars.len() >= i + hc.len() && chars[i..i + hc.len()] == hc[..]).then_some(hc.len())
    })
}

/// その位置から、`word` が続くか
fn starts_with_at(chars: &[char], i: usize, word: &str) -> bool {
    let w: Vec<char> = word.chars().collect();
    chars.len() >= i + w.len() && chars[i..i + w.len()] == w[..]
}

/// その位置の敬称の字が、敬称と読まない語の頭か（`strong` は前が名前らしい語のときにも効く語だけを見る）
fn not_honorific_word(chars: &[char], i: usize, strong: bool) -> bool {
    if strong {
        return NOT_HONORIFIC_STRONG.iter().any(|(w, except)| {
            starts_with_at(chars, i, w) && (except.is_empty() || !starts_with_at(chars, i, except))
        });
    }
    NOT_HONORIFIC_WORDS
        .iter()
        .any(|w| starts_with_at(chars, i, w))
}

/// 空白か「・」をはさんだ前の名前字の続き（氏名の名字。6字まで）があれば、その始まり
fn surname_before(chars: &[char], start: usize) -> usize {
    if start < 2 || !matches!(chars[start - 1], ' ' | '\u{3000}' | '・') {
        return start;
    }
    let mut s = start - 1;
    let end = s;
    while s > 0 && end - s < 6 && is_name_char(chars[s - 1]) {
        s -= 1;
    }
    let word: String = chars[s..end].iter().collect();
    if s < end && !NOT_NAMES.contains(&word.as_str()) {
        s
    } else {
        start
    }
}

/// 数字のすぐ後ろの単位の長さ（いちばん長い1つ。`start` の前が数字でなければ 0）
fn unit_len(chars: &[char], start: usize, end: usize) -> usize {
    if start == 0 || !chars[start - 1].is_ascii_digit() {
        return 0;
    }
    UNITS
        .iter()
        .filter(|u| starts_with_at(&chars[..end], start, u))
        .map(|u| u.chars().count())
        .max()
        .unwrap_or(0)
}

/// 「もうちゃんと決めた」「家計簿をちゃんと」: 「ちゃんと」の前のひらがなが副詞か助詞で終わるか（名前ではない）
fn adverb_before_chanto(
    chars: &[char],
    end: usize,
    word: &str,
    honorific: &str,
    after: &[char],
) -> bool {
    honorific == "ちゃん"
        && after.get(3) == Some(&'と')
        && (ADVERBS_BEFORE_CHANTO.iter().any(|a| word.ends_with(a))
            || matches!(
                chars[end - 1],
                'を' | 'は' | 'も' | 'に' | 'で' | 'が' | 'へ' | 'や'
            ))
}

/// 名前としては伏せない語か（続柄・一般の語・「者」「相続人」で終わる語）
fn not_a_name(word: &str) -> bool {
    NOT_NAMES.contains(&word)
        || (word.chars().count() >= 2 && word.ends_with('者'))
        || NOT_NAME_ENDINGS.iter().any(|e| word.ends_with(e))
}

/// 敬称の直前の名前らしい語の始まり（伏せないときは None）。`end` は敬称の位置、`honorific` は敬称、`after` は敬称の位置からの文
/// （`chars` は伏せている途中の文で、`after` は元の文）
fn name_before(chars: &[char], end: usize, honorific: &str, after: &[char]) -> Option<usize> {
    // 「田中 様」「田中　さん」: 敬称の前の空白（2字まで）は飛ばす（漢字・カタカナ・英字の名前のときだけ）
    let mut e = end;
    while e > 0 && end - e < 2 && matches!(chars[e - 1], ' ' | '\u{3000}') {
        e -= 1;
    }
    let spaced = e < end;
    let mut start = e;
    while start > 0 && e - start < 12 && is_name_char(chars[start - 1]) {
        start -= 1;
    }
    // 数字のすぐ後ろの単位の字（万円・月・歳・時）は名前に入れない
    if start < e {
        start += unit_len(chars, start, e);
        if start == e {
            return None;
        }
        // 敬称と読まない語: 前が名前らしい語でも「申請様式」「顧客氏名」。空白をはさむときは一覧の全部（「模様 様子」「多様 氏名」）
        if not_honorific_word(after, 0, true) || (spaced && not_honorific_word(after, 0, false)) {
            return None;
        }
        let word: String = chars[start..e].iter().collect();
        let full = format!("{word}{honorific}");
        if COMPOUNDS.iter().any(|c| full.ends_with(c)) {
            return None;
        }
        if PREFIX_ONLY.contains(&word.as_str()) {
            let prefixed = start > 0 && matches!(chars[start - 1], 'お' | 'ご');
            return (!prefixed).then(|| surname_before(chars, start));
        }
        if not_a_name(&word) {
            return None;
        }
        // 「田中 太郎さん」「Tanaka Taroさん」は、空白の前の名字まで
        return Some(surname_before(chars, start));
    }
    if spaced || not_honorific_word(after, 0, false) {
        return None;
    }
    // ひらがなの名前（敬称の前の2〜5字。助詞と同じ字でも切らない〔のぞみ・はなこ・ともこ〕）
    let mut s = end;
    while s > 0 && end - s < 5 && is_hiragana(chars[s - 1]) {
        s -= 1;
    }
    if end - s < 2 {
        return None;
    }
    let word: String = chars[s..end].iter().collect();
    if NOT_NAMES_KANA.iter().any(|k| word.ends_with(k)) {
        return None;
    }
    if adverb_before_chanto(chars, end, &word, honorific, after) {
        return None;
    }
    // 「田中みどりさん」: すぐ前の漢字・カタカナ（名字）も一緒に伏せる。ひらがなの頭が助詞として読める字なら一緒にしない
    if s > 0 && is_name_char(chars[s - 1]) && !STRONG_PARTICLES.contains(&chars[s]) {
        let mut k = s;
        while k > 0 && s - k < 12 && is_name_char(chars[k - 1]) {
            k -= 1;
        }
        let w: String = chars[k..s].iter().collect();
        if !not_a_name(&w) {
            return Some(surname_before(chars, k));
        }
    }
    Some(s)
}

/// 伏せた所に入れる言葉（名前・電話番号・メールアドレス・住所）
pub const MARKS: [&str; 4] = [
    NAME_MARK,
    crate::contacts::PHONE_MARK,
    crate::contacts::MAIL_MARK,
    crate::contacts::ADDRESS_MARK,
];

/// 伏せる言葉と照らすための形（空白を除き、英字は小文字に）
fn fold(c: char) -> char {
    c.to_ascii_lowercase()
}

fn is_space(c: char) -> bool {
    c == ' ' || c == '\u{3000}' || c == '\t'
}

/// FP が入れた伏せる言葉を「（名前）」にする。空白の有無・全角半角・英字の大小の違いは同じとみる（文と言葉の両方をそろえてから照らす）
fn mask_words(chars: &[char], words: &[String]) -> Vec<char> {
    let mut list: Vec<Vec<char>> = words
        .iter()
        .map(|w| {
            crate::contacts::normalize(w)
                .chars()
                .filter(|c| !is_space(*c))
                .map(fold)
                .collect::<Vec<char>>()
        })
        .filter(|w: &Vec<char>| {
            let t: String = w.iter().collect();
            !w.is_empty() && !MARKS.iter().any(|m| m.contains(t.as_str()))
        })
        .collect();
    list.sort_by_key(|w| std::cmp::Reverse(w.len()));
    list.dedup();
    let mark: Vec<char> = NAME_MARK.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut i = 0;
    'outer: while i < chars.len() {
        for w in &list {
            // 文の側は、言葉の字の間の空白を飛ばして照らす
            let mut k = i;
            let mut ok = true;
            for (n, wc) in w.iter().enumerate() {
                if n > 0 {
                    while k < chars.len() && is_space(chars[k]) {
                        k += 1;
                    }
                }
                if k >= chars.len() || fold(chars[k]) != *wc {
                    ok = false;
                    break;
                }
                k += 1;
            }
            if ok {
                out.extend(mark.iter());
                i = k;
                continue 'outer;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 名前・連絡先・住所を伏せる（文をそろえる → 伏せる言葉 → 電話番号・メールアドレス・住所 → 敬称の前の名前らしい語）
pub fn mask_names(text: &str, words: &[String]) -> Masked {
    let normalized = crate::contacts::normalize(text);
    let chars: Vec<char> = normalized.chars().collect();
    let worded: String = mask_words(&chars, words).into_iter().collect();
    let contacted = crate::contacts::mask_contacts(&worded);
    let chars: Vec<char> = contacted.chars().collect();
    let mark: Vec<char> = NAME_MARK.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if let Some(hlen) = honorific_at(&chars, i) {
            // 直前がもう「（名前）」なら、そのまま
            let already = out.len() >= mark.len() && out[out.len() - mark.len()..] == mark[..];
            if !already {
                let h: String = chars[i..i + hlen].iter().collect();
                if let Some(start) = name_before(&out, out.len(), &h, &chars[i..]) {
                    out.truncate(start);
                    out.extend(mark.iter());
                }
            }
            out.extend(&chars[i..i + hlen]);
            i += hlen;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    let spans = all_spans(&out);
    Masked {
        text: out.into_iter().collect(),
        spans,
    }
}

/// 伏せた所すべて（名前・電話番号・メールアドレス・住所）
fn all_spans(text: &[char]) -> Vec<(usize, usize)> {
    let mut v: Vec<(usize, usize)> = MARKS
        .iter()
        .flat_map(|m| spans_of(text, &m.chars().collect::<Vec<char>>()))
        .collect();
    v.sort();
    v
}

fn spans_of(text: &[char], mark: &[char]) -> Vec<(usize, usize)> {
    let mut v = Vec::new();
    let mut i = 0;
    while i + mark.len() <= text.len() {
        if text[i..i + mark.len()] == mark[..] {
            v.push((i, i + mark.len()));
            i += mark.len();
        } else {
            i += 1;
        }
    }
    v
}

/// よく使うカタカナの語（名前らしいカタカナの目安から外す）
const COMMON_KATAKANA: &[&str] = &[
    "ローン",
    "パート",
    "ボーナス",
    "アルバイト",
    "マンション",
    "アパート",
    "ペット",
    "ニーサ",
    "イデコ",
    "ライフプラン",
    "キャッシュフロー",
    "プラン",
    "メモ",
    "メール",
    "ライン",
    "スマホ",
    "パソコン",
    "カード",
    "クレジット",
    "ポイント",
    "ネット",
    "サービス",
    "セミナー",
    "リフォーム",
    "ローン",
    "テレビ",
    "ゴルフ",
    "ジム",
    "サークル",
    "クラブ",
    "スクール",
    "レッスン",
    "ピアノ",
    "サッカー",
    "スイミング",
    "コンサル",
    "ファイナンシャル",
    "プランナー",
    "ママ",
    "パパ",
    "ケア",
    "デイ",
    "サービス",
    "ホーム",
    "グループ",
    "シニア",
    "リタイア",
    "フリーランス",
    "サラリーマン",
    "パートナー",
    "シングル",
    "ダブル",
    "インカム",
    "ペア",
    "ネーム",
    "ハウス",
    "メーカー",
    "ホテル",
    "レストラン",
    "カフェ",
    "スーパー",
    "コンビニ",
    "タクシー",
    "バス",
    "マイカー",
    "ガソリン",
    "ガス",
    "ドル",
    "ユーロ",
];

/// 伏せた後に、名前らしい所が残っていそうな所（目安。短い前後の文を返す。重ならない最初の10件まで）
pub fn suspects(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut hits: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < n {
        // カタカナの続き（2〜6字）で、よく使う語でなく、後ろが助詞・敬称・区切り
        if is_katakana(chars[i]) && (i == 0 || !is_katakana(chars[i - 1])) {
            let mut j = i;
            while j < n && is_katakana(chars[j]) {
                j += 1;
            }
            let word: String = chars[i..j].iter().collect();
            let next = chars.get(j).copied();
            let after_ok = matches!(
                next,
                None | Some(
                    'の' | 'が'
                        | 'は'
                        | 'と'
                        | 'に'
                        | 'も'
                        | 'へ'
                        | 'さ'
                        | 'ち'
                        | 'く'
                        | '様'
                        | '君'
                        | '、'
                        | '。'
                        | ' '
                        | '　'
                        | '）'
                        | '」'
                )
            );
            if (2..=6).contains(&(j - i))
                && after_ok
                && !COMMON_KATAKANA.contains(&word.as_str())
                && !word.ends_with('ー')
            {
                hits.push((i, j));
            }
            i = j;
            continue;
        }
        // 「〇〇家」（漢字2〜3字＋家。一般の語は外す）
        if chars[i] == '家' && i >= 2 {
            let mut s = i;
            while s > 0 && i - s < 3 && is_kanji(chars[s - 1]) {
                s -= 1;
            }
            let word: String = chars[s..i].iter().collect();
            const NOT: &[&str] = &[
                "実", "本", "分", "農", "一", "大", "画", "作", "専門", "政治", "投資", "資産",
                "空き", "自", "両", "持ち", "我", "生", "旧", "隣", "空",
            ];
            if i - s >= 2 && !NOT.contains(&word.as_str()) {
                hits.push((s, i + 1));
            }
        }
        // ひらがなの名前らしい語＋敬称が伏せずに残った所（敬称の前の字がひらがな）
        if let Some(hlen) = honorific_at(&chars, i) {
            if i > 0 && is_hiragana(chars[i - 1]) && !not_honorific_word(&chars, i, false) {
                let mut s = i;
                while s > 0 && i - s < 5 && is_hiragana(chars[s - 1]) {
                    s -= 1;
                }
                let word: String = chars[s..i].iter().collect();
                let h: String = chars[i..i + hlen].iter().collect();
                if i - s >= 2
                    && !NOT_NAMES_KANA.iter().any(|k| word.ends_with(k))
                    && !adverb_before_chanto(&chars, i, &word, &h, &chars[i..])
                {
                    hits.push((s, i + hlen));
                }
            }
            i += hlen;
            continue;
        }
        // 伏せた名前のすぐ前に残った漢字・カタカナ（名字が残っていそう。「山田（名前）さん」）
        if chars[i..].starts_with(&['（', '名', '前', '）'])
            && i > 0
            && is_name_char(chars[i - 1])
            && honorific_at(&chars, i + 4).is_some()
        {
            let mut s = i;
            while s > 0 && i - s < 4 && is_name_char(chars[s - 1]) {
                s -= 1;
            }
            // 数字の単位（「100万円（名前）さん」の「万円」）は名字とみない
            let s = s + unit_len(&chars, s, i);
            let w: String = chars[s..i].iter().collect();
            if s < i && !not_a_name(&w) {
                hits.push((s, i + 4));
            }
        }
        // 名字らしい漢字2〜3字＋夫妻・宅・社長・税理士、氏名の後の（年齢）、続柄の後の名前（長男の翔太・妻:花子）
        if is_kanji(chars[i]) && (i == 0 || !is_kanji(chars[i - 1])) {
            let mut j = i;
            while j < n && j - i < 6 && is_kanji(chars[j]) {
                j += 1;
            }
            let word: String = chars[i..j].iter().collect();
            let rest: String = chars[j..n.min(j + 4)].iter().collect();
            let after_age = (rest.starts_with('（') || rest.starts_with('('))
                && rest.chars().nth(1).is_some_and(|c| c.is_ascii_digit());
            for tail in ["ご夫妻", "夫妻", "宅", "社長", "税理士"] {
                if (2..=3).contains(&(j - i)) && rest.starts_with(tail) {
                    hits.push((i, j));
                }
                if word.len() > tail.len() && word.ends_with(tail) {
                    let k = word.chars().count() - tail.chars().count();
                    if (2..=3).contains(&k) {
                        hits.push((i, j));
                    }
                }
            }
            if (2..=4).contains(&(j - i)) && after_age && !NOT_NAMES.contains(&word.as_str()) {
                hits.push((i, j));
            }
            if NOT_NAMES.contains(&word.as_str()) {
                let sep = chars.get(j).copied();
                if matches!(sep, Some('の' | ':' | '：')) {
                    let mut k = j + 1;
                    while k < n && k - j - 1 < 4 && is_name_char(chars[k]) {
                        k += 1;
                    }
                    if k > j + 1 && honorific_at(&chars, k).is_none() {
                        let w2: String = chars[j + 1..k].iter().collect();
                        // 「の」の後は、カタカナの名前らしい語だけ（「妻の年収」のような言い方を目安に出さない）
                        let katakana = w2.chars().all(is_katakana);
                        let colon = sep != Some('の');
                        if (colon || katakana)
                            && !NOT_NAMES.contains(&w2.as_str())
                            && !COMMON_KATAKANA.contains(&w2.as_str())
                        {
                            hits.push((i, k));
                        }
                    }
                }
            }
        }
        // 氏名の形（漢字1〜3字、空白か「・」、漢字1〜3字）
        if (chars[i] == ' ' || chars[i] == '　' || chars[i] == '・')
            && i > 0
            && is_kanji(chars[i - 1])
            && chars.get(i + 1).is_some_and(|c| is_kanji(*c))
        {
            let mut s = i;
            while s > 0 && i - s < 3 && is_kanji(chars[s - 1]) {
                s -= 1;
            }
            let mut e = i + 1;
            while e < n && e - i - 1 < 3 && is_kanji(chars[e]) {
                e += 1;
            }
            let left = i - s;
            let right = e - i - 1;
            if (1..=3).contains(&left) && (1..=3).contains(&right) && left + right >= 3 {
                hits.push((s, e));
            }
        }
        i += 1;
    }
    hits.sort();
    let mut out: Vec<String> = Vec::new();
    let mut last_end = 0;
    for (s, e) in hits {
        if s < last_end {
            continue;
        }
        last_end = e;
        let from = s.saturating_sub(4);
        let to = (e + 4).min(n);
        out.push(chars[from..to].iter().collect());
        if out.len() >= 10 {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(t: &str) -> String {
        mask_names(t, &[]).text
    }

    #[test]
    fn names_before_honorifics_are_masked() {
        assert_eq!(m("田中さんと相談"), "（名前）さんと相談");
        assert_eq!(
            m("長女の花子ちゃんは小学生"),
            "長女の（名前）ちゃんは小学生"
        );
        assert_eq!(m("佐藤様より連絡"), "（名前）様より連絡");
        assert_eq!(m("山田太郎氏"), "（名前）氏");
        assert_eq!(m("鈴木先生に診てもらう"), "（名前）先生に診てもらう");
        assert_eq!(m("健太くんの塾"), "（名前）くんの塾");
        assert_eq!(m("翔君"), "（名前）君");
        assert_eq!(m("高橋殿"), "（名前）殿");
        assert_eq!(m("タナカさま"), "（名前）さま");
        assert_eq!(m("Tomさん"), "（名前）さん");
        // ひらがなの名前は敬称の前の5字までを伏せる（「の」も一緒に伏せることがある。伏せすぎの側）
        assert_eq!(m("娘のさくらちゃん"), "娘（名前）ちゃん");
        assert_eq!(m("みどりさんが来た"), "（名前）さんが来た");
        // 文の頭でも・連なっても
        assert_eq!(m("伊藤さん、木村さん"), "（名前）さん、（名前）さん");
    }

    #[test]
    fn relations_and_common_words_stay() {
        for t in [
            "ご主人様と奥さまが来所",
            "お子さまの教育費",
            "息子さんが就職",
            "娘さんの結婚",
            "お父さんの介護",
            "お母さま",
            "おじいちゃんの相続",
            "おばあさん",
            "皆さま",
            "お客さま",
            "お客様",
            "奥さん",
            "旦那さん",
            "長女さん",
            "叔母さま",
            "担任の先生",
            "主治医の先生",
            "担任先生",
            "同様に",
            "様子を見る",
            "様々な案",
            "仕様",
            "氏名は書かない",
            "さまざまな",
            "赤ちゃん",
            "お姉ちゃん",
            "お兄さん",
            "ママさん",
            "大家さん",
            "お医者さん",
            "両氏",
            "殿堂",
            "おさんぽ",
            "さんかする",
        ] {
            assert_eq!(m(t), t, "{t}");
        }
    }

    #[test]
    fn words_given_by_the_fp_are_masked_anywhere() {
        let w = vec!["田中".to_owned(), " ".to_owned(), "田中一郎".to_owned()];
        let r = mask_names("田中一郎の口座と田中の実家。ご主人様", &w);
        assert_eq!(r.text, "（名前）の口座と（名前）の実家。ご主人様");
        assert_eq!(r.spans, vec![(0, 4), (8, 12)]);
        // 伏せた後の敬称は重ねて伏せない
        let r = mask_names("田中さん", &["田中".to_owned()]);
        assert_eq!(r.text, "（名前）さん");
        assert_eq!(r.spans.len(), 1);
        // 「（名前）」の一部の言葉は使わない
        assert_eq!(
            mask_names("名前の欄", &["名前".to_owned()]).text,
            "名前の欄"
        );
        assert_eq!(mask_names("前", &["前".to_owned()]).text, "前");
    }

    #[test]
    fn long_runs_are_capped() {
        // 12字を超える漢字の続きは、敬称の直前の12字だけ伏せる
        let t = "一二三四五六七八九十壱弐参肆さん";
        assert_eq!(m(t), "一二（名前）さん");
    }

    #[test]
    fn suspects_find_names_left_without_honorifics() {
        assert!(!suspects("ケンタが来年入学").is_empty());
        assert!(!suspects("田中家の相続").is_empty());
        assert!(!suspects("山田 太郎の件").is_empty());
        assert!(!suspects("ともこちゃん").is_empty() || m("ともこちゃん") != "ともこちゃん");
        // よく使う語は目安に出さない
        assert!(suspects("ローンとボーナスとパート。実家の相続").is_empty());
        assert!(suspects("（名前）さんの教育費").is_empty());
        assert!(suspects("").is_empty());
    }

    /// 2回目の点検の表（伏せるか、少なくとも目安に出す）
    #[test]
    fn names_from_the_review_are_masked_or_flagged() {
        for (t, want) in [
            ("田中みどりさん", "（名前）さん"),
            ("田中 太郎さん", "（名前）さん"),
            ("田中\u{3000}太郎様", "（名前）様"),
            ("のぞみちゃん", "（名前）ちゃん"),
            ("ともこちゃん", "（名前）ちゃん"),
            ("かおりさん", "（名前）さん"),
            ("たなかさん", "（名前）さん"),
            ("王さん", "（名前）さん"),
            ("今さん", "（名前）さん"),
            ("神さん", "（名前）さん"),
            ("孫さん", "（名前）さん"),
            ("上さん", "（名前）さん"),
            ("ﾀﾅｶさん", "（名前）さん"),
            ("Tanaka Taroさん", "（名前）さん"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        // 1字の語でも、言葉として読めるものは伏せない
        for t in [
            "お孫さん",
            "お子さん",
            "お客さん",
            "神様",
            "同様",
            "王様",
            "両氏",
        ] {
            assert_eq!(m(t), t, "{t}");
        }
        // 「山田はなこさん」は名前を伏せ、残った名字は目安に出す
        let r = m("山田はなこさん");
        assert!(!r.contains("はなこ"), "{r}");
        assert!(!suspects(&r).is_empty(), "{r}");
        // 目安に出すもの
        for t in [
            "田中夫妻",
            "田中ご夫妻",
            "田中宅",
            "田中社長",
            "鈴木税理士",
            "田中太郎（45歳）",
            "妻:花子(42)",
            "長男のショウタ",
        ] {
            assert!(!suspects(&m(t)).is_empty(), "{t}: {}", m(t));
        }
        // ふつうの言い方は目安に出さない
        for t in ["妻の年収", "長男の教育費", "（名前）さんの教育費"] {
            assert!(suspects(&m(t)).is_empty(), "{t}");
        }
    }

    /// 伏せる言葉は、空白の有無・全角半角・英字の大小の違いを同じとみる（言葉の側も文の側も）
    #[test]
    fn words_are_matched_after_normalizing() {
        let w = |x: &[&str]| x.iter().map(|s| (*s).to_owned()).collect::<Vec<String>>();
        assert_eq!(
            mask_names("田中 一郎の件", &w(&["田中一郎"])).text,
            "（名前）の件"
        );
        assert_eq!(
            mask_names("田中一郎の件", &w(&["田中　一郎"])).text,
            "（名前）の件"
        );
        assert_eq!(mask_names("ﾔﾏﾀﾞ商店", &w(&["ヤマダ"])).text, "（名前）商店");
        assert_eq!(
            mask_names("TANAKAの件", &w(&["ｔａｎａｋａ"])).text,
            "（名前）の件"
        );
        // 伏せた所の印の一部の言葉は使わない
        assert_eq!(mask_names("住所の欄", &w(&["住所"])).text, "住所の欄");
    }

    /// 電話番号・メールアドレス・住所も伏せ、伏せた所に印を付ける
    #[test]
    fn contacts_are_masked_with_names() {
        let r = mask_names(
            "田中さんの携帯は090-1234-5678、メールは t@example.com、住所はつくば市竹園1-2-3",
            &[],
        );
        assert_eq!(
            r.text,
            "（名前）さんの携帯は〔電話番号〕、メールは 〔メールアドレス〕、住所は〔住所〕"
        );
        assert_eq!(r.spans.len(), 4);
        // 上限で切るときも、伏せた所の途中では切らない
        let c = mask_and_cut("あああ090-1234-5678", &[], &[], 5);
        assert_eq!(c.text, "あああ…");
    }

    /// 5回目の点検: 敬称の後ろに何が続いても、前が名前らしい語なら伏せる（「〇〇さんから」「〇〇様相談」「〇〇氏名義」）
    #[test]
    fn names_are_masked_whatever_follows_the_honorific() {
        for (t, want) in [
            ("田中さんから電話", "（名前）さんから電話"),
            ("田中さんからの紹介", "（名前）さんからの紹介"),
            ("みどりさんから", "（名前）さんから"),
            ("田中さんまで届ける", "（名前）さんまで届ける"),
            ("山田さんまたは奥様", "（名前）さんまたは奥様"),
            ("田中さんか奥様", "（名前）さんか奥様"),
            ("田中さんこそ", "（名前）さんこそ"),
            ("鈴木さんばかり", "（名前）さんばかり"),
            ("田中さんせいで", "（名前）さんせいで"),
            ("田中さまより", "（名前）さまより"),
            ("田中さまた来る", "（名前）さまた来る"),
            ("田中様相談", "（名前）様相談"),
            ("田中様変更希望", "（名前）様変更希望"),
            ("田中様体調不良", "（名前）様体調不良"),
            ("田中氏名義の口座", "（名前）氏名義の口座"),
            ("田中君主催", "（名前）君主催"),
            ("田中殿宛", "（名前）殿宛"),
            ("田中 太郎さんから", "（名前）さんから"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        // 敬称と読まない語（前が名前らしい語でないとき）
        for t in [
            "イベントにさんかする",
            "みんなでさんかする",
            "おさんぽ",
            "さんこうにする",
            "さんざん悩んだ",
            "この様子なら",
            "その様式で",
            "申請様式",
            "顧客氏名",
            "さまざまな",
            "殿堂",
            "ちゃんぽん",
        ] {
            assert_eq!(m(t), t, "{t}");
        }
    }

    /// 5回目の点検: 伏せすぎ（数字の単位・名前でない語）と、敬称の前の空白
    #[test]
    fn units_and_common_words_are_not_masked_and_spaces_are_skipped() {
        for (t, want) in [
            ("100万円田中さんへ贈与", "100万円（名前）さんへ贈与"),
            ("3月田中さんと面談", "3月（名前）さんと面談"),
            ("2026年11月田中さん来社", "2026年11月（名前）さん来社"),
            ("65歳田中様", "65歳（名前）様"),
            ("13時田中様", "13時（名前）様"),
            ("3月本田さん", "3月（名前）さん"),
            ("100万円本田さん", "100万円（名前）さん"),
            ("花子ちゃんと遊ぶ", "（名前）ちゃんと遊ぶ"),
            ("さくらちゃんと遊ぶ", "（名前）ちゃんと遊ぶ"),
            ("田中 様", "（名前）様"),
            ("田中 太郎 様", "（名前）様"),
            ("田中\u{3000}さん", "（名前）さん"),
            ("長谷川 さん", "（名前）さん"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        for t in [
            "毎月ちゃんと貯金",
            "もうちゃんと決めた",
            "家計簿をちゃんとつける",
            "たくさん貯金したい",
            "おかげさまで",
            "ごちそうさま",
            "おつかれさまでした",
            "ご苦労様",
            "お陰様で",
            "この様に",
            "積立する様にする",
            "どの様な",
            "契約者様",
            "被保険者様",
            "相続人様",
            "法定相続人様",
            "配偶者様",
            "ご担当者様",
            "受取人さん",
            "第3号被保険者様",
            "資産3000万円さん",
            "多種多様",
            "同様 仕様 模様 様子 様々 様式 多様 氏名 摂氏 彼氏 君主 殿堂 御殿",
        ] {
            assert_eq!(m(t), t, "{t}");
        }
        // 単位や副詞は、名字が残っていそうな所の目安にも出さない
        for t in ["100万円田中さんへ贈与", "65歳田中様", "もうちゃんと決めた"]
        {
            assert!(suspects(&m(t)).is_empty(), "{t}: {:?}", suspects(&m(t)));
        }
    }

    /// 6回目の点検: ひらがなの名前の後の「さんまで」「さんまたは」「さんまだ」「さまより」も伏せる（敬称と読まない語は、名前の後に来ても誤らない形だけ）
    #[test]
    fn hiragana_names_before_common_words_are_masked() {
        for (t, want) in [
            ("みどりさんまで", "（名前）さんまで"),
            ("はなこさんまで届ける", "（名前）さんまで届ける"),
            ("みどりさんまたはご主人", "（名前）さんまたはご主人"),
            ("さくらさんまだ未定", "（名前）さんまだ未定"),
            ("ひなたさまより", "（名前）さまより"),
            ("ゆうこさまよりお電話", "（名前）さまよりお電話"),
            ("みどりさんかの判断", "（名前）さんかの判断"),
            ("みどりさんみたいに", "（名前）さんみたいに"),
            ("みどりさんそうだん", "（名前）さんそうだん"),
            ("みどりちゃんこっち", "（名前）ちゃんこっち"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        // 敬称と読まない語は、そのまま
        for t in [
            "やいたさんまを食べる",
            "まださまよう",
            "みんなでさんかする",
            "いつもさんぽする",
            "おさんぽ",
            "さんざん悩んだ",
            "ちゃんこ鍋",
            "このさまざまな案",
        ] {
            assert_eq!(m(t), t, "{t}");
        }
    }
}
