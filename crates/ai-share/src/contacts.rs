//! メモと面談の記録を AI に渡す前に、連絡先と住所を伏せる（0249 の追記）。書く所に「書かないでください」と出したうえで、入ってしまったときの
//! 守りとして、渡す文（抜き出しも、ほかの欄も）の全文にかけてから上限で切る:
//!
//! - 電話番号らしい数字の並び → 〔電話番号〕（0 か +81 で始まり、数字が10〜11桁〔+81 なら 11〜12桁〕。区切りは「-」「(」「)」と数字の間の空白・長音。
//!   金額〔1,200万円〕・日付〔2026-05-10〕・年齢・郵便番号〔305-0031〕は形が違うので置き換えない）
//! - メールアドレス → 〔メールアドレス〕
//! - 住所らしい部分 → 〔住所〕（都道府県か、市・区・町・村・郡の付く地名に、番地〔1-2-3・3丁目・5番地・12号・北1条西2丁目・町名の後の数字だけの 123〕が
//!   続く形。市・区・町・村・郡が無くても、漢字の町名にじかに 1-2-3・丁目・番地が続く形〔竹園1-2-3〕。間の空白1つはつなぐ。番地の後の建物の名前と
//!   部屋番号〔ヒルズ101号室〕も一緒に。番地の無い地名・部屋番号だけ・数の幅〔2-3戸・3-4千円・3-4LDK〕・日付は置き換えない）
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
        // 前が数字・「,」「.」なら番号の始まりではない。数字に続く「-」「/」「:」の後（空白で並べた日付の2つ目の数字など）も始まりとみない。
        // 英字の後（TEL03-…・FAX029-…）は始まりとみる
        let prev_ok = i == 0
            || !(chars[i - 1].is_ascii_digit()
                || matches!(chars[i - 1], ',' | '.')
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

/// 番地の並び（`house_number` の結果）
struct House {
    /// 終わり
    end: usize,
    /// 数のまとまりの数（1-2-3 なら 3）
    parts: usize,
    /// 丁目・番地・条が付く
    named: bool,
    /// 数字だけ（「竹園123」）
    bare: bool,
    /// 最初の数の桁数
    first_len: usize,
}

/// その位置から番地の並びが始まるなら、その終わりなど（例 1-2-3・3丁目5番地12号・二丁目・4の5・北1条西2丁目・数字だけの 123）
fn house_number(chars: &[char], i: usize) -> Option<House> {
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
    let mut named = false;
    let mut first_len = 0;
    let mut bare = false;
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
        let suffix = ["丁目", "番地", "番", "号室", "号", "条"]
            .iter()
            .find(|s| rest.starts_with(**s))
            .copied();
        match suffix {
            Some(sfx) => {
                any = true;
                named |= matches!(sfx, "丁目" | "番地" | "条");
                k = num_end + sfx.chars().count();
                // 「北1条西2丁目」: 条の後の方角の1字は続き
                let num_next = chars
                    .get(k + 1)
                    .is_some_and(|c| c.is_ascii_digit() || is_kanji_num(*c));
                if sfx == "条"
                    && chars
                        .get(k)
                        .is_some_and(|c| matches!(c, '東' | '西' | '南' | '北'))
                    && num_next
                {
                    k += 1;
                }
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
                    // 数字だけ（1〜4桁）。番地とみるかは、前の地名で決める（`addresses`）
                    if (1..=4).contains(&(num_end - k)) {
                        bare = true;
                        any = true;
                    }
                    k = num_end;
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
    // 数字だけのときは、後ろが漢字・カタカナ・英数字でもない（「竹園123に」は番地、「区分所有3000万」は違う）
    let glued = bare
        && chars.get(k).is_some_and(|c| {
            c.is_ascii_alphanumeric() || is_kanji(*c) || ('\u{30A1}'..='\u{30FA}').contains(c)
        });
    (any && !unit && !glued).then_some(House {
        end: k,
        parts,
        named,
        bare,
        first_len,
    })
}

fn is_kanji(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c) || c == '々'
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

/// 住所の所: 番地の並びの前に、都道府県か、市・区・町・村・郡の付く地名が続くとき、地名の頭から番地の終わりまで。
/// 市・区・町・村・郡が無くても、漢字2〜4字の町名にじかに強い番地（1-2-3 の3つの数・丁目・番地・条）が続くときは伏せる。
/// 番地のすぐ後の建物の名前と部屋番号（「ヒルズ101号室」・「3階」）も一緒に伏せる
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
        let Some(h) = house_number(chars, i) else {
            i += 1;
            continue;
        };
        // 番地のすぐ前の空白（1つ）は飛ばす（「つくば市竹園 1-2-3」。数字だけの番地のときは飛ばさない）
        let mut pe = i;
        if !h.bare && pe >= 2 && space(chars[pe - 1]) && place_char(chars[pe - 2]) {
            pe -= 1;
        }
        // 地名（番地のすぐ前に続く地名の字。30字まで。地名の中の「の」「が」〔丸の内・美しが丘〕は、前後が地名の字なら続ける。
        // 空白は1つまで、前後が地名の字ならはさむ〔つくば市 竹園〕）
        let mut ws = pe;
        let mut spaced = pe < i;
        while ws > 0 && pe - ws < 30 {
            let c = chars[ws - 1];
            let inner = matches!(c, 'の' | 'が') && ws >= 2 && ws < pe && place_char(chars[ws - 2]);
            let gap = !spaced && space(c) && ws >= 2 && ws < pe && place_char(chars[ws - 2]);
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
        let place: String = chars[ws..pe].iter().collect();
        let pref = PREFECTURES
            .iter()
            .filter_map(|p| place.find(p).map(|b| place[..b].chars().count()))
            .min();
        let marker = chars[ws..pe]
            .iter()
            .position(|c| matches!(c, '市' | '区' | '町' | '村' | '郡'));
        // 都道府県が先なら、その頭から。市・区・町・村・郡が先なら、そのすぐ前の同じ種類の字（漢字4字・かな6字まで）を地名の頭とみる
        // （「来月引越し先つくば市」の「来月引越し先」は飲み込まない）
        let start = match (pref, marker) {
            (Some(a), b) if b.is_none_or(|b| a <= b) => Some(ws + a),
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
                // 数字だけの番地は、市・区・町・村・郡の前に地名があり〔「区分所有」の「区」は地名ではない〕、後ろに町名があるときだけ
                let town = pe > m + 1;
                (!h.bare || ((pref.is_some() || st < m) && town)).then_some(st)
            }
            // 市・区・町・村・郡の無い番地: すぐ前の漢字2〜4字（町名）＋強い番地（最初の数は3桁まで）
            _ => {
                let mut st = i;
                while st > 0 && i - st < 4 && (is_kanji(chars[st - 1]) || joiner(chars[st - 1])) {
                    st -= 1;
                }
                let strong = h.parts >= 3 || h.named;
                // 前の番地の続き（「一丁目一番地」の「丁目」）は町名ではない
                let town: String = chars[st..i].iter().collect();
                let after_number = ["丁目", "番地", "番", "号", "条"]
                    .iter()
                    .any(|x| town.ends_with(x));
                (!h.bare && i - st >= 2 && strong && h.first_len <= 3 && !after_number)
                    .then_some(st)
            }
        };
        let Some(start) = start else {
            i += 1;
            continue;
        };
        // 建物の名前と部屋番号（空白1つまで・建物の名前20字まで・数字1〜4桁＋号室・号・室・階）
        let mut end = h.end;
        let mut k = end;
        if k < n && space(chars[k]) {
            k += 1;
        }
        let bs = k;
        while k < n
            && k - bs < 20
            && (place_char(chars[k]) || chars[k].is_ascii_alphabetic() || chars[k] == '・')
        {
            if matches!(
                chars[k],
                'の' | 'は' | 'が' | 'を' | 'に' | 'へ' | 'で' | 'と' | 'も' | 'や'
            ) {
                break;
            }
            k += 1;
        }
        let ds = k;
        while k < n && k - ds < 4 && chars[k].is_ascii_digit() {
            k += 1;
        }
        if k > ds {
            let rest: String = chars[k..n.min(k + 2)].iter().collect();
            if let Some(sfx) = ["号室", "号", "室", "階"]
                .iter()
                .find(|s| rest.starts_with(**s))
            {
                end = k + sfx.chars().count();
            }
        }
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

    /// 5回目の点検の後の判断: 番地が付いているのに残っていた形も伏せる（市区町村の無い番地・途中の空白・数字だけの番地・条・建物と部屋番号）
    #[test]
    fn more_addresses_with_house_numbers_are_masked() {
        for (t, want) in [
            ("自宅は竹園1-2-3", "自宅は〔住所〕"),
            ("吾妻3丁目12-5に住む", "〔住所〕に住む"),
            ("つくば市 竹園1-2-3", "〔住所〕"),
            ("つくば市竹園 1-2-3", "〔住所〕"),
            ("つくば市竹園123", "〔住所〕"),
            ("〇〇町大字山田123に実家", "〔住所〕に実家"),
            ("札幌市中央区北1条西2丁目", "〔住所〕"),
            ("東京都港区六本木1-2-3 ヒルズ101号室", "〔住所〕"),
            ("竹園1-2-3 101号室", "〔住所〕"),
            ("つくば市竹園1-2-3 グランドハイツ3階です", "〔住所〕です"),
            // 部屋番号でない数は、建物の名前とみない
            ("竹園1-2-3 相談料5000円", "〔住所〕 相談料5000円"),
        ] {
            assert_eq!(m(t), want, "{t}");
        }
    }

    /// 点検で「壊れていない」と確かめた例は、そのまま残す（番地の無い地名・数の幅・号室だけ・制度の言葉・金額・日付・郵便番号）
    #[test]
    fn places_without_house_numbers_and_counts_stay() {
        for t in [
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
}
