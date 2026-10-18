//! 形式の版と一方向の移行（0011 の5）。
//!
//! - 本文の形式の版は `MAJOR.MINOR`。β公開までは `0.x`（最初は `0.1`）で書く（0011 の追記）。
//! - 読み込み時に、古い版から今の版まで、版が上がった順に1段ずつ変換する。各段は入力と出力が決まった純粋な関数。
//!   MINOR だけが上がった段も、中身が「何もしない」でも置く（全段がそろっていることをテストで確かめる）。
//! - MAJOR が新しいファイルは開かない。MINOR だけが新しいファイルは閲覧だけ（保存させない）。
//! - 過去のすべての版の見本を `tests/fixtures/household-format/<版>/` に置き、消さない（テストで毎回開いて今の版へ変換する）。

use serde_json::Value;

use crate::StoreError;

/// 今の形式の版（保存は常にこの版）
pub const CURRENT: &str = "0.1";

/// これまでのすべての形式の版（古い順）。消さない
pub const KNOWN: &[&str] = &["0.1"];

/// 1段分の変換
pub struct Step {
    pub from: &'static str,
    pub to: &'static str,
    pub apply: fn(Value) -> Result<Value, StoreError>,
}

/// 変換の段（古い順）。版を上げるときは、ここに1段と、その版の見本を足す。消さない
pub const STEPS: &[Step] = &[];

/// 開き方
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// 保存できる（今の版か、変換できる古い版）
    ReadWrite,
    /// MINOR だけが新しい: 閲覧だけ（保存・控え・PDF の出力はさせない）
    ReadOnly,
}

pub fn parse(v: &str) -> Option<(u32, u32)> {
    let (a, b) = v.split_once('.')?;
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 6
            && s.bytes().all(|c| c.is_ascii_digit())
            && (s == "0" || !s.starts_with('0'))
    };
    if !ok(a) || !ok(b) {
        return None;
    }
    Some((a.parse().ok()?, b.parse().ok()?))
}

/// この版のファイルをどう開くか
pub fn access(version: &str) -> Result<Access, StoreError> {
    let (ma, mi) = parse(version).ok_or(StoreError::FORMAT_UNKNOWN)?;
    let (cma, cmi) = parse(CURRENT).expect("今の版");
    if ma > cma {
        return Err(StoreError::FORMAT_TOO_NEW);
    }
    if ma == cma && mi > cmi {
        return Ok(Access::ReadOnly);
    }
    if KNOWN.contains(&version) {
        Ok(Access::ReadWrite)
    } else {
        Err(StoreError::FORMAT_UNKNOWN)
    }
}

/// 古い版の本文を今の版へ変換する（閲覧だけの新しい版は、そのまま返す）
pub fn upgrade(version: &str, mut body: Value) -> Result<Value, StoreError> {
    if access(version)? == Access::ReadOnly {
        return Ok(body);
    }
    let mut v = version;
    while v != CURRENT {
        let step = STEPS
            .iter()
            .find(|s| s.from == v)
            .ok_or(StoreError::FORMAT_UNKNOWN)?;
        body = (step.apply)(body)?;
        v = step.to;
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_known_version_has_a_path_to_current() {
        assert_eq!(*KNOWN.last().unwrap(), CURRENT, "今の版は一覧の最後");
        let mut sorted: Vec<(u32, u32)> = KNOWN.iter().map(|v| parse(v).unwrap()).collect();
        let orig = sorted.clone();
        sorted.sort();
        assert_eq!(orig, sorted, "古い順に並べる");
        for v in KNOWN.iter().filter(|v| **v != CURRENT) {
            let step = STEPS.iter().find(|s| s.from == *v);
            assert!(step.is_some(), "{v} から次の版への変換の段が無い");
            let next = KNOWN.iter().position(|k| k == v).unwrap() + 1;
            assert_eq!(
                step.unwrap().to,
                KNOWN[next],
                "{v} の次の段は一覧の次の版へ"
            );
        }
        assert_eq!(STEPS.len(), KNOWN.len() - 1, "段の数＝版の数−1");
    }

    #[test]
    fn newer_versions_are_refused_or_read_only() {
        assert_eq!(access(CURRENT).unwrap(), Access::ReadWrite);
        assert_eq!(access("0.2").unwrap(), Access::ReadOnly);
        assert_eq!(access("0.99").unwrap(), Access::ReadOnly);
        assert_eq!(access("1.0").unwrap_err(), StoreError::FORMAT_TOO_NEW);
        assert_eq!(
            access("0.0").unwrap_err(),
            StoreError::FORMAT_UNKNOWN,
            "開発中の古い形式は読めなくてよい"
        );
        assert_eq!(access("x").unwrap_err(), StoreError::FORMAT_UNKNOWN);
        assert_eq!(access("01.1").unwrap_err(), StoreError::FORMAT_UNKNOWN);
        let b = serde_json::json!({"a": 1});
        assert_eq!(upgrade(CURRENT, b.clone()).unwrap(), b);
        assert_eq!(upgrade("0.2", b.clone()).unwrap(), b);
    }
}
