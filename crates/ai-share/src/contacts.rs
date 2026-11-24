//! メモと面談の記録を AI に渡す前に、連絡先と住所を伏せる（0249 の追記）。書く所に「書かないでください」と出したうえで、入ってしまったときの
//! 守りとして、渡す文（抜き出しも、ほかの欄も）の全文にかけてから上限で切る:
//!
//! - 電話番号らしい数字の並び → 〔電話番号〕（0 か +81 で始まり、数字が10〜11桁〔+81 なら 11〜12桁〕。区切りは「-」・括弧（全角も）と数字の間の空白（全角も）・長音。
//!   金額〔1,200万円〕・日付〔2026-05-10〕・年齢・郵便番号〔305-0031〕は形が違うので置き換えない）
//! - メールアドレス → 〔メールアドレス〕
//! - 住所らしい部分 → 〔住所〕（都道府県か、市・区・町・村・郡の付く地名に、番地〔1-2-3・3丁目・5番地・12号〕がじかに続く形だけ。地名の中の空白1つは
//!   つなぐ。番地の無い地名・市・区・町・村・郡の無い番地・数字だけの番地・条・建物の名前と部屋番号・数の幅〔2-3戸・3-4千円・3-4LDK〕・日付は
//!   置き換えない。伏せすぎを避けるため、確実に分かる形だけにする。0249 の 10）
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

/// 範囲を印に置き換える。範囲は前から並んでいる前提だが、前の範囲と重なる範囲は前の範囲にまとめる（落ちないための守り。0249 の6回目の点検）
fn replace(out: &mut Vec<char>, chars: &[char], spans: &[(usize, usize, &str)]) {
    let mut i = 0;
    for (s, e, mark) in spans {
        let (s, e) = ((*s).min(chars.len()), (*e).min(chars.len()));
        if s < i {
            i = i.max(e);
            continue;
        }
        out.extend_from_slice(&chars[i..s]);
        out.extend(mark.chars());
        i = e.max(s);
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
        let open = |x: char| matches!(x, '(' | '（');
        let starts = c == '0' || c == '+' || (open(c) && chars.get(i + 1) == Some(&'0'));
        // 前が数字・「.」なら番号の始まりではない。数字に続く「-」「/」「:」の後（空白で並べた日付の2つ目の数字など）も始まりとみない。
        // 英字の後（TEL03-…・FAX029-…）と「,」の後（番号を「,」で並べた2つ目）は始まりとみる（金額の「,」の後は3桁なので番号にならない）
        let prev_ok = i == 0
            || !(chars[i - 1].is_ascii_digit()
                || chars[i - 1] == '.'
                || ((is_dash(chars[i - 1]) || matches!(chars[i - 1], '/' | ':'))
                    && i >= 2
                    && chars[i - 2].is_ascii_digit()));
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
                // 区切り: 頭の「+」、括弧（全角も）、数字の間の「-」・空白（全角も）・長音
                let sep = (d == '+' && j == i)
                    || matches!(d, '(' | ')' | '（' | '）')
                    || ((is_dash(d) || d == ' ' || d == '\u{3000}')
                        && j > i
                        && chars
                            .get(j + 1)
                            .is_some_and(|x| x.is_ascii_digit() || open(*x)));
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
                || matches!(*x, '.' | '万' | '円' | '年' | '月' | '日' | '歳' | '%'))
        });
        let ok = if intl {
            (11..=12).contains(&digits)
        } else {
            text.trim_start_matches(['(', '（']).starts_with('0') && (10..=11).contains(&digits)
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

/// その位置から番地の並びが始まるなら、その終わり（例 1-2-3・3丁目5番地12号・二丁目・4の5）。
/// 数字だけ（123）・条（69条）は番地と読まない（税・法令・約款の数字を消さないため。0249 の 10）
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
    let mut parts = 0;
    let mut first_len = 0;
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
        if parts == 0 {
            first_len = num_end - k;
        }
        parts += 1;
        let rest: String = chars[num_end..n.min(num_end + 3)].iter().collect();
        let suffix = ["丁目", "番地", "番", "号室", "号"]
            .iter()
            .find(|s| rest.starts_with(**s))
            .copied();
        match suffix {
            Some(sfx) => {
                any = true;
                k = num_end + sfx.chars().count();
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
    // 部屋番号だけ（「305号室」）は番地ではない（番地の後の部屋番号は `addresses` で続けて伏せる）
    let room: String = chars[i..k.min(n)].iter().collect();
    if parts == 1 && room.ends_with("号室") {
        return None;
    }
    // 日付（2026-04-01）は番地ではない
    let head: String = chars[i..i + first_len.min(n - i)].iter().collect();
    if first_len == 4 && parts >= 2 && (head.starts_with("19") || head.starts_with("20")) {
        return None;
    }
    // 後ろが月・日・年・回・人・歳・円・戸・千・社・か所・英字（LDK）などなら番地ではない（「3-4月」「1-2回」「2-3戸」「3-4千円」「3-4LDK」）
    let unit = chars.get(k).is_some_and(|c| {
        c.is_ascii_alphabetic()
            || matches!(
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
                    | '級'
                    | '千'
                    | '百'
                    | '億'
                    | '戸'
                    | '軒'
                    | '棟'
                    | '社'
                    | '店'
                    | '校'
                    | '代'
                    | '名'
                    | '組'
                    | '台'
                    | '本'
                    | '枚'
                    | '点'
                    | '期'
                    | '週'
                    | '箇'
                    | '個'
                    | 'か'
                    | 'ヶ'
                    | 'カ'
                    | 'ケ'
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
    (('\u{4E00}'..='\u{9FFF}').contains(&c) || matches!(c, '々' | 'ヶ' | 'ケ' | 'ノ' | '〇'))
        || ('\u{30A1}'..='\u{30FA}').contains(&c)
        || (('\u{3041}'..='\u{3096}').contains(&c) && !particle)
}

/// 地名の字の種類（0 漢字など・1 ひらがな・2 カタカナ）
fn script(c: char) -> u8 {
    if ('\u{3041}'..='\u{3096}').contains(&c) {
        1
    } else if ('\u{30A1}'..='\u{30FA}').contains(&c) {
        2
    } else {
        0
    }
}

/// 住所の所: 番地の並びのすぐ前に、都道府県か、市・区・町・村・郡の付く地名が続くとき、地名の頭から番地の終わりまで
/// （確実に分かる形だけ。市・区・町・村・郡の無い番地・数字だけの番地・条・建物の名前と部屋番号は伏せない。0249 の 10）
fn addresses(chars: &[char]) -> Vec<(usize, usize)> {
    let n = chars.len();
    let mut v: Vec<(usize, usize)> = Vec::new();
    let space = |c: char| matches!(c, ' ' | '\u{3000}');
    let joiner = |c: char| matches!(c, 'ヶ' | 'ケ' | 'ノ');
    let mut i = 0;
    while i < n {
        let starts_num = chars[i].is_ascii_digit() || is_kanji_num(chars[i]);
        let prev_num = i > 0 && (chars[i - 1].is_ascii_digit() || is_kanji_num(chars[i - 1]));
        if !starts_num || prev_num {
            i += 1;
            continue;
        }
        let Some(end) = house_number(chars, i) else {
            i += 1;
            continue;
        };
        // 地名をさかのぼるのは、直前に見つけた住所の終わりまで（前の住所の中へ戻ると範囲が重なる。0249 の 9）
        let floor = v.last().map_or(0, |r| r.1);
        // 地名（番地のすぐ前に続く地名の字。30字まで。地名の中の「の」「が」〔丸の内・美しが丘〕は、前後が地名の字なら続ける。
        // 地名の中の空白は1つまで、前後が地名の字ならはさむ〔つくば市 竹園〕。番地のすぐ前の空白はつながない）
        let mut ws = i;
        let mut spaced = false;
        while ws > floor && i - ws < 30 {
            let c = chars[ws - 1];
            let inner =
                matches!(c, 'の' | 'が') && ws >= floor + 2 && ws < i && place_char(chars[ws - 2]);
            let gap = !spaced && space(c) && ws >= floor + 2 && ws < i && place_char(chars[ws - 2]);
            if place_char(c) || inner {
                ws -= 1;
            } else if gap {
                spaced = true;
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
        let is_marker = |c: char| matches!(c, '市' | '区' | '町' | '村' | '郡');
        let mut marker = chars[ws..i].iter().position(|c| is_marker(*c));
        // 市区町村の後の町名に、助詞と同じ字を含むかなが入る住所（「牛久市ひたち野東5-3-2」の「た」）: 上の地名の字では「た」で止まるので、
        // 番地のすぐ前から10字まで、かな・漢字の続きをさかのぼって市区町村を探す。町名の頭と終わりが助詞の字なら住所と読まない
        // （「市の説明会」「市役所で」。終わりの「の」は3字からの町名なら町名の字〔みどりの〕）
        if pref.is_none() && marker.is_none() {
            let town_char = |c: char| {
                ('\u{4E00}'..='\u{9FFF}').contains(&c)
                    || ('\u{3041}'..='\u{3096}').contains(&c)
                    || ('\u{30A1}'..='\u{30FA}').contains(&c)
                    || matches!(c, '々' | 'ー')
            };
            let particle = |c: char| {
                matches!(
                    c,
                    'の' | 'は' | 'が' | 'を' | 'に' | 'へ' | 'で' | 'と' | 'も' | 'や'
                )
            };
            let mut k = i;
            while k > floor + 1 && i - k < 10 && town_char(chars[k - 1]) && !is_marker(chars[k - 1])
            {
                k -= 1;
            }
            // 町名の終わりの「の」は、3字からの町名なら町名の字とみる（「みどりの」）
            let end_ok = i > 0 && (!particle(chars[i - 1]) || (chars[i - 1] == 'の' && i - k >= 3));
            if k > floor && k < i && is_marker(chars[k - 1]) && !particle(chars[k]) && end_ok {
                // 市区町村の前の地名（同じ種類の字）から
                let mut w = k - 1;
                while w > floor && i - w < 30 && place_char(chars[w - 1]) {
                    w -= 1;
                }
                ws = w;
                marker = Some(k - 1 - ws);
            }
        }
        // 都道府県が先なら、その頭から。市・区・町・村・郡が先なら、そのすぐ前の同じ種類の字（漢字4字・かな6字まで）を地名の頭とみる
        // （「来月引越し先つくば市」の「来月引越し先」は飲み込まない）
        let start = match (pref, marker) {
            (Some(a), b) if b.is_none_or(|b| a <= b) => ws + a,
            (_, Some(b)) => {
                let m = ws + b;
                let mut st = m;
                // 「ヶ」「ケ」「ノ」（鎌ケ谷・霞ヶ浦・一ノ関）は、どの種類の字にもつなぐ
                let kind = chars[ws..m]
                    .iter()
                    .rev()
                    .find(|c| !joiner(**c))
                    .map(|c| script(*c));
                if let Some(kind) = kind {
                    let max = if kind == 0 { 4 } else { 6 };
                    while st > ws
                        && m - st < max
                        && (joiner(chars[st - 1]) || script(chars[st - 1]) == kind)
                    {
                        st -= 1;
                    }
                }
                st
            }
            _ => {
                i += 1;
                continue;
            }
        };
        v.push((start, end));
        i = end;
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

    /// 5回目の点検: 英字にじかに続く番号も伏せる。空白で並べた日付は番号と読まない
    #[test]
    fn phones_right_after_letters_are_masked_and_dates_in_a_row_are_not() {
        for (t, want) in [
            ("TEL03-1234-5678", "TEL〔電話番号〕"),
            ("tel03-1234-5678", "tel〔電話番号〕"),
            ("FAX029-123-4567", "FAX〔電話番号〕"),
            ("携帯090-1234-5678", "携帯〔電話番号〕"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        for t in [
            "2026-05-10 2027-05",
            "期間 2026-04-01 2026-10",
            "2026/04/01 09:30-10:30",
            "ABC1234567890",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    /// 5回目の点検: 地名の字を含む言葉の後ろの「数字-数字」（戸・千円・LDK・箇所・社）は住所と読まない。住所の前の言葉は飲み込まない
    #[test]
    fn counts_after_place_like_words_are_not_addresses() {
        for t in [
            "区分マンション2-3戸",
            "町内会費3-4千円",
            "学区内3-4LDK",
            "郡部2-3箇所",
            "町の不動産屋2-3社",
            "市内の30-40代",
            "2-3か所",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
        for (t, want) in [
            ("来月引越し先つくば市竹園1-2-3", "来月引越し先〔住所〕"),
            (
                "相続税評価額つくば市吾妻3丁目の土地",
                "相続税評価額〔住所〕の土地",
            ),
            ("実家茨城県つくば市竹園1-2-3", "実家〔住所〕"),
            ("鎌ケ谷市道野辺1-2-3", "〔住所〕"),
            // 字の種類が混ざる地名は、頭が残ることがある（番地まで伏せるので、市の名前の一部が残るだけ）
            ("南アルプス市小笠原1-2", "南〔住所〕"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
    }

    /// 0249 の 10: 伏せるのは、都道府県か市・区・町・村・郡から番地まで続く住所だけ（空白1つは地名の中だけつなぐ）
    #[test]
    fn only_addresses_from_a_city_to_a_house_number_are_masked() {
        for (t, want) in [
            (
                "住まいは茨城県つくば市竹園1-2-3です",
                "住まいは〔住所〕です",
            ),
            ("つくば市 竹園1-2-3", "〔住所〕"),
            ("港区六本木1-2-3 ヒルズ101号室", "〔住所〕 ヒルズ101号室"),
            // 建物の名前と部屋番号は残す（不動産を持つ人のメモで要る）
            ("土浦市中央一丁目メゾン101", "〔住所〕メゾン101"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
    }

    /// 市区町村の後の町名・市区町村の名前にかな（助詞と同じ字も）が入る住所も伏せる（ひたち野東・みどりの・つくばみらい市）。市区町村のすぐ後が助詞の文は住所と読まない
    #[test]
    fn town_names_with_kana_after_a_city_are_masked() {
        for (t, want) in [
            ("牛久市ひたち野東5-3-2", "〔住所〕"),
            ("つくば市みどりの東1-2-3", "〔住所〕"),
            ("つくばみらい市紫峰ヶ丘1-2-3", "〔住所〕"),
            ("つくば市みどりの1-2-3", "〔住所〕"),
            ("実家は牛久市ひたち野東5-3-2です", "実家は〔住所〕です"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        for t in [
            "市の説明会は2026-05-10",
            "大阪市の病院3-4月",
            "横浜市に住んで3-4年",
            "市役所で1-2-3",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    /// 0249 の 10: 伏せすぎを避けるため、次の形は伏せない（市・区・町・村・郡の無い番地・数字だけの番地・条・建物の名前と部屋番号・
    /// 番地のすぐ前の空白）。6回目の点検の中1の例（税・法令・約款・配分の数字）がそのまま残る
    #[test]
    fn numbers_in_practical_notes_are_not_addresses() {
        for t in [
            "固定資産税15、都市計画税3",
            "年間の都市計画税12、固定資産税15（万円）",
            "都市計画税12",
            "自治会町内会費500",
            "年間市県民税30、所得税20",
            "地方都市部の家賃相場8",
            "世帯年収区分4",
            "借入条件3条を見直す",
            "措置法69条の4の特例を使う",
            "民法909条の2で預金の仮払い",
            "相続税法21条の9（相続時精算課税）",
            "約款第12条により免責",
            "定款第3条を変更",
            "借地借家法38条の定期借家契約",
            "所得税法第9条の非課税所得",
            "会社法第2条の公開会社",
            "区分所有法3条の団体",
            "三区分の資産配分 4-4-2",
            "資産配分6-3-1を提案",
            "平成30-4-1に契約",
            "号棟1-2-3の比較",
            "竹園1-2-3",
            "つくば市竹園123",
            "つくば市竹園 1-2-3",
            "グランドハイツ203",
            "つくば市在住",
            "茨城県の実家",
            "港区のタワーマンション",
            "世田谷区成城",
            "茨城県つくば市",
            "〒305-0031",
            "市民税10-12万円",
            "市場価格1-2割",
            "3-4月",
            "第3号被保険者",
            "第2号の被保険者",
            "305号室",
            "マンション101号室",
            "港区のマンション 305号室",
            "区分マンション2-3戸",
            "町内会費3-4千円",
            "学区内3-4LDK",
            "2-3戸",
            "3-4千円",
            "3-4LDK",
            "1,200万円",
            "2026-05-10",
            "期間2026-04-01から",
            "区役所2026-04-01",
            "2026/5/10",
            "09:30-10:30",
            "0.475%",
            "45歳",
            "3丁目の角",
            "政策の一丁目一番地",
            "年金は月15万円",
            "要介護3",
            "等級1-2-3級",
            "国民年金の第1号",
            "市内で3-4LDKを探す",
            "市場価格1-2割下落",
            "住民税（市県民税）5-6月",
            "都市ガス1-2万円",
            "第1号被保険者",
            "国民年金第3号",
            "二丁目",
            "児童手当3-4年分",
            "区分所有1-2件",
            "小規模宅地等の特例330",
            "北区在住3-4年",
            "市の補助金5-10万円",
            "横浜市の待機児童1-2歳",
            "郡山市",
            "郡部2-3箇所",
            "町の不動産屋2-3社",
            "つくば市内3-4LDK",
            "2026-04-01から2027-03-31",
            "住宅ローン 0.475% 35年 4,500万円",
            "2026/04/01 09:30-10:30",
            "2026-05-10 2027-05",
        ] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    /// 6回目の点検: 2つ目の住所の地名をさかのぼるとき、前の住所の中まで戻って範囲が重なり、置き換えで落ちていた
    #[test]
    fn overlapping_addresses_do_not_panic() {
        for t in [
            "京都市下京区四条通烏丸東入ル長刀鉾町20",
            "土浦市中央一丁目メゾン101",
            "港区六本木六丁目ヒルズ1001",
            "中京区二条通280",
            "京都市中京区烏丸通二条上る蒔絵屋町280",
            "京都市中京区三条通河原町東入ル中島町100",
            "中央区日本橋三丁目ビル8",
            "竹園村12番地郡くん3",
            "つくば市竹園1-2-3つくば市吾妻2-1-1",
        ] {
            let _ = m(t);
        }
        assert_eq!(m("つくば市竹園1-2-3つくば市吾妻2-1-1"), "〔住所〕〔住所〕");
    }

    /// 0249 の 10: 全角の括弧・「,」で並べた番号・全角の空白の区切りも、電話番号として伏せる（金額の「,」は番号にならない）
    #[test]
    fn phones_with_full_width_marks_and_commas_are_masked() {
        for (t, want) in [
            ("（03）1234-5678", "〔電話番号〕"),
            ("03（1234）5678", "〔電話番号〕"),
            ("080-1234-5678,090-1234-5678", "〔電話番号〕,〔電話番号〕"),
            ("090\u{3000}1234\u{3000}5678", "〔電話番号〕"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
        for t in ["1,200,000円", "12,000,000", "残高 03,500,000 円", "1,0123"] {
            assert_eq!(m(t), normalize(t), "{t}");
        }
    }

    /// 置き換えの範囲が重なっても落ちず、前の範囲にまとめる（守り）
    #[test]
    fn overlapping_spans_are_merged_when_replacing() {
        let chars: Vec<char> = "あいうえおかき".chars().collect();
        let mut out = Vec::new();
        replace(
            &mut out,
            &chars,
            &[(1, 3, "〔A〕"), (2, 5, "〔B〕"), (6, 99, "〔C〕")],
        );
        assert_eq!(out.into_iter().collect::<String>(), "あ〔A〕か〔C〕");
    }

    /// 6回目の点検: 決まった種から作る文（住所・番号・名前に使う字を並べたもの）で、伏せる処理が落ちない（性質のテスト）
    #[test]
    fn masking_never_panics_on_generated_text() {
        let parts: &[&str] = &[
            "0",
            "1",
            "2",
            "3",
            "12",
            "123",
            "1234",
            "一",
            "二",
            "三",
            "十",
            "〇",
            "丁目",
            "番地",
            "番",
            "号",
            "号室",
            "条",
            "階",
            "室",
            "市",
            "区",
            "町",
            "村",
            "郡",
            "東京都",
            "北海道",
            "つくば",
            "竹園",
            "中央",
            "本町",
            "ヒルズ",
            "コーポ",
            "メゾン",
            "A",
            "b",
            " ",
            "\u{3000}",
            "-",
            "ー",
            "の",
            "が",
            "に",
            "は",
            "、",
            "。",
            "\n",
            "(",
            ")",
            "+",
            "+81",
            "090",
            "03",
            "@",
            ".",
            "jp",
            "com",
            "さん",
            "様",
            "氏",
            "君",
            "殿",
            "先生",
            "ちゃん",
            "くん",
            "さま",
            "田中",
            "みどり",
            "タナカ",
            "お",
            "ご",
            "万円",
            "月",
            "歳",
            "西",
            "北",
            "通",
            "上る",
            "ヶ",
            "ノ",
            "（名前）",
            "〔住所〕",
            "〔電話番号〕",
            "決めたこと: ",
            "次までにやること: ",
            "𠮷",
            "ﾀﾞ",
            "ﾟ",
            "（",
            "）",
            "：",
            "様子",
            "さんま",
        ];
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let words = vec!["田中".to_owned(), "1".to_owned()];
        for n in 0..100_000u64 {
            let len = (next() % 12 + 1) as usize;
            let s: String = (0..len)
                .map(|_| parts[(next() % parts.len() as u64) as usize])
                .collect();
            let w: &[String] = if n % 4 == 0 { &words } else { &[] };
            let r = crate::names::mask_names(&s, w);
            assert!(
                r.spans
                    .iter()
                    .all(|(a, b)| a < b && *b <= r.text.chars().count()),
                "{s:?}"
            );
            let _ = crate::names::suspects(&r.text);
            let _ = crate::names::mask_and_cut(&s, w, &[("決めたこと: ", 6)], 8);
        }
    }
}
