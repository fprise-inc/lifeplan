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
pub const CURRENT: &str = "0.6";

/// これまでのすべての形式の版（古い順）。消さない
/// - 0.1: 最初の版（2026-10-18）
/// - 0.2: 誰が直したか（`meta.savedBy`・`meta.revisions`・`meta.editors`・`household.memoBy`・
///   `consents[].recordedBy`・`candidates[].decidedByMember`）を足した（0023 の6。足すだけの MINOR）
/// - 0.3: 控えの区画 `snapshots`（0009 の2。任意。控えが無ければ区画ごと無い）を足した（足すだけの MINOR）
/// - 0.4: 世帯のデータに、持ち家の評価 `residences[].valuation`・売却 `residences[].sale`・器の種類 `otherAsset`（その他の資産）と
///   評価額の増減率 `accounts[].valueGrowth`・前提 `assumptions.realEstateValuation` を足した（どれも任意。足すだけの MINOR。0025）
/// - 0.5: 資産運用（0026）。器の種類 `pooled`（まとめた金融資産）・器の利回り `accounts[].expectedReturn`・運用の費用 `accounts[].fee`・
///   受け取ったお金の行き先 `accounts[].payout.destination`・前提 `assumptions.investment`・`assumptions.assetVolatility`・
///   `assumptions.returnShifts` を足した（どれも任意）。読み方を2つ変えた: 積立の終わり（`contributions[].to`）が空の積立は
///   「表の最後まで」ではなく「名義の人の退職の月まで（推定）」、iDeCo・企業型DC の受け取りの始まりが空なら「75歳」ではなく
///   「退職の年（60〜65歳に収める）」。データは書き換えず、空のまま新しい読み方で読む（画面は「推定あり」の印を出す）
/// - 0.6: 住まい以外の不動産の中身 `accounts[].property`（土地と建物に分ける・取得・家賃収入・経費・売却）と、その不動産のローン
///   `debts[].property` を足した（どれも任意。足すだけの MINOR。0028）。読み方は変えない（中身の無い不動産の器は今までどおり1行で評価する）
pub const KNOWN: &[&str] = &["0.1", "0.2", "0.3", "0.4", "0.5", "0.6"];

/// 1段分の変換
pub struct Step {
    pub from: &'static str,
    pub to: &'static str,
    pub apply: fn(Value) -> Result<Value, StoreError>,
}

/// 変換の段（古い順）。版を上げるときは、ここに1段と、その版の見本を足す。消さない
pub const STEPS: &[Step] = &[
    Step {
        from: "0.1",
        to: "0.2",
        apply: v0_1_to_0_2,
    },
    Step {
        from: "0.2",
        to: "0.3",
        apply: v0_2_to_0_3,
    },
    Step {
        from: "0.3",
        to: "0.4",
        apply: v0_3_to_0_4,
    },
    Step {
        from: "0.4",
        to: "0.5",
        apply: v0_4_to_0_5,
    },
    Step {
        from: "0.5",
        to: "0.6",
        apply: v0_5_to_0_6,
    },
];

/// 0.1 → 0.2: 改訂の履歴と、出てくるメンバーの表示名を空で足す（ほかの欄は任意なので足さない）
fn v0_1_to_0_2(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let meta = obj
        .entry("meta")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let meta = meta.as_object_mut().ok_or(StoreError::BODY)?;
    meta.entry("revisions")
        .or_insert_with(|| Value::Array(vec![]));
    meta.entry("editors")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    meta.insert("formatVersion".into(), "0.2".into());
    Ok(body)
}

/// 0.2 → 0.3: 控えの区画は任意なので足さない（控えの無い世帯は区画ごと無い）。形式の版だけを書き換える
fn v0_2_to_0_3(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.3".into());
    }
    Ok(body)
}

/// 0.3 → 0.4: 足した欄はどれも任意なので足さない（評価・売却・その他の資産が無い世帯は、今までどおりの計算）。形式の版だけを書き換える
fn v0_3_to_0_4(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.4".into());
    }
    Ok(body)
}

/// 0.4 → 0.5: 足した欄はどれも任意なので足さない。積立の終わり・iDeCo の受け取りの始まりが空の値は、空のまま新しい読み方
/// （退職の月まで・退職の年に受け取る。推定）で読む（0026）。形式の版だけを書き換える
fn v0_4_to_0_5(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.5".into());
    }
    Ok(body)
}

/// 0.5 → 0.6: 足した欄（不動産の中身・不動産のローンの指定）はどれも任意なので足さない（中身の無い不動産の器は今までどおりの計算）。
/// 形式の版だけを書き換える（0028）
fn v0_5_to_0_6(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.6".into());
    }
    Ok(body)
}

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
        assert_eq!(access("0.1").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.2").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.3").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.4").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.5").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.7").unwrap(), Access::ReadOnly);
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
        assert_eq!(upgrade("0.7", b.clone()).unwrap(), b);
    }

    #[test]
    fn v0_1_gains_empty_editor_records() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.1", "customerNo": "A1"}, "household": {"memo": ["x"]}});
        let u = upgrade("0.1", b).unwrap();
        assert_eq!(u["meta"]["revisions"], serde_json::json!([]));
        assert_eq!(u["meta"]["editors"], serde_json::json!({}));
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["meta"]["customerNo"], "A1");
        assert_eq!(u["household"]["memo"], serde_json::json!(["x"]));
        // meta の無い本文にも足す。既にある値は変えない
        let u2 = upgrade("0.1", serde_json::json!({"meta": {"revisions": [1]}})).unwrap();
        assert_eq!(u2["meta"]["revisions"], serde_json::json!([1]));
        assert!(upgrade("0.1", serde_json::json!([])).is_err());
    }

    #[test]
    fn v0_2_keeps_everything_and_has_no_snapshots_section() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.2", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "ext": {"ext.a.b": 1}});
        let u = upgrade("0.2", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert_eq!(u["ext"], b["ext"]);
        assert!(
            u.get("snapshots").is_none(),
            "控えの区画は任意なので足さない"
        );
        // 0.1 からも1段ずつ今の版へ
        let u1 = upgrade("0.1", serde_json::json!({"meta": {"formatVersion": "0.1"}})).unwrap();
        assert_eq!(u1["meta"]["formatVersion"], CURRENT);
        assert!(upgrade("0.2", serde_json::json!("x")).is_err());
    }

    #[test]
    fn v0_3_keeps_everything_and_adds_no_valuation() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.3", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"residences": [{"kind": "own"}]}}}}, "snapshots": [{"a": 1}]});
        let u = upgrade("0.3", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(
            u["household"], b["household"],
            "評価・売却の欄は任意なので足さない"
        );
        assert_eq!(u["snapshots"], b["snapshots"]);
        assert!(upgrade("0.3", serde_json::json!(1)).is_err());
    }

    #[test]
    fn v0_4_keeps_empty_contribution_ends_as_they_are() {
        // 積立の終わりが空の積立・受け取りの始まりが空の iDeCo は、書き換えずに新しい読み方（退職の月まで・退職の年。推定）で読む
        let acc = serde_json::json!([{"kind": "nisa", "contributions": [{"from": {"at": "2026-01"}, "to": null, "monthly": 30000}]}, {"kind": "ideco", "contributions": []}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.4", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"accounts": acc}}}}});
        let u = upgrade("0.4", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert!(upgrade("0.4", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_5_keeps_real_estate_without_contents() {
        // 中身（property）の無い不動産の器は、そのまま今までどおり（評価額の増減率で1行）に読む。中身もローンの指定も足さない（0028）
        let acc = serde_json::json!([{"kind": "realEstate", "marketValue": {"value": 18000000}, "valueGrowth": "-0.005", "contributions": []}]);
        let debts = serde_json::json!([{"kind": "other", "principal": 1000000}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.5", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"accounts": acc, "debts": debts}}}}});
        let u = upgrade("0.5", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.6");
        assert_eq!(u["household"], b["household"]);
        assert!(upgrade("0.5", serde_json::json!(null)).is_err());
    }
}
