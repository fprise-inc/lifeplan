//! 形式の版と一方向の移行（0011 の5）。
//!
//! - 本文の形式の版は `MAJOR.MINOR`。β公開までは `0.x`（最初は `0.1`）で書く（0011 の追記）。
//! - 読み込み時に、古い版から今の版まで、版が上がった順に1段ずつ変換する。各段は入力と出力が決まった純粋な関数。
//!   MINOR だけが上がった段も、中身が「何もしない」でも置く（全段がそろっていることをテストで確かめる）。
//! - MAJOR が新しいファイルは開かない。MINOR だけが新しいファイルは閲覧だけ（保存させない）。
//! - 過去のすべての版の見本を `tests/fixtures/household-format/<版>/` に置き、消さない（テストで毎回開いて今の版へ変換する）。

use serde_json::{Map, Value};

use crate::readings;
use crate::StoreError;

/// 今の形式の版（保存は常にこの版）
pub const CURRENT: &str = "0.22";

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
/// - 0.7: 表示の設定に、資産と負債のタブで時点を並べるときの既定の時点 `display.bsPoints` と、この世帯で選んだ時点 `display.bsColumns`
///   （候補の鍵か決まった年）を足した（どちらも任意。無ければ既定。足すだけの MINOR。0027 の追記）。0.6 の間に足した家計の体力の目安の幅
///   `display.bsGuide`（任意）も、この版から形式の一部として数える
/// - 0.8: 表示の設定をタブごとの区画に分けた（`display.result`: 結果のタブ ＝ `metrics`・`atAge`・`layout`・`invBreakdown`・`invPeriods`、
///   `display.balance`: 資産と負債のタブ ＝ `guide`・`points`・`columns`）。なくした「操作中はグラフを上に表示」の `display.dock` は持たない。
///   形を変える段（0.7 → 0.8）で、直下の値を区画へ移す（`bsGuide` → `balance.guide`、`bsPoints` → `balance.points`、`bsColumns` → `balance.columns`）
/// - 0.9: 教育の目標に、保育所の段の保育の時間 `stages[].hours`・国の基準に対する自治体の水準の割合 `stages[].feeRatio` と、
///   公立の小学校・中学校の給食費 `education.schoolLunch` を足した（どれも任意。足すだけの MINOR。0029）。読み方を1つ変えた:
///   保育所の段の月額（`stages[].monthly`）が空なら「0円」ではなく「世帯の収入から自動で計算した保育料（目安）」。データは書き換えず、
///   空のまま新しい読み方で読む（月額 0 を入れた段は今までどおり保育料なし）
/// - 0.10: 控えのきっかけに `takeaway`（持ち帰り用のレポートを書き出した時点）と、その記録 `snapshots[].takeaway`（載せたプラン・
///   FP の提案のプラン・パスワードの有無・顧客が動かせるつまみ・載せた画面・作成日・ファイルの指紋。パスワード・宛名は持たない）を足した
///   （足すだけの MINOR。0030）。0.9 までのアプリは知らないきっかけの控えを読み落とすので、版を上げて閲覧だけにする
/// - 0.11: 前提に、黒字のうち貯まる割合 `assumptions.surplusSaving`（割合・上限・期間で変える組）と生活防衛資金
///   `assumptions.emergencyReserve`（金額か基本生活費の○か月分・「○歳まで持つ」の判定に含めるか）、まとめた金融資産の器の
///   運用しない分 `accounts[].uninvested` を足した（どれも任意。足すだけの MINOR。0031）。読み方は変えない（無ければ今まで通り）。
///   0.10 までのアプリの計算エンジンはこの欄を知らないので、版を上げて閲覧だけにする
/// - 0.12: 生活防衛資金をなくした（0031 の追記）。前提の `assumptions.emergencyReserve` と、プランの差分のうちその前提を動かすもの
///   （動かす項目 `reserve:months`）・対策に足した項目の `reserve:months` を、変換の段で捨てる（形を変える MINOR）。控えの中身は変えない。
///   0.11 のアプリは前提が無ければ今まで通りに読むが、捨てた値を書き戻さないよう版を上げる
/// - 0.13: 資産と負債のタブの表示の設定に、お金の3つの分け方 `display.balance.moneyThree`（何か月分 `months`・何年先まで `years`・
///   呼び方 `wording`）を足した（任意。無ければ既定の 6か月・10年・使う／貯める／増やす。足すだけの MINOR。0032）。
///   0.12 までのアプリは知らない欄を読み落として書き戻さないので、版を上げて閲覧だけにする（0.7 と同じ考え方）
/// - 0.14: 本文の区画 `statements`（明細の取り込みの記録。口座・カードの呼び名と持ち主、取り込みごとの元のファイルの指紋・読み手・
///   列の対応付け・期間・番号を消した後の行と FP が決めたこと、世帯の決まり、構成員ごとの働き方、候補を取り込んだ記録。0034）を足した
///   （任意。取り込んでいない世帯は区画ごと無い。足すだけの MINOR）。元のファイルは持たない。0.13 までのアプリは知らない区画を
///   読み落として書き戻さないので、版を上げて閲覧だけにする
/// - 0.15: 区画 `statements` に、前もってお客さまに印を付けてもらう確認シートの依頼の記録 `requests`（依頼番号・書き出した日時・
///   書き出したファイルの指紋と大きさ・シートの番号 → 取り込みの ID と行の ID・取り込んだ記録 `received`）を足した（任意。書き出して
///   いなければ無い。足すだけの MINOR。0034 の9）。0.14 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.16: 確認シートの依頼の記録 `requests` の行の対応 `rows` で、同じ番号に複数の行を対応させられるようにした（店ごとにまとめた
///   シートの1行。0034 の9）。欄は足していない。0.15 のアプリは同じ番号の2つ目からを捨てて書き戻すので、版を上げて閲覧だけにする
/// - 0.17: 作りの変わる形を1段で変える（0035）。並びの要素の ID（決まった作り方で振る）、世帯の外の家族の印 `members[].outside`
///   （親・祖父母の構成員に付け、開いたときの知らせを書く。贈与者 `donors` は同じ ID の世帯の外の家族にして区画をなくす）、
///   値の状態の欄 `valueStates`（仮の印 `household.assumed` を読み替え表で移す）、プランの差分を当て先の形に（0036）、
///   対策に足した項目 `workspace.shownItems` を当て先に。控え・ヒアリング・明細の取り込み・拡張領域は変えない
/// - 0.18: 段階と例外の年（周期的な支出・家賃・修繕費・固定資産税・住まい以外の不動産の家賃と経費の `stages`・`exceptions`、
///   器の利回りの `returnStages`・`returnExceptions`、資産配分の `allocation.stages`）と、働き方の期間ごとの伸び（給与の
///   `salary.growth.rate`・事業所得の `business.growth`）を足した（足すだけの MINOR。0040）。0.17 のアプリは知らない欄を読み落として
///   書き戻すので、版を上げて閲覧だけにする
/// - 0.19: 世帯の外の家族のお金 `members[].wallet`（預金・生活費・年金・一時の入金。0042）を足した（任意。入れていなければ無い。
///   足すだけの MINOR）。0.18 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.20: お金の行（0044）。入るお金の行 `incomeFlows`、出るお金の行 `periodicExpenses` の `monthly`・`kind`・`counterparty`・
///   `payer`・`priority`・`gift`、口座の間の移し替えの入れ物 `transfers`、負債の `inheritedFrom`・`likelihood`・`includeInBase` を
///   足した（どれも任意。足すだけの MINOR）。0.19 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.21: 住まい・ローンのカード（0052・0053）。住まいの建て方 `residences[].style`、譲渡所得の税の額 `residences[].sale.tax`、
///   負債の名前 `debts[].label` と種類の細目 `debts[].subtype`、画面の側のローンの入れ方の区分 `household.loanEntry` を足した
///   （どれも任意。足すだけの MINOR）。0.20 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.22: 退職金・企業年金のカード（0057）。退職給付の名前 `retirementBenefits[].label` と学歴 `retirementBenefits[].education`
///   （退職一時金の目安の元）を足した（どれも任意。計算には使わない。足すだけの MINOR）。0.21 のアプリは知らない欄を読み落として
///   書き戻すので、版を上げて閲覧だけにする
pub const KNOWN: &[&str] = &[
    "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13",
    "0.14", "0.15", "0.16", "0.17", "0.18", "0.19", "0.20", "0.21", "0.22",
];

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
    Step {
        from: "0.6",
        to: "0.7",
        apply: v0_6_to_0_7,
    },
    Step {
        from: "0.7",
        to: "0.8",
        apply: v0_7_to_0_8,
    },
    Step {
        from: "0.8",
        to: "0.9",
        apply: v0_8_to_0_9,
    },
    Step {
        from: "0.9",
        to: "0.10",
        apply: v0_9_to_0_10,
    },
    Step {
        from: "0.10",
        to: "0.11",
        apply: v0_10_to_0_11,
    },
    Step {
        from: "0.11",
        to: "0.12",
        apply: v0_11_to_0_12,
    },
    Step {
        from: "0.12",
        to: "0.13",
        apply: v0_12_to_0_13,
    },
    Step {
        from: "0.13",
        to: "0.14",
        apply: v0_13_to_0_14,
    },
    Step {
        from: "0.14",
        to: "0.15",
        apply: v0_14_to_0_15,
    },
    Step {
        from: "0.15",
        to: "0.16",
        apply: v0_15_to_0_16,
    },
    Step {
        from: "0.16",
        to: "0.17",
        apply: v0_16_to_0_17,
    },
    Step {
        from: "0.17",
        to: "0.18",
        apply: v0_17_to_0_18,
    },
    Step {
        from: "0.18",
        to: "0.19",
        apply: v0_18_to_0_19,
    },
    Step {
        from: "0.19",
        to: "0.20",
        apply: v0_19_to_0_20,
    },
    Step {
        from: "0.20",
        to: "0.21",
        apply: v0_20_to_0_21,
    },
    Step {
        from: "0.21",
        to: "0.22",
        apply: v0_21_to_0_22,
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

/// 0.6 → 0.7: 足した欄（並べる時点の既定・この世帯で選んだ時点）はどちらも任意なので足さない（無ければ既定の 今・退職の年・75歳）。
/// 形式の版だけを書き換える（0027 の追記）
fn v0_6_to_0_7(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.7".into());
    }
    Ok(body)
}

/// 表示の設定の直下の欄のうち、結果のタブの区画へ移すもの（名前は変えない）
const RESULT_KEYS: &[&str] = &["metrics", "atAge", "layout", "invBreakdown", "invPeriods"];
/// 資産と負債のタブの区画へ移すもの（前の名前 → 区画の中の名前）
const BALANCE_KEYS: &[(&str, &str)] = &[
    ("bsGuide", "guide"),
    ("bsPoints", "points"),
    ("bsColumns", "columns"),
];

/// 0.7 → 0.8: 表示の設定を、タブごとの区画（`display.result`・`display.balance`）へ移す。なくした `display.dock` は捨てる。
/// 区画へ移す欄のほか（知らない欄）は、そのまま直下に残す（失わない）。表示の設定の無い本文には足さない（画面が既定で読む）
fn v0_7_to_0_8(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(display) = obj.get_mut("display").and_then(Value::as_object_mut) {
        if !display.contains_key("result") && !display.contains_key("balance") {
            let mut result = serde_json::Map::new();
            for k in RESULT_KEYS {
                if let Some(v) = display.remove(*k) {
                    result.insert((*k).into(), v);
                }
            }
            let mut balance = serde_json::Map::new();
            for (from, to) in BALANCE_KEYS {
                if let Some(v) = display.remove(*from) {
                    balance.insert((*to).into(), v);
                }
            }
            display.insert("result".into(), Value::Object(result));
            display.insert("balance".into(), Value::Object(balance));
        }
        display.remove("dock");
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.8".into());
    }
    Ok(body)
}

/// 0.8 → 0.9: 足した欄（保育の時間・自治体の水準の割合・給食費）はどれも任意なので足さない。保育所の段の空の月額は書き換えず、
/// 新しい読み方（収入から自動で計算）で読む。形式の版だけを書き換える（0029）
fn v0_8_to_0_9(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.9".into());
    }
    Ok(body)
}

/// 開き方
/// 0.9 → 0.10: 足した欄（控えのきっかけ takeaway とその記録）は任意なので足さない。形式の版だけを書き換える（0030）
fn v0_9_to_0_10(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.10".into());
    }
    Ok(body)
}

/// 0.10 → 0.11: 足した欄（黒字のうち貯まる割合・生活防衛資金・運用しない分）はどれも任意なので足さない。形式の版だけを書き換える（0031）
fn v0_10_to_0_11(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.11".into());
    }
    Ok(body)
}

/// なくした生活防衛資金の前提の入力項目ID・動かす項目のキー（0031 の追記）
const REMOVED_RESERVE_ITEM: &str = "assumptions.emergencyReserve";
const REMOVED_RESERVE_KEY: &str = "reserve:months";

/// 0.11 → 0.12: なくした生活防衛資金を捨てる（0031 の追記）。現状の前提 `household.request.input.assumptions.emergencyReserve`、
/// プランの差分のうちその前提を動かすもの（入力項目が `assumptions.emergencyReserve` か、キーが `reserve:months`）、
/// 対策に足した項目（`workspace.shownItems`）の `reserve:months`。控え（`snapshots`）の中身は変えない（画面が計算するときに無視する）
fn v0_11_to_0_12(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(a) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
        .and_then(|i| i.get_mut("assumptions"))
        .and_then(Value::as_object_mut)
    {
        a.remove("emergencyReserve");
    }
    if let Some(list) = obj.get_mut("proposals").and_then(Value::as_array_mut) {
        for p in list {
            if let Some(diffs) = p.get_mut("diffs").and_then(Value::as_array_mut) {
                diffs.retain(|d| {
                    d.get("item").and_then(Value::as_str) != Some(REMOVED_RESERVE_ITEM)
                        && d.get("key").and_then(Value::as_str) != Some(REMOVED_RESERVE_KEY)
                });
            }
        }
    }
    if let Some(shown) = obj
        .get_mut("workspace")
        .and_then(|w| w.get_mut("shownItems"))
        .and_then(Value::as_array_mut)
    {
        shown.retain(|k| k.as_str() != Some(REMOVED_RESERVE_KEY));
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.12".into());
    }
    Ok(body)
}

/// 0.12 → 0.13: 足した欄（お金の3つの分け方の表示の設定）は任意なので足さない。形式の版だけを書き換える（0032）
fn v0_12_to_0_13(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.13".into());
    }
    Ok(body)
}

/// 0.13 → 0.14: 足した区画（明細の取り込みの記録 `statements`）は任意なので足さない。形式の版だけを書き換える（0034）
fn v0_13_to_0_14(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.14".into());
    }
    Ok(body)
}

/// 0.14 → 0.15: 足した欄（確認シートの依頼の記録 `statements.requests`）は任意なので足さない。形式の版だけを書き換える（0034 の9）
fn v0_14_to_0_15(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.15".into());
    }
    Ok(body)
}

/// 0.15 → 0.16: 0.15 の依頼の記録は番号ごとに1行なので、そのまま 0.16 の形として読める。形式の版だけを書き換える（0034 の9）
fn v0_15_to_0_16(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.16".into());
    }
    Ok(body)
}

/// 0.17 → 0.18: 足した欄（段階・例外の年・器の利回りの段階・資産配分の段階・期間ごとの伸び）は任意なので足さない。
/// 形式の版だけを書き換える（0040）
fn v0_17_to_0_18(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.18".into());
    }
    Ok(body)
}

/// 0.18 → 0.19: 足した欄（世帯の外の家族のお金 `members[].wallet`。0042）は任意なので足さない。形式の版だけを書き換える
fn v0_18_to_0_19(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.19".into());
    }
    Ok(body)
}

/// 0.19 → 0.20: 足した欄（お金の行。0044）は任意なので足さない。形式の版だけを書き換える
fn v0_19_to_0_20(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.20".into());
    }
    Ok(body)
}

/// 0.20 → 0.21: 足した欄（住まいの建て方・譲渡所得の税の額・負債の名前と種類の細目・ローンの入れ方の区分。0052・0053）は任意なので
/// 足さない。形式の版だけを書き換える
fn v0_20_to_0_21(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.21".into());
    }
    Ok(body)
}

/// 0.21 → 0.22: 足した欄（退職給付の名前と学歴。0057）は任意なので足さない。形式の版だけを書き換える
fn v0_21_to_0_22(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.22".into());
    }
    Ok(body)
}

/// 0.17 で ID を振る並び（物の集まり → その物から並びまでの欄の名前。0035 の5）
const ELEMENT_LISTS: &[(&str, &[&[&str]])] = &[
    ("livingExpenses", &[&["stages"], &["categories"]]),
    ("accounts", &[&["contributions"]]),
    ("debts", &[&["rateSchedule"], &["prepayments"]]),
    ("residences", &[&["purchase", "gifts"]]),
    ("insuranceContracts", &[&["renewals"]]),
    (
        "goals",
        &[
            &["education", "stages"],
            &["education", "lessons"],
            &["education", "scholarships"],
            &["education", "loans"],
            &["education", "gifts"],
        ],
    ),
    (
        "advisoryFees",
        &[
            &["terms", "oneTime"],
            &["terms", "recurring", "revision", "steps"],
        ],
    ),
];
/// 0.17 で ID を振る前提の列（親は `assumptions`）
const ASSUMPTION_LISTS: &[&[&str]] = &[
    &["marketShocks"],
    &["loanRateShifts"],
    &["incomeShocks"],
    &["returnShifts"],
    &["surplusSaving", "changes"],
];

fn get_path_mut<'a>(mut v: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    for k in path {
        v = v.as_object_mut()?.get_mut(*k)?;
    }
    Some(v)
}

/// 並びの要素に、場所から決まった ID を振る（ID がある要素はそのまま。0035 の10 の1）
fn assign_ids(list: &mut Value, place: &str) {
    if let Some(arr) = list.as_array_mut() {
        for (i, el) in arr.iter_mut().enumerate() {
            if let Some(o) = el.as_object_mut() {
                if !o.contains_key("id") {
                    o.insert(
                        "id".into(),
                        Value::String(readings::migration_id(&format!("{place}/{i}"))),
                    );
                }
            }
        }
    }
}

fn assign_element_ids(input: &mut Value) {
    if let Some(h) = input.get_mut("household").and_then(Value::as_object_mut) {
        for (coll, paths) in ELEMENT_LISTS {
            let Some(objs) = h.get_mut(*coll).and_then(Value::as_array_mut) else {
                continue;
            };
            for obj in objs.iter_mut() {
                let Some(id) = obj.get("id").and_then(Value::as_str).map(str::to_owned) else {
                    continue;
                };
                for path in *paths {
                    if let Some(list) = get_path_mut(obj, path) {
                        assign_ids(list, &format!("{id}/{}", path.join("/")));
                    }
                }
            }
        }
        if let Some(rels) = h.get_mut("relations").and_then(Value::as_array_mut) {
            for (i, r) in rels.iter_mut().enumerate() {
                let Some(o) = r.as_object_mut() else { continue };
                if o.contains_key("id") {
                    continue;
                }
                let end = |a: &str, b: &str| -> String {
                    let x = o.get(a).or_else(|| o.get(b)).and_then(Value::as_str);
                    x.unwrap_or("").to_owned()
                };
                let place = format!("relations/{i}/{}/{}", end("a", "parent"), end("b", "child"));
                o.insert("id".into(), Value::String(readings::migration_id(&place)));
            }
        }
    }
    if let Some(a) = input.get_mut("assumptions") {
        for path in ASSUMPTION_LISTS {
            if let Some(list) = get_path_mut(a, path) {
                assign_ids(list, &format!("assumptions/{}", path.join("/")));
            }
        }
    }
}

/// 親・祖父母の構成員を世帯の外の家族にし（不具合の直しとして書き換える唯一の例外）、贈与者を同じ ID の世帯の外の家族にする（0035 の10 の2）。
/// 戻り値は世帯の外の家族にした親・祖父母の ID
fn convert_outside_family(input: &mut Value) -> Vec<String> {
    let Some(h) = input.get_mut("household").and_then(Value::as_object_mut) else {
        return Vec::new();
    };
    let rels = h.get("relations").cloned().unwrap_or(Value::Null);
    let members: Vec<Value> = h
        .get("members")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let converts = |m: &Value| {
        matches!(m["kind"].as_str(), Some("parent" | "grandparent")) && m.get("outside").is_none()
    };
    // 世帯の中に残る構成員（親とする関係の子として探す）
    let inside: Vec<&str> = members
        .iter()
        .filter(|m| !converts(m) && m.get("outside").is_none())
        .filter_map(|m| m["id"].as_str())
        .collect();
    let self_id: Option<String> = members
        .iter()
        .find(|m| m["kind"] == "self")
        .and_then(|m| m["id"].as_str())
        .map(str::to_owned);
    let mut changed = Vec::new();
    if let Some(list) = h.get_mut("members").and_then(Value::as_array_mut) {
        for m in list.iter_mut() {
            if !converts(m) {
                continue;
            }
            let id = m["id"].as_str().unwrap_or("").to_owned();
            let children: Vec<&str> = rels
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|r| {
                            r["type"] == "parentOf" && r["parent"].as_str() == Some(id.as_str())
                        })
                        .filter_map(|r| r["child"].as_str())
                        .collect()
                })
                .unwrap_or_default();
            // 誰の家族か: 世帯の中に残る子（親とする関係）、無ければ本人（0035 の4。省けるのは贈与者から作った人だけ）
            let of = inside
                .iter()
                .find(|i| children.contains(i))
                .copied()
                .or(self_id.as_deref());
            let mut outside = serde_json::json!({"periods": []});
            if let Some(of) = of {
                outside["of"] = Value::String(of.to_owned());
            }
            m["outside"] = outside;
            changed.push(id);
        }
    }
    if let Some(donors) = h.remove("donors") {
        let list = h
            .entry("members")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut();
        if let Some(list) = list {
            for d in donors.as_array().into_iter().flatten() {
                let mut outside = serde_json::json!({"periods": []});
                if let Some(of) = d.get("of") {
                    outside["of"] = of.clone();
                }
                list.push(serde_json::json!({
                    "id": d["id"],
                    "kind": d["kind"],
                    "joins": null,
                    "leaves": null,
                    "expected": false,
                    "outside": outside,
                }));
            }
        }
    }
    changed
}

/// 当て先の場所の文字（`valueStates` の鍵。0035 の3）
fn state_key(address: &Value) -> Option<String> {
    let item = address["item"].as_str()?;
    let at: Vec<&str> = address["at"]
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    Some(if at.is_empty() {
        item.to_owned()
    } else {
        format!("{item}/{}", at.join("/"))
    })
}

fn is_box(v: Option<&Value>) -> bool {
    v.is_some_and(|v| {
        v.get("state").is_some_and(Value::is_string)
            && v.get("origin").is_some_and(Value::is_object)
    })
}

/// 当て先の向き先の物（構成員・物の集まりの1件）か、要求の入力（前提・表の最後の年）
fn target_mut<'a>(input: &'a mut Value, target: &Value) -> Option<&'a mut Value> {
    if target.get("plan").is_some() {
        return Some(input);
    }
    let id = target
        .get("object")
        .or_else(|| target.get("member"))?
        .as_str()?
        .to_owned();
    input
        .get_mut("household")?
        .as_object_mut()?
        .values_mut()
        .filter_map(Value::as_array_mut)
        .flatten()
        .find(|x| x.get("id").and_then(Value::as_str) == Some(id.as_str()))
}

/// 仮の印（household.assumed）を、当て先の物の値の状態の欄（推定）へ移す。移せない印は残す（0035 の10 の3）
fn move_assumed(screen: &mut Map<String, Value>, input: &mut Value, read: &Value) {
    let Some(assumed) = screen.get("assumed").and_then(Value::as_object).cloned() else {
        return;
    };
    let mut kept = Map::new();
    for (k, basis) in assumed {
        let r = readings::resolve_assumed_key(&k, read);
        let Some(r) = r.filter(|r| r["kind"] == "address") else {
            kept.insert(k, basis);
            continue;
        };
        let address = &r["address"];
        let cur = readings::read_at(read, address);
        // 値の無い場所（無くなった要素・まだ入れていない欄）には行を書かない。値の箱を持つ値は、箱の状態が正
        if cur.is_none_or(Value::is_null) || is_box(cur) {
            continue;
        }
        let (Some(key), Some(obj)) = (state_key(address), target_mut(input, &address["target"]))
        else {
            kept.insert(k, basis);
            continue;
        };
        let Some(obj) = obj.as_object_mut() else {
            kept.insert(k, basis);
            continue;
        };
        let text = basis
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("仮の値")
            .to_owned();
        let method = r["method"].as_str().unwrap_or("standard").to_owned();
        let states = obj
            .entry("valueStates")
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(states) = states.as_object_mut() {
            states.insert(
                key,
                serde_json::json!({"state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": method, "basis": text}}),
            );
        }
    }
    if kept.is_empty() {
        screen.remove("assumed");
    } else {
        screen.insert("assumed".into(), Value::Object(kept));
    }
}

/// 0.16 の差分を当て先の形に読み替える（0036 の5）。戻り値は読み替えられなかった差分の数
fn convert_diffs(proposals: &mut Value, read: &Value) -> usize {
    let mut unresolved = 0;
    for p in proposals.as_array_mut().into_iter().flatten() {
        let Some(diffs) = p.get_mut("diffs").and_then(Value::as_array_mut) else {
            continue;
        };
        for d in diffs.iter_mut() {
            let Some(o) = d.as_object_mut() else { continue };
            let Some(key) = o.remove("key").and_then(|k| k.as_str().map(str::to_owned)) else {
                continue; // もう当て先の形
            };
            let old_target = o.get("target").cloned().unwrap_or(Value::Null);
            let old_item = o.get("item").cloned().unwrap_or(Value::Null);
            o.insert(
                "legacy".into(),
                serde_json::json!({"key": key, "target": old_target, "item": old_item}),
            );
            o.insert("op".into(), "set".into());
            match readings::resolve_key(&key, read) {
                Some(r) if r["kind"] == "address" => {
                    o.insert("target".into(), r["address"]["target"].clone());
                    o.insert("item".into(), r["address"]["item"].clone());
                    o.insert("at".into(), r["address"]["at"].clone());
                }
                Some(r) if r["kind"] == "lever" => {
                    let mut t = serde_json::json!({"lever": r["lever"]});
                    for k in ["object", "member"] {
                        if let Some(v) = r.get(k) {
                            t[k] = v.clone();
                        }
                    }
                    o.insert("target".into(), t);
                    o.insert("at".into(), Value::Array(Vec::new()));
                }
                _ => {
                    o.insert("at".into(), Value::Null);
                    o.insert("unresolved".into(), Value::Bool(true));
                    unresolved += 1;
                }
            }
        }
    }
    unresolved
}

/// 対策に足した項目（動かす項目のキー）を当て先にする。読み替えられない項目は捨てる（画面の並びの好みで、値ではないため）
fn convert_shown_items(workspace: &mut Value, read: &Value) {
    let Some(list) = workspace
        .get_mut("shownItems")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let mut out = Vec::new();
    for k in list.iter() {
        let Some(k) = k.as_str() else { continue };
        match readings::resolve_key(k, read) {
            Some(r) if r["kind"] == "address" => out.push(r["address"].clone()),
            Some(r) if r["kind"] == "lever" => {
                let mut t = serde_json::json!({"lever": r["lever"]});
                for key in ["object", "member"] {
                    if let Some(v) = r.get(key) {
                        t[key] = v.clone();
                    }
                }
                out.push(serde_json::json!({"target": t, "item": null, "at": []}));
            }
            _ => {}
        }
    }
    *list = out;
}

/// 0.16 → 0.17（0035 の10）: 作りの変わる形を1段で変える。並びの要素の ID・世帯の外の家族・仮の印・プランの差分・対策に足した項目。
/// 控え・ヒアリング・明細の取り込み・拡張領域は変えない
fn v0_16_to_0_17(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let mut outside = Vec::new();
    let mut read = Value::Null;
    if let Some(input) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
    {
        assign_element_ids(input);
        outside = convert_outside_family(input);
        read = input.clone();
    }
    if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
        let mut input = screen
            .get_mut("request")
            .and_then(|r| r.get_mut("input"))
            .map(std::mem::take)
            .unwrap_or(Value::Null);
        if input.is_object() {
            move_assumed(screen, &mut input, &read);
            if let Some(r) = screen.get_mut("request").and_then(Value::as_object_mut) {
                r.insert("input".into(), input);
            }
        }
    }
    let unresolved = match obj.get_mut("proposals") {
        Some(p) => convert_diffs(p, &read),
        None => 0,
    };
    if let Some(w) = obj.get_mut("workspace") {
        convert_shown_items(w, &read);
    }
    let mut notices = Vec::new();
    if !outside.is_empty() {
        notices.push(serde_json::json!({
            "id": readings::migration_id(&format!("notices/outsideFamily/{}", outside.join("/"))),
            "kind": "outsideFamily",
            "members": outside,
        }));
    }
    if unresolved > 0 {
        notices.push(serde_json::json!({
            "id": readings::migration_id(&format!("notices/unresolvedDiffs/{unresolved}")),
            "kind": "unresolvedDiffs",
            "count": unresolved,
        }));
    }
    if !notices.is_empty() {
        if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
            let list = screen
                .entry("notices")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(list) = list.as_array_mut() {
                list.extend(notices);
            }
        }
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.17".into());
    }
    Ok(body)
}

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
        assert_eq!(access("0.6").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.7").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.8").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.9").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.10").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.11").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.12").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.13").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.14").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.15").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.16").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.17").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.18").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.19").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.20").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.21").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.22").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.23").unwrap(), Access::ReadOnly);
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
        assert_eq!(
            upgrade("0.23", b.clone()).unwrap(),
            b,
            "新しい MINOR は閲覧だけ（変換しない）"
        );
    }

    #[test]
    fn v0_11_drops_the_removed_emergency_reserve() {
        // 生活防衛資金（0031 の追記でなくした）の前提・プランの差分・対策に足した項目を捨て、ほかの前提・差分・控えは変えない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.11", "revisions": [], "editors": {}},
            "household": {"request": {"input": {"assumptions": {"surplusSaving": {"ratio": "0.6"}, "emergencyReserve": {"months": 6}}}}},
            "proposals": [{"id": "p1", "diffs": [
                {"key": "surplus:ratio", "item": "assumptions.surplusSaving"},
                {"key": "reserve:months", "item": "assumptions.emergencyReserve"},
                {"key": "x", "item": "assumptions.emergencyReserve"}
            ]}, {"id": "p2"}],
            "workspace": {"shownItems": ["surplus:ratio", "reserve:months"]},
            "snapshots": [{"inputs": {"request": {"input": {"assumptions": {"emergencyReserve": {"months": 6}}}}}}]
        });
        let u = upgrade("0.11", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        let a = &u["household"]["request"]["input"]["assumptions"];
        assert!(a.get("emergencyReserve").is_none());
        assert_eq!(a["surplusSaving"]["ratio"], "0.6");
        // 0.17 で差分は当て先（ここでは合成の対策）の形に、対策に足した項目は当て先に読み替わる
        assert_eq!(
            u["proposals"][0]["diffs"],
            serde_json::json!([{"op": "set", "target": {"lever": "surplusRatio"}, "item": "assumptions.surplusSaving", "at": [], "legacy": {"key": "surplus:ratio", "target": null, "item": "assumptions.surplusSaving"}}])
        );
        assert_eq!(u["proposals"][1], b["proposals"][1]);
        assert_eq!(
            u["workspace"]["shownItems"],
            serde_json::json!([{"target": {"lever": "surplusRatio"}, "item": null, "at": []}])
        );
        assert_eq!(u["snapshots"], b["snapshots"], "控えの中身は変えない");
        // 前提・プラン・対策の無い本文もそのまま
        let bare = serde_json::json!({"meta": {"formatVersion": "0.11"}, "household": {}});
        assert_eq!(
            upgrade("0.11", bare).unwrap()["household"],
            serde_json::json!({})
        );
        assert!(upgrade("0.11", serde_json::json!(null)).is_err());
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
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert!(upgrade("0.5", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_6_keeps_display_and_adds_no_columns() {
        // 並べる時点の欄は任意なので足さない（無ければ画面が既定で読む）。ほかの表示の設定はそのまま
        let b = serde_json::json!({"meta": {"formatVersion": "0.6", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "display": {"metrics": ["takeHome"], "bsGuide": {"months": [6, 12], "risk": [10, 40], "debt": 50}}});
        let u = upgrade("0.6", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        // 0.7 → 0.8 で区画へ移る（中身は同じ）
        assert_eq!(u["display"]["result"]["metrics"], b["display"]["metrics"]);
        assert_eq!(u["display"]["balance"]["guide"], b["display"]["bsGuide"]);
        assert!(u["display"]["balance"].get("columns").is_none());
        assert!(upgrade("0.6", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_7_moves_display_into_tab_sections_and_drops_dock() {
        let display = serde_json::json!({
            "metrics": ["takeHome"], "atAge": 90, "layout": "side", "invBreakdown": true, "invPeriods": null, "dock": "large",
            "bsGuide": {"months": [6, 12], "risk": [10, 40], "debt": 50},
            "bsPoints": ["now", "retire", "age75"], "bsColumns": [{"point": "now"}, {"year": 2042}],
            "ext.unknown": 1
        });
        let b = serde_json::json!({"meta": {"formatVersion": "0.7", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "display": display});
        let u = upgrade("0.7", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        let d = &u["display"];
        assert_eq!(
            d["result"],
            serde_json::json!({"metrics": ["takeHome"], "atAge": 90, "layout": "side", "invBreakdown": true, "invPeriods": null})
        );
        assert_eq!(
            d["balance"],
            serde_json::json!({"guide": {"months": [6, 12], "risk": [10, 40], "debt": 50}, "points": ["now", "retire", "age75"], "columns": [{"point": "now"}, {"year": 2042}]})
        );
        assert!(d.get("dock").is_none(), "なくした設定は持たない");
        for k in ["metrics", "bsGuide", "bsPoints", "bsColumns"] {
            assert!(d.get(k).is_none(), "{k} は区画へ移す");
        }
        assert_eq!(d["ext.unknown"], 1, "知らない欄は失わない");
        // 表示の設定の無い本文には足さない。ある値だけ移す
        let none = upgrade("0.7", serde_json::json!({"meta": {"formatVersion": "0.7"}})).unwrap();
        assert!(none.get("display").is_none());
        let some = upgrade("0.7", serde_json::json!({"display": {"atAge": 80}})).unwrap();
        assert_eq!(
            some["display"],
            serde_json::json!({"result": {"atAge": 80}, "balance": {}})
        );
        assert!(upgrade("0.7", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_16_changes_the_shapes_in_one_step() {
        // 0035 の10: 並びの要素の ID・世帯の外の家族・仮の印・プランの差分・対策に足した項目。控え・拡張領域は変えない
        let s = "11111111-1111-4111-8111-111111111111";
        let p = "22222222-2222-4222-8222-222222222222";
        let c = "33333333-3333-4333-8333-333333333333";
        let d = "44444444-4444-4444-8444-444444444444";
        let debt = "55555555-5555-4555-8555-555555555555";
        let res = "66666666-6666-4666-8666-666666666666";
        let birth = serde_json::json!({"birthYearMonth": "1980-04", "bornOnFirst": false});
        let member = |id: &str, kind: &str| serde_json::json!({"id": id, "kind": kind, "birth": birth, "sex": "female", "joins": null, "leaves": null, "expected": false});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.16", "revisions": [], "editors": {}},
            "household": {
                "request": {"trace": "none", "input": {
                    "baseMonth": "2026-10",
                    "endYear": 2080,
                    "household": {
                        "members": [member(s, "self"), member(c, "child"), member(p, "parent")],
                        "relations": [{"type": "parentOf", "parent": p, "child": s}, {"type": "parentOf", "parent": s, "child": c}],
                        "events": [], "employmentPeriods": [], "accounts": [], "insuranceContracts": [],
                        "debts": [{"id": debt, "kind": "mortgage", "principal": 30000000, "rateSchedule": [{"from": {"at": "2026-10"}, "type": "fixed", "rate": "0.008"}, {"from": {"at": "2031-10"}, "type": "fixed", "rate": "0.01"}]}],
                        "residences": [{"id": res, "kind": "own", "purchase": {"price": 40000000, "gifts": [{"recipient": c, "donor": d, "amount": 1000000}]}}],
                        "donors": [{"id": d, "kind": "grandparent", "of": s}]
                    },
                    "assumptions": {"investmentReturn": {"default": "0.02"}, "surplusSaving": {"ratio": "0.5", "changes": [{"from": {"at": "2030-01"}, "ratio": "0.3"}]}}
                }},
                "assumed": {
                    format!("housing/debt/{debt}/principal"): "物件の価格−頭金",
                    format!("family/{s}/birth"): "仮の値（40歳として計算）",
                    "unknown/key": "残る"
                }
            },
            "proposals": [{"id": "p1", "title": "プランB", "base": null, "diffs": [
                {"id": "d1", "key": format!("field:housing/debt/{debt}/principal"), "target": {"object": debt}, "item": "debt.principal", "op": "set", "value": {"value": 25000000, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 30000000, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": null},
                {"id": "d2", "key": "lever:retireAge", "target": {"member": s}, "item": "employment.to", "op": "set", "value": {"value": 65, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 60, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": false, "origin": {"kind": "manual"}, "note": null},
                {"id": "d3", "key": format!("field:housing/debt/{debt}/rate/1/rate"), "target": {"object": debt}, "item": "debt.rateSchedule", "op": "set", "value": {"value": "0.012", "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": "0.01", "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": null},
                {"id": "d4", "key": "field:weird/key", "target": {"plan": "assumptions"}, "item": "screen", "op": "set", "value": {"value": 1, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 0, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": "そのまま残る"}
            ]}],
            "workspace": {"template": null, "band": [], "base": "current", "selected": "current", "shownItems": [format!("loan:{debt}:principal"), "lever:retireAge", "nope"]},
            "snapshots": [{"inputs": {"request": {"input": {"household": {"donors": [{"id": d, "kind": "grandparent"}]}}}}}],
            "ext": {"ext.a.b": 1}
        });
        let u = upgrade("0.16", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        let h = &u["household"]["request"]["input"]["household"];
        // 世帯の外の家族: 親は印を付け（of は親とする関係の子）、贈与者は同じ ID の構成員になる。donors は無くなる
        let ms = h["members"].as_array().unwrap();
        assert_eq!(ms.len(), 4);
        assert_eq!(
            ms[2]["outside"],
            serde_json::json!({"periods": [], "of": s})
        );
        assert_eq!(ms[2]["birth"], birth, "親の生年月・同居の印などは変えない");
        assert!(ms[0].get("outside").is_none() && ms[1].get("outside").is_none());
        assert_eq!(
            ms[3],
            serde_json::json!({"id": d, "kind": "grandparent", "joins": null, "leaves": null, "expected": false, "outside": {"of": s, "periods": []}})
        );
        assert!(h.get("donors").is_none());
        assert_eq!(
            h["residences"][0]["purchase"]["gifts"][0]["donor"], d,
            "援助の贈与者はそのまま当たる"
        );
        // 並びの要素の ID は場所から決まる
        let rate1 = readings::migration_id(&format!("{debt}/rateSchedule/1"));
        assert_eq!(h["debts"][0]["rateSchedule"][1]["id"], rate1.as_str());
        assert_eq!(
            h["residences"][0]["purchase"]["gifts"][0]["id"],
            readings::migration_id(&format!("{res}/purchase/gifts/0")).as_str()
        );
        assert_eq!(
            h["relations"][0]["id"],
            readings::migration_id(&format!("relations/0/{p}/{s}")).as_str()
        );
        assert_eq!(
            u["household"]["request"]["input"]["assumptions"]["surplusSaving"]["changes"][0]["id"],
            readings::migration_id("assumptions/surplusSaving/changes/0").as_str()
        );
        // 仮の印は値の状態の欄（推定）へ。移せない印は残る
        assert_eq!(
            h["debts"][0]["valueStates"]["debt.principal"],
            serde_json::json!({"state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "derived", "basis": "物件の価格−頭金"}})
        );
        assert_eq!(
            ms[0]["valueStates"]["member.birth"]["estimate"]["method"],
            "standard"
        );
        assert_eq!(
            u["household"]["assumed"],
            serde_json::json!({"unknown/key": "残る"})
        );
        // プランの差分は当て先の形に
        let diffs = u["proposals"][0]["diffs"].as_array().unwrap();
        assert_eq!(diffs[0]["target"], serde_json::json!({"object": debt}));
        assert_eq!(diffs[0]["item"], "debt.principal");
        assert_eq!(diffs[0]["at"], serde_json::json!([]));
        assert_eq!(
            diffs[0]["legacy"]["key"],
            format!("field:housing/debt/{debt}/principal")
        );
        assert!(diffs[0].get("key").is_none());
        assert_eq!(diffs[0]["value"], b["proposals"][0]["diffs"][0]["value"]);
        assert_eq!(
            diffs[1]["target"],
            serde_json::json!({"lever": "retireAge"})
        );
        assert_eq!(diffs[1]["enabled"], false);
        assert_eq!(diffs[2]["at"], serde_json::json!([rate1, "rate"]));
        assert_eq!(diffs[3]["unresolved"], true);
        assert_eq!(diffs[3]["at"], Value::Null);
        assert_eq!(diffs[3]["note"], "そのまま残る");
        // 対策に足した項目は当て先に（読み替えられない項目は捨てる）
        assert_eq!(
            u["workspace"]["shownItems"],
            serde_json::json!([{"target": {"object": debt}, "item": "debt.principal", "at": []}, {"target": {"lever": "retireAge"}, "item": null, "at": []}])
        );
        // 開いたときの知らせ
        let notices = u["household"]["notices"].as_array().unwrap();
        assert_eq!(notices[0]["kind"], "outsideFamily");
        assert_eq!(notices[0]["members"], serde_json::json!([p]));
        assert_eq!(
            notices[1],
            serde_json::json!({"id": readings::migration_id("notices/unresolvedDiffs/1"), "kind": "unresolvedDiffs", "count": 1})
        );
        // 控え・拡張領域は1文字も変えない。同じ本文からは同じ結果
        assert_eq!(u["snapshots"], b["snapshots"]);
        assert_eq!(u["ext"], b["ext"]);
        assert_eq!(upgrade("0.16", b).unwrap(), u);
        assert!(upgrade("0.16", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_8_keeps_nursery_stage_without_monthly() {
        // 保育所の段の空の月額は書き換えない（新しい読み方で収入から自動で計算する）。足した欄は足さない
        let goals = serde_json::json!([{"id": "g", "kind": "education", "owner": "c", "education": {"stages": [{"stage": "nursery"}, {"stage": "nursery", "monthly": 0}]}}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.8", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"goals": goals}}}}, "display": {"result": {}, "balance": {}}});
        let u = upgrade("0.8", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        // 0.17 で段に ID が付くほかは同じ
        let stages =
            &u["household"]["request"]["input"]["household"]["goals"][0]["education"]["stages"];
        assert!(stages[0].get("monthly").is_none());
        assert_eq!(stages[1]["monthly"], 0);
        assert!(stages[0]["id"].is_string() && stages[1]["id"].is_string());
        assert_eq!(u["display"], b["display"]);
        assert!(upgrade("0.8", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_16_parent_without_relation_is_family_of_self_and_no_state_for_missing_places() {
        // 親とする関係の無い親・祖父母は本人の家族（0035 の4。省けるのは贈与者から作った人だけ）。
        // 無い要素・まだ入れていない欄への仮の印は、値の状態の行にしない（0035 の3）
        let s = "11111111-1111-4111-8111-111111111111";
        let g = "22222222-2222-4222-8222-222222222222";
        let l = "33333333-3333-4333-8333-333333333333";
        let birth = serde_json::json!({"birthYearMonth": "1950-04", "bornOnFirst": false});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.16", "revisions": [], "editors": {}},
            "household": {
                "request": {"trace": "none", "input": {"baseMonth": "2026-10", "endYear": 2080, "household": {
                    "members": [
                        {"id": s, "kind": "self", "birth": birth, "sex": "male", "joins": null, "leaves": null, "expected": false},
                        {"id": g, "kind": "grandparent", "birth": birth, "sex": "female", "joins": null, "leaves": null, "expected": false}
                    ],
                    "relations": [], "events": [], "employmentPeriods": [], "accounts": [], "insuranceContracts": [],
                    "livingExpenses": [{"id": l, "mode": "total", "monthly": {"value": 250000, "state": "confirmed", "origin": {"kind": "manual"}}, "stages": [{"at": {"at": "2040-04"}, "ratio": "0.8"}]}]
                }}},
                "assumed": {format!("living/{l}/stage/0/ratio"): "仮の割合", format!("living/{l}/stage/3/ratio"): "無い段"}
            },
            "proposals": []
        });
        let u = upgrade("0.16", b).unwrap();
        let h = &u["household"]["request"]["input"]["household"];
        assert_eq!(h["members"][1]["outside"]["of"], s);
        let states = &h["livingExpenses"][0]["valueStates"];
        let keys: Vec<&String> = states.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 1, "{keys:?}");
        assert!(u["household"].get("assumed").is_none());
        assert!(
            crate::readings::value_state_problems(&u["household"]["request"]["input"]).is_empty()
        );
    }
}
