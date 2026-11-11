//! AIのプランの候補（0015 の7）。外から来た候補（0008。画面では「AIからの候補」）に承認待ちで入るだけで、世帯のデータは1文字も変えない。
//! 形は提案の差分と同じ（対象の物の ID・入力項目ID・新しい値）。変えられるのは入力値と前提条件だけ。
//! 同じ対象・同じ入力項目ID で場所だけが違う欄は、場所を添えて選ぶ（0201）: 入力の欄の場所 `at`（プランの差分の当て先の `at` と同じ。
//! 並びの要素は ID、欄は名前）か、合成の対策の名前 `lever`（差分の向き先 `lever` と同じ）のどちらか1つ。どちらも無い候補は今までと同じ。

use crate::reduce::{allowlist, Pseudonyms, TEXT_ITEMS};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_TITLE_CHARS: usize = 100;
pub const MAX_SUMMARY_CHARS: usize = 2000;
pub const MAX_NOTE_CHARS: usize = 500;
pub const MAX_CHANGES: usize = 50;
pub const MAX_PROPOSAL_BYTES: usize = 50 * 1024;
/// 場所 `at` の段の数と、1段の文字数の上限（0201）
pub const MAX_AT_STEPS: usize = 16;
pub const MAX_AT_STEP_CHARS: usize = 100;
/// 合成の対策の名前 `lever` の文字数の上限（英数字だけ。0201）
pub const MAX_LEVER_CHARS: usize = 64;

/// 前提条件を指す対象
pub const ASSUMPTIONS_TARGET: &str = "assumptions";

/// アプリ本体が受け取る、承認待ちのプランの候補
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingProposal {
    /// 候補の ID（AIに渡した記録の `proposals` の `candidateId`）
    pub candidate_id: String,
    pub share_id: String,
    pub household_id: String,
    pub received_at: String,
    /// AIが書いた文章（人の指示ではないが、画面では信用しない文章として扱う。0016）
    pub title: String,
    pub summary: String,
    pub diffs: Vec<ProposedDiff>,
    /// 出どころ（いつも `ai`）と、MCP のあいさつでAIのアプリが名乗った名前（自己申告）
    pub origin: ProposalOrigin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedDiff {
    pub id: String,
    /// 物の ID（元の ID に戻したもの）か `{"plan":"assumptions"}`
    pub target: Value,
    pub item: String,
    /// 入力の欄の場所（0201。並びの要素の ID は元の ID に戻したもの）。場所を添えない候補には無い（前の版の候補と同じ形）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Vec<String>>,
    /// 合成の対策の名前（0201）。場所を添えない候補には無い
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lever: Option<String>,
    pub op: String,
    pub value: Value,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalOrigin {
    pub kind: String,
    pub connector: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProposal {
    title: String,
    #[serde(default)]
    summary: String,
    changes: Vec<RawChange>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawChange {
    target: String,
    item: String,
    #[serde(default)]
    at: Option<Vec<String>>,
    #[serde(default)]
    lever: Option<String>,
    value: Value,
    #[serde(default)]
    note: Option<String>,
}

/// プランの候補を確かめ、物の ID を元に戻す。外れたら FPに見せてよい理由（`INVALID`）
pub(crate) fn validate(
    proposal: &Value,
    pseudonyms: &Pseudonyms,
) -> Result<(String, String, Vec<ProposedDiff>), String> {
    let bytes = serde_json::to_vec(proposal)
        .map(|b| b.len())
        .unwrap_or(usize::MAX);
    if bytes > MAX_PROPOSAL_BYTES {
        return Err(format!(
            "プランの候補が大きすぎます（{MAX_PROPOSAL_BYTES} バイトまで）"
        ));
    }
    let raw: RawProposal = serde_json::from_value(proposal.clone())
        .map_err(|e| format!("プランの候補の形が違います: {e}"))?;
    if raw.title.trim().is_empty() || raw.title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("題名は1〜{MAX_TITLE_CHARS}文字にしてください"));
    }
    if raw.summary.chars().count() > MAX_SUMMARY_CHARS {
        return Err(format!("説明は{MAX_SUMMARY_CHARS}文字までにしてください"));
    }
    if raw.changes.is_empty() || raw.changes.len() > MAX_CHANGES {
        return Err(format!("変更は1〜{MAX_CHANGES}件にしてください"));
    }
    let allow = &allowlist().items;
    let mut diffs = Vec::with_capacity(raw.changes.len());
    for (i, c) in raw.changes.into_iter().enumerate() {
        let n = i + 1;
        if TEXT_ITEMS.iter().any(|(t, _)| *t == c.item) || !allow.contains(&c.item) {
            return Err(format!(
                "{n}件目: 入力項目ID {} はプランの候補で変えられません（変えられるのは入力値と前提条件だけ）",
                c.item
            ));
        }
        if c.note
            .as_ref()
            .is_some_and(|s| s.chars().count() > MAX_NOTE_CHARS)
        {
            return Err(format!(
                "{n}件目: 理由は{MAX_NOTE_CHARS}文字までにしてください"
            ));
        }
        let (at, lever) = place(n, c.at, c.lever, pseudonyms)?;
        let is_assumption = c.item.starts_with("assumptions.");
        let target = if c.target == ASSUMPTIONS_TARGET {
            // 場所を添えた変更は、世帯で1つの欄・対策（資産運用の積立・相続税の目安の欄など）を、前提を対象にして指せる（0201）
            if !is_assumption && at.is_none() && lever.is_none() {
                return Err(format!(
                    "{n}件目: target が assumptions のときは、前提条件の項目（assumptions.〜）だけを指せます"
                ));
            }
            serde_json::json!({ "plan": ASSUMPTIONS_TARGET })
        } else {
            if is_assumption {
                return Err(format!(
                    "{n}件目: 前提条件の項目は target を assumptions にしてください"
                ));
            }
            match pseudonyms.original(&c.target) {
                Some(orig) => serde_json::json!({ "object": orig }),
                None => {
                    return Err(format!(
                        "{n}件目: target の物 {} はこの共有の世帯にありません",
                        c.target
                    ))
                }
            }
        };
        let value = pseudonyms
            .restore(&c.value)
            .map_err(|id| format!("{n}件目: 値の中の ID {id} はこの共有の世帯にありません"))?;
        diffs.push(ProposedDiff {
            id: crate::reduce::random_uuid_v4(),
            target,
            item: c.item,
            at,
            lever,
            op: "set".to_owned(),
            value,
            note: c.note,
        });
    }
    Ok((raw.title, raw.summary, diffs))
}

/// 候補の場所（0201）を確かめ、`at` の中の仮名を元の ID に戻す。`at` と `lever` はどちらか1つ
fn place(
    n: usize,
    at: Option<Vec<String>>,
    lever: Option<String>,
    pseudonyms: &Pseudonyms,
) -> Result<(Option<Vec<String>>, Option<String>), String> {
    if at.is_some() && lever.is_some() {
        return Err(format!(
            "{n}件目: 場所は at か lever のどちらか1つにしてください（list_plan_items が添えた方）"
        ));
    }
    let at = match at {
        None => None,
        Some(steps) => {
            if steps.len() > MAX_AT_STEPS
                || steps
                    .iter()
                    .any(|s| s.is_empty() || s.chars().count() > MAX_AT_STEP_CHARS)
            {
                return Err(format!(
                    "{n}件目: at は{MAX_AT_STEPS}段まで・1段1〜{MAX_AT_STEP_CHARS}文字にしてください"
                ));
            }
            let mut out = Vec::with_capacity(steps.len());
            for s in steps {
                if crate::reduce::is_uuid(&s) {
                    match pseudonyms.original(&s) {
                        Some(o) => out.push(o.to_owned()),
                        None => {
                            return Err(format!(
                                "{n}件目: at の中の ID {s} はこの共有の世帯にありません"
                            ))
                        }
                    }
                } else {
                    out.push(s);
                }
            }
            Some(out)
        }
    };
    if let Some(l) = &lever {
        if l.is_empty()
            || l.len() > MAX_LEVER_CHARS
            || !l.bytes().all(|b| b.is_ascii_alphanumeric())
        {
            return Err(format!(
                "{n}件目: lever は英数字の1〜{MAX_LEVER_CHARS}文字にしてください（list_plan_items が添えた名前）"
            ));
        }
    }
    Ok((at, lever))
}
