//! 明細の取り込みで FP が直した結果を覚える辞書と、覚えた CSV の形（0034 の4・5）。
//!
//! - 事務所全体のデータなので、事務所データ（暗号化）に持つ。世帯ファイルには入れない（0011 の6）。
//! - 事務所で共有しているとき（0023・0024）は、共有フォルダの `statement-dict/<メンバーID>.lpsd` に、そのメンバーが直した行だけを
//!   書く（メンバーごとのファイルなので、同期サービスの上で2人が同じファイルを書き合わない）。読むときは全員のファイルと PC の中の
//!   事務所データを合わせ、同じ鍵は日時の新しい行を使う（同じ日時なら消した行、次にメンバーID の大きいほう。画面の側の mergeEntries と同じ決まり）。
//! - 中身の意味（項目の名前・列の対応付けの形）は画面の側の statement/ の部品が決める。ここは形と大きさだけを確かめて、捨てずに持つ。
//! - 店の名前の鍵と項目だけで、金額・日付・お客さまの情報は持たない。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::StoreError;

/// 覚えた辞書の行の数の上限（事務所全体）
pub const MAX_ENTRIES: usize = 20_000;
/// 覚えた形の数の上限（事務所全体）
pub const MAX_FORMATS: usize = 500;
/// 1回に覚える行の数の上限
pub const MAX_LEARN: usize = 5_000;
/// 店の鍵の長さの上限（文字）
pub const MAX_KEY_CHARS: usize = 64;
/// 列の対応付けの JSON の大きさの上限（バイト）
pub const MAX_MAPPING_BYTES: usize = 4_096;

/// 覚えた辞書の1行（店の鍵 → 項目）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub key: String,
    pub category: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub annual: bool,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub removed: bool,
}

/// 覚えた形（見出しの並びの指紋 → 列の対応付け）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedFormat {
    pub fingerprint: String,
    pub kind: String,
    pub mapping: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

/// 事務所の明細の取り込みのデータ
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementOffice {
    #[serde(default)]
    pub dictionary: Vec<DictionaryEntry>,
    #[serde(default)]
    pub formats: Vec<LearnedFormat>,
}

impl StatementOffice {
    pub fn is_empty(&self) -> bool {
        self.dictionary.is_empty() && self.formats.is_empty()
    }
}

fn ascii_word(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn iso_like(s: &str) -> bool {
    s.is_ascii()
        && s.len() >= 20
        && s.len() <= 40
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[10] == b'T'
        && s[..4].chars().all(|c| c.is_ascii_digit())
}

/// 店の鍵: 空でなく 64 字まで、空白・制御文字を含まない（画面の側でそろえた形）
fn valid_key(s: &str) -> bool {
    let n = s.chars().count();
    n > 0 && n <= MAX_KEY_CHARS && !s.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl DictionaryEntry {
    pub fn check(&self) -> Result<(), StoreError> {
        if !valid_key(&self.key)
            || !ascii_word(&self.category, 32)
            || !iso_like(&self.at)
            || self.by.as_deref().is_some_and(|b| !ascii_word(b, 64))
        {
            return Err(StoreError::STATEMENT_DICT);
        }
        Ok(())
    }
}

impl LearnedFormat {
    pub fn check(&self) -> Result<(), StoreError> {
        let mapping_ok = self.mapping.is_object()
            && serde_json::to_vec(&self.mapping).is_ok_and(|b| b.len() <= MAX_MAPPING_BYTES);
        let fp_ok = self.fingerprint.len() == 71
            && self.fingerprint.starts_with("sha256:")
            && self.fingerprint[7..].chars().all(|c| c.is_ascii_hexdigit());
        if !fp_ok
            || !matches!(self.kind.as_str(), "card" | "bank" | "app")
            || !mapping_ok
            || !iso_like(&self.at)
            || self
                .label
                .as_deref()
                .is_some_and(|l| l.chars().count() > 40 || l.chars().any(char::is_control))
            || self.by.as_deref().is_some_and(|b| !ascii_word(b, 64))
        {
            return Err(StoreError::STATEMENT_DICT);
        }
        Ok(())
    }
}

/// a が b より新しいか（日時 → 消した行 → メンバーID の大きいほう）
fn entry_newer(a: &DictionaryEntry, b: &DictionaryEntry) -> bool {
    if a.at != b.at {
        return a.at > b.at;
    }
    if a.removed != b.removed {
        return a.removed;
    }
    a.by.as_deref().unwrap_or("") > b.by.as_deref().unwrap_or("")
}

fn format_newer(a: &LearnedFormat, b: &LearnedFormat) -> bool {
    if a.at != b.at {
        return a.at > b.at;
    }
    a.by.as_deref().unwrap_or("") > b.by.as_deref().unwrap_or("")
}

/// 行どうしをまとめる（同じ鍵は新しいほう。形の合わない行は捨てる）。上限を超えたら古い行から外す。並びは鍵の順
pub fn merge(parts: &[&StatementOffice]) -> StatementOffice {
    let mut dict: std::collections::BTreeMap<String, DictionaryEntry> = Default::default();
    let mut formats: std::collections::BTreeMap<(String, String), LearnedFormat> =
        Default::default();
    for p in parts {
        for e in &p.dictionary {
            if e.check().is_err() {
                continue;
            }
            match dict.get(&e.key) {
                Some(cur) if !entry_newer(e, cur) => {}
                _ => {
                    dict.insert(e.key.clone(), e.clone());
                }
            }
        }
        for f in &p.formats {
            if f.check().is_err() {
                continue;
            }
            let k = (f.fingerprint.clone(), f.kind.clone());
            match formats.get(&k) {
                Some(cur) if !format_newer(f, cur) => {}
                _ => {
                    formats.insert(k, f.clone());
                }
            }
        }
    }
    let mut dictionary: Vec<DictionaryEntry> = dict.into_values().collect();
    if dictionary.len() > MAX_ENTRIES {
        dictionary.sort_by(|a, b| b.at.cmp(&a.at));
        dictionary.truncate(MAX_ENTRIES);
        dictionary.sort_by(|a, b| a.key.cmp(&b.key));
    }
    let mut formats: Vec<LearnedFormat> = formats.into_values().collect();
    if formats.len() > MAX_FORMATS {
        formats.sort_by(|a, b| b.at.cmp(&a.at));
        formats.truncate(MAX_FORMATS);
        formats.sort_by(|a, b| (&a.fingerprint, &a.kind).cmp(&(&b.fingerprint, &b.kind)));
    }
    StatementOffice {
        dictionary,
        formats,
    }
}

/// 覚える行を確かめる（1つでも形が合わなければ何も覚えない）
pub fn check_learn(
    entries: &[DictionaryEntry],
    formats: &[LearnedFormat],
) -> Result<(), StoreError> {
    if entries.len() + formats.len() > MAX_LEARN {
        return Err(StoreError::STATEMENT_DICT);
    }
    for e in entries {
        e.check()?;
    }
    for f in formats {
        f.check()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(key: &str, category: &str, at: &str, by: Option<&str>, removed: bool) -> DictionaryEntry {
        DictionaryEntry {
            key: key.into(),
            category: category.into(),
            annual: false,
            at: at.into(),
            by: by.map(Into::into),
            removed,
        }
    }

    #[test]
    fn newer_wins_then_removed_then_member_id() {
        let a = StatementOffice {
            dictionary: vec![
                e("A", "food", "2026-10-01T00:00:00Z", Some("m1"), false),
                e("B", "food", "2026-10-01T00:00:00Z", Some("m2"), false),
                e("C", "food", "2026-10-01T00:00:00Z", None, false),
            ],
            formats: vec![],
        };
        let b = StatementOffice {
            dictionary: vec![
                e("A", "recreation", "2026-10-02T00:00:00Z", Some("m2"), false),
                e("B", "social", "2026-10-01T00:00:00Z", Some("m1"), false),
                e("C", "otherLiving", "2026-10-01T00:00:00Z", None, true),
            ],
            formats: vec![],
        };
        let m = merge(&[&a, &b]);
        let got: Vec<(&str, &str, bool)> = m
            .dictionary
            .iter()
            .map(|x| (x.key.as_str(), x.category.as_str(), x.removed))
            .collect();
        assert_eq!(
            got,
            vec![
                ("A", "recreation", false),
                ("B", "food", false),
                ("C", "otherLiving", true)
            ]
        );
        assert_eq!(merge(&[&b, &a]), m, "並びによらず同じ結果");
    }

    #[test]
    fn bad_rows_are_dropped_and_learning_is_all_or_nothing() {
        let bad = vec![
            e("", "food", "2026-10-01T00:00:00Z", None, false),
            e("店 名", "food", "2026-10-01T00:00:00Z", None, false),
            e("A", "食費", "2026-10-01T00:00:00Z", None, false),
            e("A", "food", "yesterday", None, false),
            e(
                &"あ".repeat(65),
                "food",
                "2026-10-01T00:00:00Z",
                None,
                false,
            ),
        ];
        for x in &bad {
            assert!(x.check().is_err(), "{x:?}");
        }
        let good = e(
            "架空ノ店",
            "food",
            "2026-10-01T00:00:00Z",
            Some("m1"),
            false,
        );
        assert!(good.check().is_ok());
        let m = merge(&[&StatementOffice {
            dictionary: [bad.clone(), vec![good.clone()]].concat(),
            formats: vec![],
        }]);
        assert_eq!(m.dictionary, vec![good.clone()]);
        assert!(check_learn(&[good.clone(), bad[0].clone()], &[]).is_err());
        assert!(check_learn(&[good], &[]).is_ok());
    }

    #[test]
    fn formats_are_checked() {
        let f = LearnedFormat {
            fingerprint: format!("sha256:{}", "a".repeat(64)),
            kind: "card".into(),
            mapping: serde_json::json!({"headerRow": 0, "columns": {"date": 0}, "sign": "expensePositive"}),
            label: Some("Aカードの CSV".into()),
            at: "2026-10-01T00:00:00Z".into(),
            by: None,
        };
        assert!(f.check().is_ok());
        assert!(LearnedFormat {
            kind: "x".into(),
            ..f.clone()
        }
        .check()
        .is_err());
        assert!(LearnedFormat {
            mapping: serde_json::json!([1]),
            ..f.clone()
        }
        .check()
        .is_err());
        assert!(LearnedFormat {
            fingerprint: "sha256:zz".into(),
            ..f.clone()
        }
        .check()
        .is_err());
        assert!(LearnedFormat {
            mapping: serde_json::json!({"x": "y".repeat(5000)}),
            ..f
        }
        .check()
        .is_err());
    }
}
