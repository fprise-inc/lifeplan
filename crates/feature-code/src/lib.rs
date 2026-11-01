//! 機能を有効にするコード（0110）。
//!
//! - 提供元がコードを発行する。コードの中身（[`Claims`]）は、機能の名前（複数可）・FP の表示名・発行日・期限・コードの番号と、
//!   署名した鍵の名前。提供元の秘密鍵で Ed25519 の署名を付ける。
//! - アプリは公開鍵（配布元の設定 `config/distribution.toml` の `[keys]` の `feature_code`）を埋め込み、ネットにつながずに
//!   本物か（[`verify`]）・期限内か（[`status`]）を確かめる。期限は日本の日付（UTC+9）で、期限の日の終わりまで使える。
//! - 期限で止める（途中でやめた人を止める方法は期限だけ。ネットで確かめない）。期限の長さは発行のときに決め、アプリは決めない。
//! - 形: `LPFC1-` ＋ 中身の JSON（base64url）＋ `.` ＋ 署名（base64url）。署名するのは「決まった前置き＋中身の JSON のバイト列」。
//!   写すときに入った空白・改行は無視する（[`normalize`]）。
//!
//! この部品は鍵・コードをログやエラーの文に入れない。アプリ本体が使うのは確かめる側（[`verify`]・[`status`]・[`add`]・[`remove`]）だけで、
//! 発行する側（[`SecretKey`]・[`issue`]・[`issuer`]）は提供元の道具（`src/bin/feature-code.rs`）が使う。

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub mod issuer;

/// コードの最初の印（形の版 1）
pub const PREFIX: &str = "LPFC1-";
/// 署名する前置き（ほかの用途の署名と取り違えないため）
const CONTEXT: &[u8] = b"lifeplan-feature-code/1\0";
/// 中身の形の版
pub const CLAIMS_VERSION: u32 = 1;

/// 期限の何日前から更新の知らせを出すか
pub const RENEW_NOTICE_DAYS: i64 = 30;
/// アプリに入れておけるコードの数の上限
pub const MAX_CODES: usize = 16;
/// コード1つの長さの上限（文字）
pub const MAX_CODE_LEN: usize = 2048;
/// 表示名の長さの上限（文字）
pub const MAX_NAME_CHARS: usize = 40;
/// 1つのコードに入れられる機能の数の上限
pub const MAX_FEATURES: usize = 16;

/// コードで有効にできる機能（この版のアプリが知っているもの）
pub struct Feature {
    /// 機能の名前（コードに入る）
    pub id: &'static str,
    /// 発行の道具と画面に出す名前
    pub label: &'static str,
}

pub const FEATURES: &[Feature] = &[Feature {
    id: "combinedBs",
    label: "合算BS（経営者個人と会社のバランスシート）",
}];

pub fn is_known_feature(id: &str) -> bool {
    FEATURES.iter().any(|f| f.id == id)
}

/// 失敗の符号（画面はこの符号から文を出す。鍵・コードの中身は入れない）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Error(&'static str);

impl Error {
    /// 形が違う（写し間違い・途中で切れている）
    pub const FORMAT: Error = Error("E_FEATURE_CODE_FORMAT");
    /// この版のアプリが持っていない鍵で署名されている
    pub const KEY: Error = Error("E_FEATURE_CODE_KEY");
    /// 署名が合わない（中身を書き換えた・本物ではない）
    pub const SIGNATURE: Error = Error("E_FEATURE_CODE_SIGNATURE");
    /// 期限が切れている（入れるとき）
    pub const EXPIRED: Error = Error("E_FEATURE_CODE_EXPIRED");
    /// この版のアプリで使える機能が入っていない
    pub const NO_FEATURE: Error = Error("E_FEATURE_CODE_NO_FEATURE");
    /// 入れておけるコードの数を超える
    pub const LIMIT: Error = Error("E_FEATURE_CODE_LIMIT");
    /// 外すコードが見つからない
    pub const NOT_FOUND: Error = Error("E_FEATURE_CODE_NOT_FOUND");

    pub fn code(&self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for Error {}

/// コードの中身（署名の対象）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claims {
    /// 中身の形の版（1）
    pub v: u32,
    /// 署名した鍵の名前（公開鍵を選ぶ）
    pub kid: String,
    /// コードの番号（発行の記録と突き合わせる）
    pub id: String,
    /// FP の表示名（画面に「○○さん向けに有効」と出る）
    pub name: String,
    /// 有効にする機能の名前
    pub features: Vec<String>,
    /// 発行日（YYYY-MM-DD）
    pub issued: String,
    /// 期限（YYYY-MM-DD。この日の終わりまで。日本の日付）
    pub expires: String,
}

/// 発行の入力
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub id: String,
    pub name: String,
    pub features: Vec<String>,
    pub issued: String,
    pub expires: String,
}

// ---- 日付（日本の日付。UTC+9 の固定。夏時間は無い）----

const JST_SECS: i64 = 9 * 3600;

/// 年月日 → 1970-01-01 からの日数（Howard Hinnant の方法）
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 1970-01-01 からの日数 → 年月日
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 「YYYY-MM-DD」を日数に（無い日付・形の違うものは None）
pub fn parse_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !s
        .bytes()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: u32 = s[5..7].parse().ok()?;
    let d: u32 = s[8..10].parse().ok()?;
    if !(2000..=2999).contains(&y) || !(1..=12).contains(&m) || d == 0 {
        return None;
    }
    let days = days_from_civil(y, m, d);
    (civil_from_days(days) == (y, m, d)).then_some(days)
}

pub fn date_of_days(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// UNIX 時刻（秒）の日本の日付
pub fn today_jst(unix_secs: i64) -> String {
    date_of_days((unix_secs + JST_SECS).div_euclid(86_400))
}

/// 今の日本の日付（PC の時計）
pub fn today_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX / 2))
        .unwrap_or(0);
    today_jst(secs)
}

// ---- 中身の確かめ（発行と確かめで同じ）----

fn valid_kid(s: &str) -> bool {
    (1..=16).contains(&s.len())
        && s.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// コードの番号: 英数字で始まり、英数字と「-」「_」「.」の32文字まで
pub fn valid_id(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=32).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn valid_feature_name(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=32).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b.iter().all(|c| c.is_ascii_alphanumeric())
}

/// 表示名の形の問題（無ければ None）。発行の記録の CSV を表計算で開いたときに式として読まれないよう、最初の文字に = + - @ を使わない
pub fn name_problem(s: &str) -> Option<&'static str> {
    if s.trim() != s || s.is_empty() {
        return Some("名前が空か、前後に空白があります");
    }
    if s.chars().count() > MAX_NAME_CHARS {
        return Some("名前が長すぎます（40文字まで）");
    }
    if s.chars().any(char::is_control) {
        return Some("名前に改行などの制御文字は使えません");
    }
    if s.starts_with(['=', '+', '-', '@']) {
        return Some("名前の最初の文字に = + - @ は使えません");
    }
    None
}

fn claims_problem(c: &Claims) -> Option<String> {
    if c.v != CLAIMS_VERSION {
        return Some("中身の形の版が違います".into());
    }
    if !valid_kid(&c.kid) {
        return Some("鍵の名前は英小文字・数字・「-」の16文字までです".into());
    }
    if !valid_id(&c.id) {
        return Some(
            "番号は英数字で始め、英数字と「-」「_」「.」の32文字までにしてください".into(),
        );
    }
    if let Some(p) = name_problem(&c.name) {
        return Some(p.into());
    }
    if c.features.is_empty() || c.features.len() > MAX_FEATURES {
        return Some("機能を1つ以上（16まで）入れてください".into());
    }
    for (i, f) in c.features.iter().enumerate() {
        if !valid_feature_name(f) || c.features[..i].contains(f) {
            return Some(format!("機能の名前「{f}」が正しくないか、重なっています"));
        }
    }
    let (Some(issued), Some(expires)) = (parse_date(&c.issued), parse_date(&c.expires)) else {
        return Some("発行日と期限は YYYY-MM-DD の形の、ある日付にしてください".into());
    };
    if expires < issued {
        return Some("期限が発行日より前です".into());
    }
    None
}

// ---- 鍵 ----

/// 公開鍵（鍵の名前つき）
#[derive(Clone)]
pub struct PublicKey {
    pub kid: String,
    key: VerifyingKey,
}

impl PublicKey {
    /// 「鍵の名前:公開鍵（32バイトの base64url）」の1行から
    pub fn parse(line: &str) -> Result<PublicKey, Error> {
        let (kid, b64) = line.trim().split_once(':').ok_or(Error::FORMAT)?;
        if !valid_kid(kid) {
            return Err(Error::FORMAT);
        }
        let bytes = B64.decode(b64).map_err(|_| Error::FORMAT)?;
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| Error::FORMAT)?;
        let key = VerifyingKey::from_bytes(&bytes).map_err(|_| Error::FORMAT)?;
        Ok(PublicKey {
            kid: kid.to_owned(),
            key,
        })
    }

    pub fn line(&self) -> String {
        format!("{}:{}", self.kid, B64.encode(self.key.as_bytes()))
    }
}

/// 公開鍵の一覧（配布元の設定の行）を読む。読めない行があれば誤り
pub fn parse_public_keys(lines: &[&str]) -> Result<Vec<PublicKey>, Error> {
    lines.iter().map(|l| PublicKey::parse(l)).collect()
}

/// 提供元の秘密鍵（発行の道具だけが使う。落とすときに消す）
pub struct SecretKey {
    pub kid: String,
    signing: SigningKey,
}

/// 中身（秘密鍵）は出さない
impl std::fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretKey({})", self.kid)
    }
}

const SECRET_HEADER: &str = "# lifeplan feature-code secret key";

impl SecretKey {
    /// 新しく作る（種は OS の乱数）
    pub fn generate(kid: &str) -> Result<SecretKey, String> {
        if !valid_kid(kid) {
            return Err("鍵の名前は英小文字・数字・「-」の16文字までです".into());
        }
        let mut seed = Zeroizing::new([0u8; 32]);
        getrandom::getrandom(seed.as_mut()).map_err(|_| "乱数を作れませんでした".to_owned())?;
        Ok(SecretKey {
            kid: kid.to_owned(),
            signing: SigningKey::from_bytes(&seed),
        })
    }

    pub fn public(&self) -> PublicKey {
        PublicKey {
            kid: self.kid.clone(),
            key: self.signing.verifying_key(),
        }
    }

    /// ファイルに書く形（人に渡さない・リポジトリに入れない）
    pub fn to_text(&self) -> Zeroizing<String> {
        Zeroizing::new(format!(
            "{SECRET_HEADER}（人に渡さない・リポジトリに入れない）\nkid = {}\nsecret = {}\npublic = {}\n",
            self.kid,
            Zeroizing::new(B64.encode(self.signing.to_bytes())).as_str(),
            self.public().line()
        ))
    }

    pub fn from_text(text: &str) -> Result<SecretKey, String> {
        let bad = || "秘密鍵のファイルの形が違います".to_owned();
        if !text.starts_with(SECRET_HEADER) {
            return Err(bad());
        }
        let mut kid = None;
        let mut secret = None;
        let mut public = None;
        for line in text.lines().skip(1) {
            let Some((k, v)) = line.split_once('=') else {
                continue;
            };
            match k.trim() {
                "kid" => kid = Some(v.trim().to_owned()),
                "secret" => secret = Some(Zeroizing::new(v.trim().to_owned())),
                "public" => public = Some(v.trim().to_owned()),
                _ => {}
            }
        }
        let (Some(kid), Some(secret)) = (kid, secret) else {
            return Err(bad());
        };
        if !valid_kid(&kid) {
            return Err(bad());
        }
        let bytes = Zeroizing::new(B64.decode(secret.as_bytes()).map_err(|_| bad())?);
        let seed: [u8; 32] = bytes.as_slice().try_into().map_err(|_| bad())?;
        let seed = Zeroizing::new(seed);
        let key = SecretKey {
            kid,
            signing: SigningKey::from_bytes(&seed),
        };
        // 公開鍵の行があれば、秘密鍵と合っているかを確かめる（書き換え・取り違えの検出）
        if let Some(p) = public {
            if p != key.public().line() {
                return Err("秘密鍵のファイルの公開鍵の行が、秘密鍵と合いません".into());
            }
        }
        Ok(key)
    }
}

fn signed_bytes(payload: &[u8]) -> Vec<u8> {
    let mut m = Vec::with_capacity(CONTEXT.len() + payload.len());
    m.extend_from_slice(CONTEXT);
    m.extend_from_slice(payload);
    m
}

/// コードを発行する（入力の誤りは日本語の文で返す）
pub fn issue(key: &SecretKey, req: &Request) -> Result<String, String> {
    let claims = Claims {
        v: CLAIMS_VERSION,
        kid: key.kid.clone(),
        id: req.id.clone(),
        name: req.name.clone(),
        features: req.features.clone(),
        issued: req.issued.clone(),
        expires: req.expires.clone(),
    };
    if let Some(p) = claims_problem(&claims) {
        return Err(p);
    }
    if let Some(f) = claims.features.iter().find(|f| !is_known_feature(f)) {
        let known: Vec<&str> = FEATURES.iter().map(|f| f.id).collect();
        return Err(format!(
            "機能「{f}」はありません（使える名前: {}）",
            known.join("・")
        ));
    }
    let payload = serde_json::to_vec(&claims).map_err(|_| "中身を作れませんでした".to_owned())?;
    let sig: Signature = key.signing.sign(&signed_bytes(&payload));
    Ok(format!(
        "{PREFIX}{}.{}",
        B64.encode(&payload),
        B64.encode(sig.to_bytes())
    ))
}

/// 写すときに入った空白・改行を外す
pub fn normalize(code: &str) -> String {
    code.chars().filter(|c| !c.is_whitespace()).collect()
}

fn split(code: &str) -> Result<(Vec<u8>, [u8; 64]), Error> {
    let body = code.strip_prefix(PREFIX).ok_or(Error::FORMAT)?;
    let (p, s) = body.split_once('.').ok_or(Error::FORMAT)?;
    let payload = B64.decode(p).map_err(|_| Error::FORMAT)?;
    let sig: [u8; 64] = B64
        .decode(s)
        .map_err(|_| Error::FORMAT)?
        .try_into()
        .map_err(|_| Error::FORMAT)?;
    Ok((payload, sig))
}

fn claims_of(payload: &[u8]) -> Result<Claims, Error> {
    let c: Claims = serde_json::from_slice(payload).map_err(|_| Error::FORMAT)?;
    if claims_problem(&c).is_some() {
        return Err(Error::FORMAT);
    }
    Ok(c)
}

/// 本物か（署名と中身の形）を確かめて中身を返す。期限はここでは見ない（[`status`]・[`add`]）
pub fn verify(code: &str, keys: &[PublicKey]) -> Result<Claims, Error> {
    let code = normalize(code);
    if code.len() > MAX_CODE_LEN {
        return Err(Error::FORMAT);
    }
    let (payload, sig) = split(&code)?;
    // 鍵の名前だけ先に読む（署名を確かめる前の中身は、鍵を選ぶこと以外に使わない）
    #[derive(Deserialize)]
    struct Kid {
        kid: String,
    }
    let kid: Kid = serde_json::from_slice(&payload).map_err(|_| Error::FORMAT)?;
    let key = keys.iter().find(|k| k.kid == kid.kid).ok_or(Error::KEY)?;
    key.key
        .verify(&signed_bytes(&payload), &Signature::from_bytes(&sig))
        .map_err(|_| Error::SIGNATURE)?;
    claims_of(&payload)
}

/// 署名を確かめずに中身を読む（発行の道具が記録に写すとき・中身を見るときだけ。アプリは使わない）
pub fn decode_unverified(code: &str) -> Result<Claims, Error> {
    let code = normalize(code);
    let (payload, _) = split(&code)?;
    claims_of(&payload)
}

/// コードを指す短い印（画面が外すときに使う。コードそのものは画面に返さない）
pub fn reference(code: &str) -> String {
    let h = Sha256::digest(normalize(code).as_bytes());
    h.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

// ---- アプリに入れたコードの状態 ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeState {
    /// 期限内
    Active,
    /// 期限内で、期限まで30日以内（更新の知らせを出す）
    Expiring,
    /// 期限が切れた（機能は出さない。データは消さない）
    Expired,
}

/// 入れたコード1つ（確かめた中身。この版のアプリが知っている機能だけ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeView {
    #[serde(rename = "ref")]
    pub reference: String,
    pub id: String,
    pub name: String,
    pub features: Vec<String>,
    pub issued: String,
    pub expires: String,
    pub state: CodeState,
    /// 期限までの日数（期限の日は 0。切れたら負）
    pub days_left: i64,
}

/// 確かめられなかったコード（鍵を差し替えた後の古いコードなど。外せるように印と符号だけ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidView {
    #[serde(rename = "ref")]
    pub reference: String,
    pub error: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// 判定に使った今日（日本の日付）
    pub today: String,
    /// 今使える機能（期限内のコードのどれかに入っている、この版のアプリが知っている機能。[`FEATURES`] の順）
    pub active: Vec<String>,
    /// 入れたコード（期限の遅い順）
    pub codes: Vec<CodeView>,
    pub invalid: Vec<InvalidView>,
}

fn view_of(code: &str, keys: &[PublicKey], today: i64) -> Result<CodeView, Error> {
    let c = verify(code, keys)?;
    let features: Vec<String> = c
        .features
        .iter()
        .filter(|f| is_known_feature(f))
        .cloned()
        .collect();
    if features.is_empty() {
        return Err(Error::NO_FEATURE);
    }
    let expires = parse_date(&c.expires).ok_or(Error::FORMAT)?;
    let days_left = expires - today;
    let state = if days_left < 0 {
        CodeState::Expired
    } else if days_left <= RENEW_NOTICE_DAYS {
        CodeState::Expiring
    } else {
        CodeState::Active
    };
    Ok(CodeView {
        reference: reference(code),
        id: c.id,
        name: c.name,
        features,
        issued: c.issued,
        expires: c.expires,
        state,
        days_left,
    })
}

/// 入れたコードの状態（today は日本の日付 YYYY-MM-DD）
pub fn status(codes: &[String], keys: &[PublicKey], today: &str) -> Status {
    let t = parse_date(today).unwrap_or(0);
    let mut views = vec![];
    let mut invalid = vec![];
    for code in codes {
        match view_of(code, keys, t) {
            Ok(v) => views.push(v),
            Err(e) => invalid.push(InvalidView {
                reference: reference(code),
                error: e.code(),
            }),
        }
    }
    views.sort_by(|a, b| b.expires.cmp(&a.expires).then(a.id.cmp(&b.id)));
    let active = FEATURES
        .iter()
        .map(|f| f.id)
        .filter(|f| {
            views
                .iter()
                .any(|v| v.state != CodeState::Expired && v.features.iter().any(|x| x == f))
        })
        .map(str::to_owned)
        .collect();
    Status {
        today: today.to_owned(),
        active,
        codes: views,
        invalid,
    }
}

/// コードを足した一覧を返す。本物で、この版で使える機能が入っていて、期限内のものだけ受ける。
/// 同じコードは足さない。新しいコードが同じ機能を同じか遅い期限まで含む古いコード（更新の前のコード）は外す
pub fn add(
    codes: &[String],
    new: &str,
    keys: &[PublicKey],
    today: &str,
) -> Result<Vec<String>, Error> {
    let t = parse_date(today).unwrap_or(0);
    let n = normalize(new);
    let v = view_of(&n, keys, t)?;
    if v.state == CodeState::Expired {
        return Err(Error::EXPIRED);
    }
    let mut next: Vec<String> = codes
        .iter()
        .filter(|c| normalize(c) != n)
        .filter(|c| match view_of(c, keys, t) {
            Ok(old) => {
                !(old.expires <= v.expires && old.features.iter().all(|f| v.features.contains(f)))
            }
            Err(_) => true,
        })
        .cloned()
        .collect();
    next.push(n);
    if next.len() > MAX_CODES {
        return Err(Error::LIMIT);
    }
    Ok(next)
}

/// 印（[`reference`]）で指したコードを外した一覧
pub fn remove(codes: &[String], reference_: &str) -> Result<Vec<String>, Error> {
    let next: Vec<String> = codes
        .iter()
        .filter(|c| reference(c) != reference_)
        .cloned()
        .collect();
    if next.len() == codes.len() {
        return Err(Error::NOT_FOUND);
    }
    Ok(next)
}
