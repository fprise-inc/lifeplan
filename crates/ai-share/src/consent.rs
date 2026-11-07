//! 同意の記録（世帯ファイルの区画 `consents`。0014 の2）。
//!
//! - 記録は追記だけ。撤回や訂正は新しい行として足す（既存の行は書き換えない・消さない）。
//!   アプリ本体が世帯ファイルに書き戻すときは `verify_consents_append_only` で前の記録と比べる。
//! - 種類ごとの「今の状態」は、その種類の最新の行で決まる（`given` の後に `withdrawn` があれば撤回済み）。
//! - 引き継ぎで受け取った行（`previousOffice`）は、この事務所の今の状態に数えない（0014 の5）。
//! - 説明に使った文面は指紋（`explanationRef`）で指し、文面そのものは世帯ファイルに1回だけ写す（0014 の4。区画 `consentExplanations`）。
//!
//! 外部AIへの提供（`externalAi`）の同意は、AIとの共有の前の確認に使う。アプリはこの同意が `given` の世帯だけを渡せる
//! （0014 の6 は「警告して FP の判断で続けられる」だが、この版では最も保守的に、同意の無い世帯は渡せないようにした）。
//!
//! 説明文は版2から、書類の読み取りで書類（お名前・番号を伏せたもの）を AI に渡すことを含む（0157）。版1の説明で同意した世帯は、
//! 計算に要る項目（縮約版）を渡すことにはそのまま使えるが、書類を AI に渡す操作（貼り付け・接続口の書類の候補）の前に、
//! 今の版の説明で同意を取り直す（`ConsentRecord::documents`）。

use crate::source::{ConsentDecision, ConsentRef};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 外部AIへの提供の同意を得るときに見せる説明文（版2。書類の読み取りの段落を足した。0157）。
/// 事務所の設定で書き換えられるようにするのは後の版（0014 の4・未確定）
pub const EXTERNAL_AI_EXPLANATION: &str = "ご相談の内容をもとにしたライフプランの計算や見直しの検討に、FPが契約している外部のAI（生成AIのサービス）を使うことがあります。\n計算や見直しの検討でAIに渡すのは、計算に必要な項目（生年月・収入・支出・資産・ローン・保険などの数字）だけです。お名前・ご住所・お電話番号などの、あなたを特定できる情報や、FPのメモは渡しません。\n担当のFPは、保険証券やねんきん定期便などの書類から数字を読み取るときに、AIを使うことがあります。AIに渡すのは読み取りに必要な部分だけで、お名前・ご住所・各種の番号は伏せてから渡します。AIが読み取った数字は、担当のFPが書類と見比べて確かめてから使います。使うAIサービスの扱いは、そのサービスの利用規約とプライバシーポリシーに沿います。\nAIの会社は国外にあることがあります。FPは、渡した情報がAIの学習に使われない設定であることを確かめて使います。\nAIに渡した日時と項目は、この世帯の記録に残ります。この同意はいつでも撤回でき、撤回した後はAIに渡しません（すでに渡した内容は、AIの会社の側に残ることがあります）。";

/// 説明文の版（画面に出す。版ごとの文面は指紋で区別する。0157）
pub const EXTERNAL_AI_EXPLANATION_VERSION: u32 = 2;

/// 版1の説明文（書類の読み取りを含まない）。この文で同意した記録は、書類を AI に渡すことに使わない（0157）
pub const EXTERNAL_AI_EXPLANATION_V1: &str = "ご相談の内容をもとにしたライフプランの計算や見直しの検討に、FPが契約している外部のAI（生成AIのサービス）を使うことがあります。\nAIに渡すのは、計算に必要な項目（生年月・収入・支出・資産・ローン・保険などの数字）だけです。お名前・ご住所・お電話番号などの、あなたを特定できる情報や、FPのメモは渡しません。\nAIの会社は国外にあることがあります。FPは、渡した情報がAIの学習に使われない設定であることを確かめて使います。\nAIに渡した日時と項目は、この世帯の記録に残ります。この同意はいつでも撤回でき、撤回した後はAIに渡しません（すでに渡した内容は、AIの会社の側に残ることがあります）。";

/// 説明文の指紋（`sha256:` ＋16進）
pub fn explanation_ref(text: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(text.as_bytes()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentKind {
    /// 利用目的の確認
    Purpose,
    /// 外部AIへの提供
    ExternalAi,
    /// 家族の情報の扱い
    FamilyInfo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentMethod {
    /// ヒアリングシートの同意欄
    HearingSheet,
    /// 紙の書面
    Paper,
    /// 面談で口頭
    InPerson,
    Email,
    Other,
}

impl ConsentMethod {
    pub fn parse(s: &str) -> Option<ConsentMethod> {
        Some(match s {
            "hearingSheet" => ConsentMethod::HearingSheet,
            "paper" => ConsentMethod::Paper,
            "inPerson" => ConsentMethod::InPerson,
            "email" => ConsentMethod::Email,
            "other" => ConsentMethod::Other,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConsentOrigin {
    /// この事務所で取った
    #[default]
    ThisOffice,
    /// 引き継ぎで受け取った（読み取り専用。この事務所の今の状態に数えない）
    PreviousOffice,
}

/// 外部AIへの提供の同意の、提供先（0014 の2 の `externalAi`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAiInfo {
    /// 提供先のAIの会社（FPの申告）
    pub company: String,
    /// 所在国（FPの申告）
    pub country: String,
    /// FPが「学習に使われない設定」を確かめたか
    pub no_training_confirmed: bool,
}

/// 訂正のとき: 訂正する記録の `id` と理由
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Supersedes {
    pub id: String,
    pub reason: String,
}

/// 同意の記録の1行（0014 の2）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecord {
    pub id: String,
    pub kind: ConsentKind,
    pub decision: ConsentDecision,
    /// 同意を得た（撤回を受けた）日付 `YYYY-MM-DD`
    pub obtained_on: String,
    pub method: ConsentMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hearing_ref: Option<serde_json::Value>,
    /// 説明に使った文面の指紋
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_ai: Option<ExternalAiInfo>,
    /// 渡してよい範囲（`reduced` ＝ 計算に要る項目だけの縮約版。この版では縮約版だけ。0014 に足した項目）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// 書類の読み取りで、書類（お名前・番号を伏せたもの）を AI に渡すことを含む説明（版2〜）で同意した（0157）。
    /// 無い（版1の説明で同意した）記録は、書類を AI に渡す操作に使わない。`given` の行だけに付く
    #[serde(default, skip_serializing_if = "is_false")]
    pub documents: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<Supersedes>,
    /// FPが、説明文を見せて同意（撤回）を確かめたことを画面で確かめた（0014 に足した項目）
    #[serde(default)]
    pub fp_confirmed: bool,
    /// 記録した日時（UTC の ISO 8601）
    pub recorded_at: String,
    #[serde(default)]
    pub origin: ConsentOrigin,
    /// 記録を書いた人（事務所で共有しているときのメンバー。0023 の6。共有していなければ書かない）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorded_by: Option<Author>,
}

/// 書いた人（事務所のメンバーの内部IDと表示名。表示名は FP 自身の名前で、顧客の識別子ではない。0023 の6）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub member_id: String,
    pub name: String,
}

/// 画面から届く、外部AIへの提供の同意（撤回）の入力
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAiConsentInput {
    /// `given`／`refused`／`withdrawn`
    pub decision: ConsentDecision,
    pub obtained_on: String,
    /// `paper`／`inPerson`／`email`／`hearingSheet`／`other`
    pub method: String,
    #[serde(default)]
    pub company: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub no_training_confirmed: bool,
    #[serde(default)]
    pub fp_confirmed: bool,
}

/// 渡してよい範囲の名前（この版では縮約版だけ）
pub const SCOPE_REDUCED: &str = "reduced";

pub const MAX_COMPANY_CHARS: usize = 60;
pub const MAX_COUNTRY_CHARS: usize = 30;

fn is_false(b: &bool) -> bool {
    !*b
}

/// 外部AIへの提供の同意の今の状態（この事務所の行のうち、最新の行）
pub fn current_external_ai(records: &[ConsentRecord]) -> Option<ConsentRef> {
    records
        .iter()
        .rev()
        .find(|r| r.kind == ConsentKind::ExternalAi && r.origin == ConsentOrigin::ThisOffice)
        .map(|r| ConsentRef {
            decision: r.decision,
            record_id: r.id.clone(),
            documents: r.decision == ConsentDecision::Given && r.documents,
        })
}

/// `YYYY-MM-DD` として正しいか（暦として成り立つか）
pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (
        s[0..4].parse::<u32>(),
        s[5..7].parse::<u32>(),
        s[8..10].parse::<u32>(),
    ) else {
        return false;
    };
    if !(1900..=2999).contains(&y) || !(1..=12).contains(&m) || d == 0 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    d <= days[(m - 1) as usize]
}

/// 画面の入力から同意の記録の1行を作る。外れたら画面に出す符号（`E_AI_CONSENT_…`）。
/// `today` は今日の日付（`YYYY-MM-DD`。未来の日付を止める）、`now` は記録した日時
pub fn new_external_ai_record(
    existing: &[ConsentRecord],
    input: &ExternalAiConsentInput,
    today: &str,
    now: &str,
) -> Result<ConsentRecord, &'static str> {
    if !is_date(&input.obtained_on) {
        return Err("E_AI_CONSENT_DATE");
    }
    if input.obtained_on.as_str() > today {
        return Err("E_AI_CONSENT_DATE_FUTURE");
    }
    let method = ConsentMethod::parse(&input.method).ok_or("E_AI_CONSENT_METHOD")?;
    if !input.fp_confirmed {
        return Err("E_AI_CONSENT_FP_CONFIRM");
    }
    let current = current_external_ai(existing);
    let current_decision = current.as_ref().map(|c| c.decision);
    let external_ai = match input.decision {
        ConsentDecision::Given => {
            let company = input.company.trim();
            let country = input.country.trim();
            if company.is_empty() || company.chars().count() > MAX_COMPANY_CHARS {
                return Err("E_AI_CONSENT_COMPANY");
            }
            if country.is_empty() || country.chars().count() > MAX_COUNTRY_CHARS {
                return Err("E_AI_CONSENT_COUNTRY");
            }
            // 同意がもうあっても、版1の説明（書類を含まない）の同意なら、今の版の説明で取り直せる（0157）
            if current.as_ref().is_some_and(|c| c.documents) {
                return Err("E_AI_CONSENT_ALREADY");
            }
            Some(ExternalAiInfo {
                company: company.to_owned(),
                country: country.to_owned(),
                no_training_confirmed: input.no_training_confirmed,
            })
        }
        ConsentDecision::Withdrawn => {
            if current_decision != Some(ConsentDecision::Given) {
                return Err("E_AI_CONSENT_NOT_GIVEN");
            }
            None
        }
        ConsentDecision::Refused => None,
    };
    Ok(ConsentRecord {
        id: crate::reduce::random_uuid_v4(),
        kind: ConsentKind::ExternalAi,
        decision: input.decision,
        obtained_on: input.obtained_on.clone(),
        method,
        hearing_ref: None,
        explanation_ref: Some(explanation_ref(EXTERNAL_AI_EXPLANATION)),
        external_ai,
        scope: (input.decision == ConsentDecision::Given).then(|| SCOPE_REDUCED.to_owned()),
        documents: input.decision == ConsentDecision::Given,
        members: None,
        supersedes: None,
        fp_confirmed: true,
        recorded_at: now.to_owned(),
        origin: ConsentOrigin::ThisOffice,
        recorded_by: None,
    })
}

/// 追記だけかどうかを確かめる（`after` が `before` の後ろに足しただけなら Ok）
pub fn verify_consents_append_only(
    before: &[ConsentRecord],
    after: &[ConsentRecord],
) -> Result<(), String> {
    if after.len() < before.len() {
        return Err("同意の記録の行が減っています".into());
    }
    for (i, (b, a)) in before.iter().zip(after.iter()).enumerate() {
        if b != a {
            return Err(format!("同意の記録の {i} 行目が書き換えられています"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(decision: ConsentDecision) -> ExternalAiConsentInput {
        ExternalAiConsentInput {
            decision,
            obtained_on: "2026-10-19".into(),
            method: "paper".into(),
            company: "架空AI株式会社".into(),
            country: "日本".into(),
            no_training_confirmed: true,
            fp_confirmed: true,
        }
    }

    #[test]
    fn dates_are_checked() {
        assert!(is_date("2026-10-19"));
        assert!(is_date("2028-02-29"));
        assert!(!is_date("2026-02-29"));
        assert!(!is_date("2026-13-01"));
        assert!(!is_date("2026/10/19"));
        assert!(!is_date("20261019"));
    }

    #[test]
    fn the_latest_row_decides_and_previous_office_rows_do_not_count() {
        let now = "2026-10-19T00:00:00Z";
        let mut v = vec![];
        assert_eq!(current_external_ai(&v), None);
        let given =
            new_external_ai_record(&v, &input(ConsentDecision::Given), "2026-10-19", now).unwrap();
        v.push(given.clone());
        assert_eq!(
            current_external_ai(&v).unwrap().decision,
            ConsentDecision::Given
        );
        assert_eq!(given.scope.as_deref(), Some(SCOPE_REDUCED));
        assert_eq!(
            given.explanation_ref,
            Some(explanation_ref(EXTERNAL_AI_EXPLANATION))
        );
        // 同じ同意を2回は記録しない
        assert_eq!(
            new_external_ai_record(&v, &input(ConsentDecision::Given), "2026-10-19", now),
            Err("E_AI_CONSENT_ALREADY")
        );
        let w = new_external_ai_record(&v, &input(ConsentDecision::Withdrawn), "2026-10-19", now)
            .unwrap();
        v.push(w);
        assert_eq!(
            current_external_ai(&v).unwrap().decision,
            ConsentDecision::Withdrawn
        );
        // 撤回は同意のある世帯だけ
        assert_eq!(
            new_external_ai_record(&v, &input(ConsentDecision::Withdrawn), "2026-10-19", now),
            Err("E_AI_CONSENT_NOT_GIVEN")
        );
        // 引き継ぎで受け取った行は数えない
        let mut prev = given.clone();
        prev.origin = ConsentOrigin::PreviousOffice;
        assert_eq!(current_external_ai(&[prev]), None);
    }

    #[test]
    fn consents_on_the_first_explanation_do_not_cover_documents_and_can_be_renewed() {
        let now = "2026-11-07T00:00:00Z";
        // 版1の説明で同意した行（documents の欄が無い。前の版のアプリが書いた形）
        let old: ConsentRecord = serde_json::from_value(serde_json::json!({
            "id": "c-old", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-10-19", "method": "paper",
            "explanationRef": explanation_ref(EXTERNAL_AI_EXPLANATION_V1),
            "externalAi": {"company": "架空AI株式会社", "country": "日本", "noTrainingConfirmed": true},
            "scope": "reduced", "fpConfirmed": true, "recordedAt": "2026-10-19T00:00:00Z", "origin": "thisOffice"
        }))
        .unwrap();
        assert!(!old.documents);
        // 読んで書き戻しても形は変わらない（documents の欄を足さない）
        assert!(serde_json::to_value(&old)
            .unwrap()
            .get("documents")
            .is_none());
        let mut v = vec![old];
        let c = current_external_ai(&v).unwrap();
        assert_eq!(c.decision, ConsentDecision::Given);
        assert!(!c.documents);
        // 今の版の説明で取り直せる（同意がもうあっても）
        let renewed =
            new_external_ai_record(&v, &input(ConsentDecision::Given), "2026-11-07", now).unwrap();
        assert!(renewed.documents);
        assert_eq!(
            renewed.explanation_ref,
            Some(explanation_ref(EXTERNAL_AI_EXPLANATION))
        );
        assert_ne!(
            explanation_ref(EXTERNAL_AI_EXPLANATION),
            explanation_ref(EXTERNAL_AI_EXPLANATION_V1)
        );
        v.push(renewed);
        assert!(current_external_ai(&v).unwrap().documents);
        // 今の版で取った後は、2回は記録しない
        assert_eq!(
            new_external_ai_record(&v, &input(ConsentDecision::Given), "2026-11-07", now),
            Err("E_AI_CONSENT_ALREADY")
        );
        // 撤回の行は書類を含まない
        let w = new_external_ai_record(&v, &input(ConsentDecision::Withdrawn), "2026-11-07", now)
            .unwrap();
        assert!(!w.documents);
        v.push(w);
        assert!(!current_external_ai(&v).unwrap().documents);
        // 説明文の版2は、書類の段落と、利用規約・プライバシーポリシーの言葉を持つ
        assert!(EXTERNAL_AI_EXPLANATION.contains("書類から数字を読み取るときに"));
        assert!(EXTERNAL_AI_EXPLANATION.contains("利用規約とプライバシーポリシー"));
        assert_eq!(
            EXTERNAL_AI_EXPLANATION.lines().next(),
            EXTERNAL_AI_EXPLANATION_V1.lines().next()
        );
    }

    #[test]
    fn inputs_are_checked() {
        let now = "2026-10-19T00:00:00Z";
        let mut i = input(ConsentDecision::Given);
        i.fp_confirmed = false;
        assert_eq!(
            new_external_ai_record(&[], &i, "2026-10-19", now),
            Err("E_AI_CONSENT_FP_CONFIRM")
        );
        let mut i = input(ConsentDecision::Given);
        i.obtained_on = "2026-10-20".into();
        assert_eq!(
            new_external_ai_record(&[], &i, "2026-10-19", now),
            Err("E_AI_CONSENT_DATE_FUTURE")
        );
        let mut i = input(ConsentDecision::Given);
        i.method = "telepathy".into();
        assert_eq!(
            new_external_ai_record(&[], &i, "2026-10-19", now),
            Err("E_AI_CONSENT_METHOD")
        );
        let mut i = input(ConsentDecision::Given);
        i.company = "  ".into();
        assert_eq!(
            new_external_ai_record(&[], &i, "2026-10-19", now),
            Err("E_AI_CONSENT_COMPANY")
        );
    }

    #[test]
    fn rewriting_consents_is_refused() {
        let now = "2026-10-19T00:00:00Z";
        let r =
            new_external_ai_record(&[], &input(ConsentDecision::Given), "2026-10-19", now).unwrap();
        let before = vec![r.clone()];
        let mut after = before.clone();
        after.push(
            new_external_ai_record(
                &before,
                &input(ConsentDecision::Withdrawn),
                "2026-10-19",
                now,
            )
            .unwrap(),
        );
        assert!(verify_consents_append_only(&before, &after).is_ok());
        let mut changed = before.clone();
        changed[0].decision = ConsentDecision::Refused;
        assert!(verify_consents_append_only(&before, &changed).is_err());
        assert!(verify_consents_append_only(&before, &[]).is_err());
    }
}
