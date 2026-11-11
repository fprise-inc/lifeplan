//! アプリ本体が共有のために渡す世帯（復号した後のもの。復号はアプリ本体だけが行う。0015 の5）。
//!
//! どの版でも渡さないもの（世帯の内部ID・表示用の顧客番号・呼び名・同意の記録の中身など）は、
//! 下の型の別の欄に置き、縮約の部品はその欄を読まない（出力に入る経路が無い）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 共有する世帯
#[derive(Debug, Clone)]
pub struct SharedHouseholdSource {
    /// 世帯の内部ID（0012。AIには渡さない。記録と共有の台帳だけに使う）
    pub household_id: String,
    /// 表示用の顧客番号（0012。AIには渡さない。共有中の帯の表示のためにアプリが持つ）
    pub customer_number: Option<String>,
    /// 世帯の改訂のID（0011。AIに渡した記録の householdRevision）
    pub revision: String,
    /// 計算の入力（エンジンへの要求の `input`。0008）
    pub input: Value,
    /// 画面の側の文章（FPのメモ・顧客の相談内容・移行メモ・自由記述）。既定で外し、FPが項目ごとに足せる
    pub texts: Vec<SourceText>,
    /// FPが付ける呼び名（0012 の追記。どの版でも渡さない）
    pub labels_by_member: Option<Value>,
    /// 定年後の働き方の条件（世帯ファイルの `household.postRetirement`。構成員の ID → 定年の年齢・定年後の働き方・年収・標準報酬月額）。
    /// 計算の入力の外にある画面の側の値で、縮約の部品が数と選択肢だけを確かめて渡す（0195）
    pub post_retirement: Option<Value>,
    /// この世帯の外部AIへの提供の同意の、今の状態（0014 の2。共有の前の確認に使う）
    pub external_ai_consent: Option<ConsentRef>,
    /// 架空の世帯（AIの候補から「架空」として作った世帯。お客さまの情報を含まないので、同意の記録が無くても渡せる。
    /// 期限・取り消し・記録・縮約版の決まりは同じ）。印は世帯の一覧の札にアプリ本体だけが書く（画面からは付けられない）
    pub fictional: bool,
}

/// 画面の側の文章の1件
#[derive(Debug, Clone)]
pub struct SourceText {
    /// 項目（`note.fp`・`note.consultation`・`note.import`・`note.free`）
    pub item: String,
    /// 誰が書いた文章か（「顧客」「FP（メモ）」など）
    pub author: String,
    pub body: String,
    /// 関係する物の ID（あれば）
    pub object: Option<String>,
}

/// 同意の記録の今の状態（その種類の最新の行。0014 の2）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRef {
    pub decision: ConsentDecision,
    /// 参照した同意の記録の `id`
    pub record_id: String,
    /// 書類を AI に渡すことを含む説明（版2〜）での同意か（`given` のときだけ true。0157）。
    /// false の世帯は、計算に要る項目は渡せるが、書類から読んだ値の候補（`propose_inputs`）は受けない
    #[serde(default)]
    pub documents: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentDecision {
    Given,
    Refused,
    Withdrawn,
}
