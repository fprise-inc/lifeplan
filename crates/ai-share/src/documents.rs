//! AIが書類から読んだ値の候補（0151。答えの形 `document-candidates@1`。0148 の4）。
//!
//! - 接続口の道具 `propose_inputs` から届いた答えを、アプリのメモリの中に承認待ちで置くだけ。世帯のデータは1文字も変えない
//! - ここでは形の外側（答えの形の名前・候補の数・大きさ）だけを確かめ、物と人の仮の ID を元の ID に戻す。
//!   欄ごとの確かめ（登録簿にある入力項目か・場所の書き方・値の形）と、個人番号などの番号を落とす決まりは、
//!   画面の読み口（`app/src/workspace/documents/proposal.ts` の `readProposal`）の1か所で行う（読み手・貼り付けと同じ決まりにするため）
//! - 届いた答えそのものは世帯ファイルに書かない（番号が混ざっていても残さないため）。画面が読み口を通して読み取りの記録
//!   （本文の区画 `documents`）にしてから、承認待ちから外す（`take_document_proposal`）。アプリを閉じると、画面が受け取っていない答えは消える
//! - 届いたこと（候補の ID と日時）は、AIに渡した記録の `proposals` に残す（プランの候補と同じ置き方。読み取りの記録の ID と同じ ID）

use crate::reduce::Pseudonyms;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 答えの形の名前（画面の読み口の `PROPOSAL_CONTRACT` と同じ）
pub const CONTRACT: &str = "document-candidates@1";
/// 値の候補の上限（読み口の `LIMITS.candidates` と同じ）
pub const MAX_VALUES: usize = 300;
/// 新しい物の候補の上限（読み口の `LIMITS.objects` と同じ）
pub const MAX_OBJECTS: usize = 30;
/// 照合だけの値の上限（読み口の `LIMITS.references` と同じ）
pub const MAX_REFERENCES: usize = 60;
/// 答え全体の大きさの上限（JSON にしたときのバイト数。内部の値）
pub const MAX_ANSWER_BYTES: usize = 256 * 1024;
/// 1つの世帯で、画面が受け取るまで承認待ちにしておける答えの数（内部の値）
pub const MAX_PENDING_PER_HOUSEHOLD: usize = 20;

/// アプリ本体が受け取る、承認待ちの書類の候補（届いた答えを、仮の ID を元に戻しただけのもの）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDocumentProposal {
    /// 候補の ID（AIに渡した記録の `proposals` の `candidateId`。画面はこの ID を読み取りの記録の ID にする）
    pub candidate_id: String,
    pub share_id: String,
    pub household_id: String,
    pub received_at: String,
    /// MCP のあいさつでAIのアプリが名乗った名前（自己申告。認証ではない）
    pub connector: Option<String>,
    /// 届いた答え（`document-candidates@1`。信用しない。画面の読み口で確かめてから使う）
    pub answer: Value,
}

/// 届いた答えの数（AIに返す）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnswerCounts {
    pub values: usize,
    pub objects: usize,
    pub references: usize,
}

fn len_of(answer: &serde_json::Map<String, Value>, key: &str) -> Result<usize, String> {
    match answer.get(key) {
        None | Some(Value::Null) => Ok(0),
        Some(Value::Array(a)) => Ok(a.len()),
        Some(_) => Err(format!("{key} は配列にしてください")),
    }
}

/// 答えの外側を確かめ、仮の ID を元に戻す。外れたら AI に見せてよい理由（`INVALID`。値・文字は入れない）
pub(crate) fn validate(
    answer: &Value,
    pseudonyms: &Pseudonyms,
) -> Result<(Value, AnswerCounts), String> {
    let bytes = serde_json::to_vec(answer)
        .map(|b| b.len())
        .unwrap_or(usize::MAX);
    if bytes > MAX_ANSWER_BYTES {
        return Err(format!(
            "答えが大きすぎます（{MAX_ANSWER_BYTES} バイトまで。書類を分けて出してください）"
        ));
    }
    let Value::Object(m) = answer else {
        return Err("answer は物（JSON の object）にしてください".into());
    };
    if m.get("contract").and_then(Value::as_str) != Some(CONTRACT) {
        return Err(format!("answer.contract は \"{CONTRACT}\" にしてください"));
    }
    let counts = AnswerCounts {
        values: len_of(m, "values")?,
        objects: len_of(m, "objects")?,
        references: len_of(m, "references")?,
    };
    if counts.values > MAX_VALUES {
        return Err(format!(
            "値の候補は{MAX_VALUES}件までです（書類を分けて出してください）"
        ));
    }
    if counts.objects > MAX_OBJECTS {
        return Err(format!("新しい物の候補は{MAX_OBJECTS}件までです"));
    }
    if counts.references > MAX_REFERENCES {
        return Err(format!("照合だけの値は{MAX_REFERENCES}件までです"));
    }
    if counts.values + counts.references == 0 {
        return Err("値の候補（values）か照合だけの値（references）を1件以上入れてください".into());
    }
    // 物・人の ID は、get_shared_household で渡した仮の ID だけを使える（元の ID に戻す。知らない ID があれば受けない）
    let restored = pseudonyms.restore(answer).map_err(|_| {
        "答えの中に、この共有の世帯に無い ID があります（物・人の ID は get_shared_household の仮の ID を使い、新しい物は objects の key で指してください）".to_owned()
    })?;
    Ok((restored, counts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn empty() -> Pseudonyms {
        Pseudonyms::for_input(&json!({}))
    }

    fn answer() -> Value {
        json!({
            "contract": CONTRACT,
            "docType": "withholdingSlip",
            "values": [{ "item": "employment.salary.annual", "member": "holder", "value": 5_200_000 }]
        })
    }

    #[test]
    fn accepts_the_answer_shape() {
        let (v, n) = validate(&answer(), &empty()).unwrap();
        assert_eq!(v, answer());
        assert_eq!(
            n,
            AnswerCounts {
                values: 1,
                objects: 0,
                references: 0
            }
        );
    }

    #[test]
    fn refuses_other_shapes_and_limits() {
        let mut a = answer();
        a["contract"] = json!("document-candidates@2");
        assert!(validate(&a, &empty()).unwrap_err().contains("contract"));
        assert!(validate(&json!([1]), &empty()).is_err());
        let mut a = answer();
        a["values"] = json!([]);
        assert!(validate(&a, &empty()).is_err(), "候補が無い");
        let mut a = answer();
        a["values"] = Value::Array(vec![json!({ "item": "x", "value": 1 }); MAX_VALUES + 1]);
        assert!(validate(&a, &empty()).unwrap_err().contains("300"));
        let mut a = answer();
        a["objects"] = json!("c1");
        assert!(validate(&a, &empty()).is_err());
        let mut a = answer();
        a["values"][0]["note"] = json!("あ".repeat(MAX_ANSWER_BYTES / 3 + 10));
        assert!(validate(&a, &empty()).unwrap_err().contains("大きすぎ"));
    }

    #[test]
    fn restores_pseudonyms_and_refuses_unknown_ids() {
        let orig = "00000000-0000-4000-8000-0000000000aa";
        let input = json!({ "household": { "members": [{ "id": orig }] } });
        let mut p = Pseudonyms::for_input(&input);
        let shown = p.apply(&input);
        let alias = shown["household"]["members"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut a = answer();
        a["values"][0]["member"] = json!(alias);
        let (v, _) = validate(&a, &p).unwrap();
        assert_eq!(v["values"][0]["member"], orig);
        a["values"][0]["object"] = json!("11111111-2222-4333-8444-555555555555");
        assert!(validate(&a, &p).unwrap_err().contains("ID"));
    }
}
