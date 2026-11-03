//! 配布と更新の目録の形と確かめ方（0017・0022。全体の段取りは 0117）。
//!
//! この部品はネットにつながない。配信元から取ってきたバイト列と、手元に覚えている状態（最後に受け付けた通し番号・版）と、
//! 今の時刻を受け取り、「受け付けるか・当てるか・待つか」だけを返す。取りに行く・保存する・画面に出すのはアプリ本体。
//!
//! - [`keys`] … 4種類の鍵（アプリ更新用・データ用・自動配信用・取り下げ用）を、役割ごとに現用＋次期の2本まで持つ鍵の束。
//!   配布元の設定（`config/distribution.toml` の `[keys]`）の書き方から作る。取り下げの一覧に載った鍵は外せる。
//! - [`envelope`] … データ用・自動配信用・取り下げ用の鍵で署名した封筒（お知らせの一覧〔0087〕と同じ形）を開く。
//! - [`minisig`] … アプリ更新用の鍵（Tauri の updater の minisign の形）の公開鍵と署名を読み、確かめる。
//! - [`app_catalog`] … アプリ本体の更新の目録（段階・一時停止・通し番号・有効期限）と、Tauri の updater に渡す公開鍵の選び方。
//! - [`pack_catalog`] … 制度データパック・マスタデータパックの配信の目録（0022 の4）と、当てるかどうかの判断。
//! - [`revocations`] … 取り下げの一覧とアプリの最低版（0017 の7）。
//! - [`rollout`] … 段階配信（手元だけに持つ0〜99の組と割合）と一時停止。
//!
//! 受け付けない理由は [`Reject`] の符号だけで返す（中身・鍵は文に入れない）。

pub mod app_catalog;
pub mod envelope;
pub mod keys;
pub mod minisig;
pub mod pack_catalog;
pub mod revocations;
pub mod rollout;

/// 受け付けなかった理由の符号（画面・記録に出す。中身・鍵は入れない）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reject(&'static str);

impl Reject {
    /// 形が違う（JSON でない・欄が足りない・大きすぎる・値の形が違う）
    pub const FORMAT: Reject = Reject("E_DIST_FORMAT");
    /// この版のアプリが理解できない（形式の版の MAJOR が違う・`critical` に知らない欄がある）
    pub const UNSUPPORTED: Reject = Reject("E_DIST_UNSUPPORTED");
    /// この版のアプリが持っていない鍵・その役割では使えない鍵で署名されている
    pub const KEY: Reject = Reject("E_DIST_KEY");
    /// 署名が合わない
    pub const SIGNATURE: Reject = Reject("E_DIST_SIGNATURE");
    /// 目録に書いた署名者と、実際に確かめられた鍵が食い違う
    pub const SIGNER_MISMATCH: Reject = Reject("E_DIST_SIGNER_MISMATCH");
    /// 最後に受け付けたものより古い（通し番号・版が小さい）
    pub const OLDER: Reject = Reject("E_DIST_OLDER");
    /// 有効期限を過ぎている
    pub const EXPIRED: Reject = Reject("E_DIST_EXPIRED");
    /// 自動配信用の鍵で受け付けられる範囲の外（0022 の3）
    pub const SCOPE: Reject = Reject("E_DIST_SCOPE");
    /// 中身のファイルの要約（SHA-256）・大きさが目録と合わない
    pub const DIGEST: Reject = Reject("E_DIST_DIGEST");

    pub fn code(&self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for Reject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for Reject {}

/// 目録・一覧のファイルの大きさの上限（バイト）
pub const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;

/// UTC の時刻（`YYYY-MM-DDTHH:MM:SSZ` の形だけ）を、1970-01-01 からの秒に直す。形が違えば None
pub fn parse_utc(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<i64> {
        let t = &s[r];
        if t.bytes().all(|c| c.is_ascii_digit()) {
            t.parse().ok()
        } else {
            None
        }
    };
    let (y, mo, d) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let (h, mi, se) = (digits(11..13)?, digits(14..16)?, digits(17..19)?);
    if !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 || se > 59
    {
        return None;
    }
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se)
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// 1970-01-01 からの日数（グレゴリオ暦）
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 点で区切った数の版（アプリの版 `1.2.3`、パックの版 `2027.3.1`）。数として比べる
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Version(Vec<u64>);

impl Version {
    /// `parts` 個の、点で区切った数（先頭の 0 は「0」そのものだけ）。形が違えば None
    pub fn parse(s: &str, parts: usize) -> Option<Version> {
        let v: Option<Vec<u64>> = s
            .split('.')
            .map(|p| {
                if p.is_empty()
                    || p.len() > 9
                    || !p.bytes().all(|c| c.is_ascii_digit())
                    || (p.len() > 1 && p.starts_with('0'))
                {
                    None
                } else {
                    p.parse().ok()
                }
            })
            .collect();
        let v = v?;
        (v.len() == parts).then_some(Version(v))
    }

    /// アプリの版（`MAJOR.MINOR.PATCH`）
    pub fn app(s: &str) -> Option<Version> {
        Version::parse(s, 3)
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let parts: Vec<String> = self.0.iter().map(u64::to_string).collect();
        f.write_str(&parts.join("."))
    }
}

/// 形式の版（`MAJOR.MINOR`。0001）の MAJOR。形が違えば None
pub(crate) fn format_major(s: &str) -> Option<u64> {
    Version::parse(s, 2).map(|v| v.0[0])
}

/// `critical`（アプリが理解しなければならない欄の名前の一覧。0022 の4）に、知らない欄が無いこと
pub(crate) fn critical_known(critical: &[String], known: &[&str]) -> bool {
    critical.len() <= 64 && critical.iter().all(|c| known.contains(&c.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_times() {
        assert_eq!(parse_utc("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_utc("2027-01-15T09:30:00Z"), Some(1_800_005_400));
        assert!(parse_utc("2028-02-29T00:00:00Z").is_some());
        assert_eq!(parse_utc("2027-02-29T00:00:00Z"), None);
        assert_eq!(parse_utc("2027-01-15T09:30:00+09:00"), None);
        assert_eq!(parse_utc("2027-1-15T09:30:00Z"), None);
    }

    #[test]
    fn versions() {
        let v = |s| Version::app(s).unwrap();
        assert!(v("1.10.0") > v("1.9.9"));
        assert!(v("0.1.0") < v("1.0.0"));
        assert_eq!(Version::app("1.2"), None);
        assert_eq!(Version::app("1.02.0"), None);
        assert_eq!(Version::app("1.2.0-beta"), None);
        assert!(Version::parse("2027.3.10", 3).unwrap() > Version::parse("2027.3.9", 3).unwrap());
        assert_eq!(format_major("1.0"), Some(1));
        assert_eq!(format_major("1"), None);
    }
}
