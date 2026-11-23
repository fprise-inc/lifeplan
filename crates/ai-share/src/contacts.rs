//! メモと面談の記録を AI に渡す前に、連絡先と住所を伏せる（0249 の追記）。書く所に「書かないでください」と出したうえで、入ってしまったときの
//! 守りとして、渡す文（抜き出しも、ほかの欄も）の全文にかけてから上限で切る:
//!
//! - 電話番号らしい数字の並び → 〔電話番号〕（0 か +81 で始まり、数字が10〜11桁〔+81 なら 11〜12桁〕。区切りは「-」「(」「)」と数字の間の空白・長音。
//!   金額〔1,200万円〕・日付〔2026-05-10〕・年齢・郵便番号〔305-0031〕は形が違うので置き換えない）
//! - メールアドレス → 〔メールアドレス〕
//! - 住所らしい部分 → 〔住所〕（都道府県か、市・区・町・村・郡の付く地名に、番地〔1-2-3・3丁目・5番地・12号〕が続く形。番地の無い地名は置き換えない）
//!
//! 文は先に `normalize` で、半角カナを全角に、全角の英数字と記号の一部を半角にそろえてある。

/// 置き換えた所に入れる言葉
pub const PHONE_MARK: &str = "〔電話番号〕";
pub const MAIL_MARK: &str = "〔メールアドレス〕";
pub const ADDRESS_MARK: &str = "〔住所〕";

/// 都道府県
const PREFECTURES: [&str; 47] = [
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
];

/// 半角カナを全角に（濁点・半濁点はまとめる）、全角の英数字と「＠－．＿＋」を半角にそろえる（括弧・コロン・空白はそのまま）
pub fn normalize(text: &str) -> String {
    const KANA: &str = "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン";
    let table: Vec<char> = KANA.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\u{FF61}'..='\u{FF9D}' => out.push(table[(c as u32 - 0xFF61) as usize]),
            // 濁点・半濁点: 前の字と1字にする（できなければ全角の記号）
            '\u{FF9E}' | '\u{FF9F}' => {
                let semi = c == '\u{FF9F}';
                let joined = out.last().and_then(|p| join_mark(*p, semi));
                match joined {
                    Some(j) => {
                        out.pop();
                        out.push(j);
                    }
                    None => out.push(if semi { '゜' } else { '゛' }),
                }
            }
            '０'..='９' | 'Ａ'..='Ｚ' | 'ａ'..='ｚ' | '＠' | '－' | '．' | '＿' | '＋' => {
                out.push(char::from_u32(c as u32 - 0xFEE0).unwrap_or(c))
            }
            _ => out.push(c),
        }
    }
    out.into_iter().collect()
}

fn join_mark(c: char, semi: bool) -> Option<char> {
    let base = "カキクケコサシスセソタチツテトハヒフヘホウ";
    let voiced = "ガギグゲゴザジズゼゾダヂヅデドバビブベボヴ";
    let half = "ハヒフヘホ";
    let semi_v = "パピプペポ";
    if semi {
        half.chars()
            .position(|x| x == c)
            .and_then(|i| semi_v.chars().nth(i))
    } else {
        base.chars()
            .position(|x| x == c)
            .and_then(|i| voiced.chars().nth(i))
    }
}

fn is_dash(c: char) -> bool {
    matches!(c, '-' | '‐' | '−' | '―' | '–' | 'ー')
}

fn replace(out: &mut Vec<char>, chars: &[char], spans: &[(usize, usize, &str)]) {
    let mut i = 0;
    for (s, e, mark) in spans {
        out.extend_from_slice(&chars[i..*s]);
        out.extend(mark.chars());
        i = *e;
    }
    out.extend_from_slice(&chars[i..]);
}

/// メールアドレスの所（始まり・終わり）
fn mails(chars: &[char]) -> Vec<(usize, usize)> {
    let local = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-');
    let domain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-');
    let mut v = Vec::new();
    let mut last = 0;
    for (i, c) in chars.iter().enumerate() {
        if *c != '@' || i < last {
            continue;
        }
        let mut s = i;
        while s > 0 && local(chars[s - 1]) {
            s -= 1;
        }
        let mut e = i + 1;
        while e < chars.len() && domain(chars[e]) {
            e += 1;
        }
        // 終わりの「.」は文の句点として外す
        while e > i + 1 && chars[e - 1] == '.' {
            e -= 1;
        }
        let dom: String = chars[i + 1..e].iter().collect();
        let tld_ok = dom
            .rsplit('.')
            .next()
            .is_some_and(|t| t.len() >= 2 && t.chars().all(|c| c.is_ascii_alphabetic()));
        if s < i && dom.contains('.') && tld_ok {
            v.push((s, e));
            last = e;
        }
    }
    v
}

/// 電話番号の所
fn phones(chars: &[char]) -> Vec<(usize, usize)> {
    let n = chars.len();
    let mut v = Vec::new();
    let mut i = 0;
    while i < n {
        let c = chars[i];
        let starts = c == '0' || c == '+' || (c == '(' && chars.get(i + 1) == Some(&'0'));
        let prev_ok =
            i == 0 || !(chars[i - 1].is_ascii_alphanumeric() || matches!(chars[i - 1], ',' | '.'));
        if !starts || !prev_ok {
            i += 1;
            continue;
        }
        // 数字・区切りの続き（20字まで）
        let mut j = i;
        let mut digits = 0;
        let mut end = i;
        while j < n && j - i < 20 {
            let d = chars[j];
            if d.is_ascii_digit() {
                digits += 1;
                end = j + 1;
            } else {
                // 区切り: 頭の「+」、括弧、数字の間の「-」・空白・長音
                let sep = (d == '+' && j == i)
                    || d == '('
                    || d == ')'
                    || ((is_dash(d) || d == ' ')
                        && j > i
                        && chars
                            .get(j + 1)
                            .is_some_and(|x| x.is_ascii_digit() || *x == '('));
                if !sep {
                    break;
                }
            }
            j += 1;
        }
        let text: String = chars[i..end].iter().collect();
        let intl = text.starts_with("+81");
        let next_ok = chars.get(end).is_none_or(|x| {
            !(x.is_ascii_alphanumeric()
                || matches!(
                    *x,
                    ',' | '.' | '万' | '円' | '年' | '月' | '日' | '歳' | '%'
                ))
        });
        let ok = if intl {
            (11..=12).contains(&digits)
        } else {
            text.trim_start_matches('(').starts_with('0') && (10..=11).contains(&digits)
        };
        if ok && next_ok {
            v.push((i, end));
            i = end;
        } else {
            i += 1;
        }
    }
    v
}

fn is_kanji_num(c: char) -> bool {
    matches!(
        c,
        '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九' | '十' | '〇'
    )
}

/// その位置から番地の並びが始まるなら、その終わり（例 1-2-3・3丁目5番地12号・二丁目・4の5）
fn house_number(chars: &[char], i: usize) -> Option<usize> {
    let n = chars.len();
    let digits_at = |k: usize| -> usize {
        let mut e = k;
        while e < n && e - k < 5 && chars[e].is_ascii_digit() {
            e += 1;
        }
        e
    };
    let mut k = i;
    let mut any = false;
    loop {
        let e = digits_at(k);
        let (num_end, kanji) = if e > k {
            (e, false)
        } else {
            let mut e2 = k;
            while e2 < n && e2 - k < 3 && is_kanji_num(chars[e2]) {
                e2 += 1;
            }
            (e2, true)
        };
        if num_end == k {
            break;
        }
        let rest: String = chars[num_end..n.min(num_end + 3)].iter().collect();
        let suffix = ["丁目", "番地", "番", "号室", "号"]
            .iter()
            .find(|s| rest.starts_with(**s))
            .map(|s| s.chars().count());
        match suffix {
            Some(l) => {
                any = true;
                k = num_end + l;
            }
            None if kanji => break,
            None => {
                // 1-2-3・4の5（続く数字があるときだけ番地とみる）
                let sep = chars.get(num_end).copied();
                let next_digit = chars.get(num_end + 1).is_some_and(|c| c.is_ascii_digit());
                if sep.is_some_and(|s| is_dash(s) || s == 'の') && next_digit {
                    any = true;
                    k = num_end + 1;
                } else if any {
                    k = num_end;
                    break;
                } else {
                    break;
                }
            }
        }
        if k >= n {
            break;
        }
    }
    // 後ろが月・日・年・回・人・歳・円などなら番地ではない（「3-4月」「1-2回」）
    let unit = chars.get(k).is_some_and(|c| {
        matches!(
            c,
            '月' | '日'
                | '年'
                | '回'
                | '人'
                | '歳'
                | '円'
                | '万'
                | '%'
                | '時'
                | '分'
                | '件'
                | '割'
                | '倍'
        )
    });
    (any && !unit).then_some(k)
}

/// 地名に入る字（漢字・カタカナ・助詞でないひらがな・「ヶ」「ノ」）
fn place_char(c: char) -> bool {
    let particle = matches!(
        c,
        'の' | 'は'
            | 'が'
            | 'を'
            | 'に'
            | 'へ'
            | 'で'
            | 'と'
            | 'も'
            | 'や'
            | 'か'
            | 'ね'
            | 'よ'
            | 'て'
            | 'た'
            | 'す'
    );
    (('\u{4E00}'..='\u{9FFF}').contains(&c) || matches!(c, '々' | 'ヶ' | 'ケ' | 'ノ'))
        || ('\u{30A1}'..='\u{30FA}').contains(&c)
        || (('\u{3041}'..='\u{3096}').contains(&c) && !particle)
}

/// 住所の所: 番地の並びの前に、都道府県か、市・区・町・村・郡の付く地名が続くとき、地名の頭から番地の終わりまで
fn addresses(chars: &[char]) -> Vec<(usize, usize)> {
    let n = chars.len();
    let mut v: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < n {
        let starts_num = chars[i].is_ascii_digit() || is_kanji_num(chars[i]);
        let prev_num = i > 0 && (chars[i - 1].is_ascii_digit() || is_kanji_num(chars[i - 1]));
        if !starts_num || prev_num {
            i += 1;
            continue;
        }
        let Some(be) = house_number(chars, i) else {
            i += 1;
            continue;
        };
        // 地名（番地のすぐ前に続く地名の字。30字まで。地名の中の「の」「が」〔丸の内・美しが丘〕は、前後が地名の字なら続ける）
        let mut ws = i;
        while ws > 0 && i - ws < 30 {
            let c = chars[ws - 1];
            let inner = matches!(c, 'の' | 'が') && ws >= 2 && ws < i && place_char(chars[ws - 2]);
            if place_char(c) || inner {
                ws -= 1;
            } else {
                break;
            }
        }
        // 都道府県か、市・区・町・村・郡のいちばん前の所から（その所を含む、助詞をはさまない地名の頭から）
        let place: String = chars[ws..i].iter().collect();
        let pref = PREFECTURES
            .iter()
            .filter_map(|p| place.find(p).map(|b| place[..b].chars().count()))
            .min();
        let marker = chars[ws..i]
            .iter()
            .position(|c| matches!(c, '市' | '区' | '町' | '村' | '郡'));
        let first = match (pref, marker) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let Some(first) = first else {
            i += 1;
            continue;
        };
        let mut start = ws + first;
        while start > ws && place_char(chars[start - 1]) {
            start -= 1;
        }
        v.push((start, be));
        i = be;
    }
    v
}

/// 連絡先と住所を置き換える（メールアドレス → 電話番号 → 住所の順）
pub fn mask_contacts(text: &str) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for (f, mark) in [
        (mails as fn(&[char]) -> Vec<(usize, usize)>, MAIL_MARK),
        (phones, PHONE_MARK),
        (addresses, ADDRESS_MARK),
    ] {
        let spans: Vec<(usize, usize, &str)> =
            f(&chars).into_iter().map(|(s, e)| (s, e, mark)).collect();
        if spans.is_empty() {
            continue;
        }
        let mut out = Vec::with_capacity(chars.len());
        replace(&mut out, &chars, &spans);
        chars = out;
    }
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(t: &str) -> String {
        mask_contacts(&normalize(t))
    }

    #[test]
    fn phones_are_masked() {
        for (t, want) in [
            ("連絡は090-1234-5678まで", "連絡は〔電話番号〕まで"),
            (
                "自宅 03-1234-5678、携帯 09012345678",
                "自宅 〔電話番号〕、携帯 〔電話番号〕",
            ),
            ("(03)1234-5678", "〔電話番号〕"),
            ("0120-123-456へ", "〔電話番号〕へ"),
            ("+81-90-1234-5678", "〔電話番号〕"),
            ("０９０－１２３４－５６７８", "〔電話番号〕"),
            ("090 1234 5678", "〔電話番号〕"),
            ("090ー1234ー5678", "〔電話番号〕"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
    }

    #[test]
    fn money_dates_ages_and_postal_codes_are_not_phones() {
        for t in [
            "1,200万円の住宅ローン",
            "年収800万円",
            "2026-05-10に面談",
            "2026/05/10",
            "45歳と42歳",
            "〒305-0031",
            "305-0031",
            "060-0001",
            "残高0円",
            "金利0.5%",
            "01月02日",
            "12345678901",
            "口座 1234567",
            "0.75%で10年",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    #[test]
    fn mails_are_masked() {
        assert_eq!(
            m("tanaka.taro@example.co.jp に送る"),
            "〔メールアドレス〕 に送る"
        );
        assert_eq!(
            m("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ。"),
            "〔メールアドレス〕。"
        );
        assert_eq!(m("@が付く文"), "@が付く文");
        assert_eq!(m("a@b"), "a@b");
    }

    #[test]
    fn addresses_with_house_numbers_are_masked() {
        for (t, want) in [
            (
                "住まいは茨城県つくば市竹園1-2-3です",
                "住まいは〔住所〕です",
            ),
            ("つくば市竹園二丁目5番地12号に転居", "〔住所〕に転居"),
            ("東京都千代田区丸の内1丁目", "〔住所〕"),
            ("実家は大阪市北区梅田3-1", "実家は〔住所〕"),
            ("横浜市青葉区美しが丘4の5", "〔住所〕"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        // 番地の無い地名・地名でない数字は置き換えない（取りこぼしの側に寄せる。下の決まり）
        for t in [
            "つくば市に住む",
            "茨城県の実家",
            "市の説明会は2026-05-10",
            "大阪市の病院3-4月",
            "マンション101号室",
            "第2号の被保険者",
            "子ども2人",
            "3丁目の角",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    #[test]
    fn half_width_kana_and_full_width_letters_are_normalized() {
        assert_eq!(normalize("ﾀﾅｶ ｶﾞｸ ﾊﾟﾊﾟ"), "タナカ ガク パパ");
        assert_eq!(normalize("ＡＢＣ１２３"), "ABC123");
        assert_eq!(normalize("（名前）：　"), "（名前）：　");
    }
}
