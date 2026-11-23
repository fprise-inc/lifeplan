//! メモと面談の履歴を AI に渡す前に、名前を伏せる（0249）。ファイナンシアはお名前を持たない決まり（0012）だが、FP が書いた文には
//! お名前が入りうるので、渡す前に次を当てはめる（同意の文には書かないが、必ず通す）:
//!
//! 1. FP が渡すときに入れた伏せる言葉（お客さまの名字など）を、文のどこにあっても「（名前）」にする。言葉はメモリの上だけで使い、保存しない
//! 2. 敬称（さん・様・さま・くん・君・ちゃん・氏・殿・先生）の直前の名前らしい語を「（名前）」にする。続柄（ご主人・奥さま・お子さま・
//!    長女など）や一般の語（皆さま・お客さま・同様・担任の先生など）は伏せない
//! 3. 伏せた後にも名前らしい所が残っていそうな所（カタカナの名前らしい語・「〇〇家」・ひらがなの名前らしい語＋敬称・氏名の形）を目安として返す
//!    （画面の確かめで先に出す。目安で、漏れも空振りもある）
//!
//! 名前らしい語: 敬称の直前の、漢字・カタカナ・英字の続き（12字まで）。無ければ、助詞（の・は・が など）の後ろからのひらがなの続き（2〜5字）。

/// 伏せた所に入れる言葉
pub const NAME_MARK: &str = "（名前）";

/// 敬称（長い順に当てる）
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
    "神",
    "仏",
    "王",
    "殿",
    "彼",
    "彼女",
    "各位",
    "諸",
    "御",
    // 熟語の頭（同様・仕様・模様・多様・異様・左様・有様・両氏・同氏・各氏 など）
    "同",
    "両",
    "各",
    "仕",
    "有",
    "模",
    "多",
    "異",
    "左",
    "今",
    "一",
    "何",
    "誰",
    "上",
    "外",
    "別",
];

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
];

/// ひらがなの名前らしい語を区切る助詞など
const KANA_STOPS: &[char] = &[
    'の', 'は', 'が', 'を', 'に', 'と', 'も', 'へ', 'で', 'や', 'か', 'ね', 'よ', 'ご', 'お',
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

/// その位置の敬称（敬称として読めない形は外す: 「様子」「様々」「様式」・「氏名」・「さまざま」「さまよう」・「殿堂」・「君主」）
fn honorific_at(chars: &[char], i: usize) -> Option<usize> {
    for h in HONORIFICS {
        let hc: Vec<char> = h.chars().collect();
        if chars.len() < i + hc.len() || chars[i..i + hc.len()] != hc[..] {
            continue;
        }
        let next = chars.get(i + hc.len()).copied();
        let bad = match h {
            "様" => matches!(
                next,
                Some('子' | '々' | '式' | '相' | '態' | '変' | '化' | '体')
            ),
            "氏" => matches!(next, Some('名' | '族')),
            "さま" => matches!(next, Some('ざ' | 'よ' | 'た')),
            "殿" => next.is_some_and(is_kanji),
            "君" => matches!(next, Some('主' | '臨' | '子')),
            "さん" => matches!(next, Some('か' | 'こ' | 'ぽ' | 'ま' | 'ば' | 'せ' | 'ぷ')),
            _ => false,
        };
        if !bad {
            return Some(hc.len());
        }
    }
    None
}

/// 敬称の直前の名前らしい語の始まり（伏せないときは None）
fn name_before(chars: &[char], end: usize) -> Option<usize> {
    let mut start = end;
    while start > 0 && end - start < 12 && is_name_char(chars[start - 1]) {
        start -= 1;
    }
    if start < end {
        let word: String = chars[start..end].iter().collect();
        return (!NOT_NAMES.contains(&word.as_str())).then_some(start);
    }
    // ひらがなの名前（助詞の後ろから、2〜5字）
    let mut s = end;
    while s > 0 && end - s < 5 && is_hiragana(chars[s - 1]) && !KANA_STOPS.contains(&chars[s - 1]) {
        s -= 1;
    }
    let word: String = chars[s..end].iter().collect();
    let len = end - s;
    // 前の字が助詞か文の頭・ひらがなでない字のときだけ（長いひらがなの文の途中を名前と読まない）
    let bounded = s == 0 || KANA_STOPS.contains(&chars[s - 1]) || !is_hiragana(chars[s - 1]);
    ((2..=5).contains(&len) && bounded && !NOT_NAMES_KANA.contains(&word.as_str())).then_some(s)
}

/// 名前を伏せる（伏せる言葉・敬称の前の名前らしい語）
pub fn mask_names(text: &str, words: &[String]) -> Masked {
    // 1. FP が入れた伏せる言葉（長い順。空白だけ・「（名前）」の一部は使わない）
    let mut list: Vec<String> = words
        .iter()
        .map(|w| w.trim().to_owned())
        .filter(|w| !w.is_empty() && !NAME_MARK.contains(w.as_str()))
        .collect();
    list.sort_by_key(|w| std::cmp::Reverse(w.chars().count()));
    list.dedup();
    let mut s = text.to_owned();
    for w in &list {
        s = s.replace(w.as_str(), NAME_MARK);
    }
    // 2. 敬称の前の名前らしい語
    let chars: Vec<char> = s.chars().collect();
    let mark: Vec<char> = NAME_MARK.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if let Some(hlen) = honorific_at(&chars, i) {
            // 直前がもう「（名前）」なら、そのまま
            let already = out.len() >= mark.len() && out[out.len() - mark.len()..] == mark[..];
            if !already {
                if let Some(start) = name_before(&out, out.len()) {
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
    let spans = spans_of(&out, &mark);
    Masked {
        text: out.into_iter().collect(),
        spans,
    }
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
            if i > 0 && is_hiragana(chars[i - 1]) {
                let mut s = i;
                while s > 0 && i - s < 5 && is_hiragana(chars[s - 1]) {
                    s -= 1;
                }
                let word: String = chars[s..i].iter().collect();
                if i - s >= 2 && !NOT_NAMES_KANA.iter().any(|k| word.ends_with(k)) {
                    hits.push((s, i + hlen));
                }
            }
            i += hlen;
            continue;
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
        assert_eq!(m("娘のさくらちゃん"), "娘の（名前）ちゃん");
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
}
