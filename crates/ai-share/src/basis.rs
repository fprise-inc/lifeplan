//! AI接続を使えるかの判定（0226。利用者の判断 2026-11-18）。画面の共有（同意と共有の画面・上の帯）と、
//! 接続口（`lifeplan mcp`）からの依頼（一覧・読み取り・候補）の両方が、この1か所の関数で決める。画面は本体が返した判定を見せるだけ。
//!
//! 使えるのは次のどれか:
//! - お客さまの外部AIへの提供の同意がある（`given`）
//! - 事務所の設定で、FP が「事務所のプライバシーポリシーに AI の利用を書いている」ことを確かめていて、
//!   お客さまが「同意しない」と答えていない（撤回もしていない。同意の答えが無い世帯を含む）
//! - 架空の世帯（お客さまの情報を含まない。0208）
//!
//! お客さまが「同意しない」と答えた世帯・撤回した世帯は、事務所の設定で確かめていても使えない（お客さまの断りを事務所の設定で上書きしない）。
//! 「この依頼では同意を聞かなかった」という記録は持たない: 同意の答えが無い世帯の AI の扱いは、事務所のプライバシーポリシーに従う。
//!
//! 書類（お名前・番号を伏せたもの）を AI に渡すこと（0157）は、同意が書類を含む説明でのものか、事務所のプライバシーポリシーによるとき。
//! 書類を含まない同意（前の版の説明・ヒアリングシートの同意欄）の世帯も、事務所のプライバシーポリシーを確かめていれば書類を渡せる
//! （お客さまは断っていないため）。

use crate::source::{ConsentDecision, ConsentRef};
use serde::{Deserialize, Serialize};

/// 使える・使えない理由（画面と AI への返事に出す）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiUse {
    /// お客さまの同意がある（書類の判定では、書類を含む説明での同意）
    Consent,
    /// 事務所のプライバシーポリシーによる（FP が確かめ済みで、お客さまが「同意しない」と答えていない）
    OfficePolicy,
    /// 架空の世帯（同意が要らない）
    Fictional,
    /// お客さまが「同意しない」と答えた（事務所の設定では上書きしない）
    Refused,
    /// お客さまが同意を撤回した（事務所の設定では上書きしない）
    Withdrawn,
    /// 書類の判定だけ: 同意は書類を含まない説明でのもので、事務所のプライバシーポリシーも確かめていない（計算の項目は渡せる）
    ConsentWithoutDocuments,
    /// メモと面談の履歴の判定だけ: 同意はメモと面談の記録を含まない説明（版1・版2）でのもので、事務所のプライバシーポリシーの
    /// 「面談の記録やメモ」の確かめも無い（計算の項目は渡せる。0249）
    ConsentWithoutNotes,
    /// 同意の答えが無く、事務所のプライバシーポリシーも確かめていない
    None,
}

impl AiUse {
    /// 使えるか
    pub fn allowed(self) -> bool {
        matches!(
            self,
            AiUse::Consent | AiUse::OfficePolicy | AiUse::Fictional
        )
    }

    /// AIに渡した記録の `consentAtGrant.state` に残す言葉（`given`／`officePolicy`／`fictional`、使えないときは同意の状態）
    pub fn grant_state(self) -> &'static str {
        match self {
            AiUse::Consent | AiUse::ConsentWithoutDocuments | AiUse::ConsentWithoutNotes => "given",
            AiUse::OfficePolicy => "officePolicy",
            AiUse::Fictional => "fictional",
            AiUse::Refused => "refused",
            AiUse::Withdrawn => "withdrawn",
            AiUse::None => "none",
        }
    }

    /// 符号の名前（AI への返事の `basis`）
    pub fn name(self) -> &'static str {
        match self {
            AiUse::Consent => "consent",
            AiUse::OfficePolicy => "officePolicy",
            AiUse::Fictional => "fictional",
            AiUse::Refused => "refused",
            AiUse::Withdrawn => "withdrawn",
            AiUse::ConsentWithoutDocuments => "consentWithoutDocuments",
            AiUse::ConsentWithoutNotes => "consentWithoutNotes",
            AiUse::None => "none",
        }
    }

    /// AI に向けた一言（なぜ使える・使えないか）
    pub fn note_for_ai(self) -> &'static str {
        match self {
            AiUse::Consent => "お客さまの外部AIへの提供の同意があります。",
            AiUse::OfficePolicy => "お客さまの同意の記録はありませんが、FP が事務所のプライバシーポリシーに AI の利用を書いていることを確かめていて、お客さまは「同意しない」と答えていません。事務所のプライバシーポリシーに沿って渡されています。",
            AiUse::Fictional => "架空の世帯です（お客さまの情報を含まないので、同意の記録が要りません）。",
            AiUse::Refused => "お客さまが外部AIへの提供に「同意しない」と答えました。事務所の設定にかかわらず、この世帯は AI に渡せません。",
            AiUse::Withdrawn => "お客さまが外部AIへの提供の同意を撤回しました。事務所の設定にかかわらず、この世帯は AI に渡せません。",
            AiUse::ConsentWithoutDocuments => "お客さまの同意は、書類を AI に渡すことを含んでいません（前の版の説明かヒアリングシートの同意欄で同意した世帯です）。",
            AiUse::ConsentWithoutNotes => "お客さまの同意は、面談の記録やメモを AI に渡すことを含んでいません（前の版の説明か、ヒアリングシートの同意欄で同意した世帯です）。",
            AiUse::None => "お客さまの外部AIへの提供の同意が記録されておらず、事務所のプライバシーポリシーも確かめられていません。",
        }
    }
}

/// 世帯の情報（計算に要る項目の縮約版）を AI に渡せるか。
/// `office_policy` は、事務所の設定で FP が「事務所のプライバシーポリシーに AI の利用を書いている」ことを確かめているか
pub fn ai_use(consent: Option<&ConsentRef>, office_policy: bool, fictional: bool) -> AiUse {
    match consent.map(|c| c.decision) {
        Some(ConsentDecision::Given) => AiUse::Consent,
        // 架空の世帯は、お客さまの情報を含まないので同意の記録が要らない（記録が何であっても。0208）
        _ if fictional => AiUse::Fictional,
        Some(ConsentDecision::Refused) => AiUse::Refused,
        Some(ConsentDecision::Withdrawn) => AiUse::Withdrawn,
        None if office_policy => AiUse::OfficePolicy,
        None => AiUse::None,
    }
}

/// 書類（お名前・番号を伏せたもの）を AI に渡せるか（0157）。計算の項目の判定（`ai_use`）より狭いか同じ
pub fn ai_documents_use(
    consent: Option<&ConsentRef>,
    office_policy: bool,
    fictional: bool,
) -> AiUse {
    match ai_use(consent, office_policy, fictional) {
        AiUse::Consent if consent.is_some_and(|c| c.documents) => AiUse::Consent,
        // 書類を含まない同意: お客さまは断っていないので、事務所のプライバシーポリシーを確かめていれば渡せる
        AiUse::Consent if office_policy => AiUse::OfficePolicy,
        AiUse::Consent => AiUse::ConsentWithoutDocuments,
        other => other,
    }
}

/// メモと面談の履歴（両方の欄）を AI に渡せるか（0249）。計算の項目の判定（`ai_use`）より狭いか同じ。
/// `notes_policy` は、事務所のプライバシーポリシーの確かめに加えて「面談の記録やメモを AI で扱うことも書いている」の確かめもあるか。
/// 事務所の確かめで渡せるのは、同意の答えが無い世帯だけ。前の版（版1・版2）の説明で同意した世帯は、説明に「FPのメモは渡しません」と
/// 書いてあり、その約束で同意をもらっているので、事務所の確かめがあっても渡さない（今の説明で同意を記録し直すと渡せる。利用者の判断 2026-11-23）
pub fn ai_notes_use(consent: Option<&ConsentRef>, notes_policy: bool, fictional: bool) -> AiUse {
    match ai_use(consent, notes_policy, fictional) {
        AiUse::Consent if consent.is_some_and(|c| c.notes) => AiUse::Consent,
        // 前の版の説明の同意: 事務所の確かめがあっても渡さない（説明で「FPのメモは渡しません」と約束しているため）
        AiUse::Consent => AiUse::ConsentWithoutNotes,
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(decision: ConsentDecision, documents: bool) -> ConsentRef {
        ConsentRef {
            decision,
            record_id: "c-1".into(),
            documents,
            notes: false,
        }
    }

    #[test]
    fn the_four_cases_of_the_decision() {
        let given = c(ConsentDecision::Given, true);
        let refused = c(ConsentDecision::Refused, false);
        // 同意あり（事務所の設定は見ない）
        assert_eq!(ai_use(Some(&given), false, false), AiUse::Consent);
        assert_eq!(ai_use(Some(&given), true, false), AiUse::Consent);
        // 答え無し＋確かめ済み
        assert_eq!(ai_use(None, true, false), AiUse::OfficePolicy);
        // 答え無し＋未確認
        assert_eq!(ai_use(None, false, false), AiUse::None);
        // 同意しない＋確かめ済み: 事務所の設定でお客さまの断りを上書きしない
        assert_eq!(ai_use(Some(&refused), true, false), AiUse::Refused);
        let withdrawn = c(ConsentDecision::Withdrawn, false);
        assert_eq!(ai_use(Some(&withdrawn), true, false), AiUse::Withdrawn);
        for (u, ok) in [
            (AiUse::Consent, true),
            (AiUse::OfficePolicy, true),
            (AiUse::Fictional, true),
            (AiUse::Refused, false),
            (AiUse::Withdrawn, false),
            (AiUse::ConsentWithoutDocuments, false),
            (AiUse::None, false),
        ] {
            assert_eq!(u.allowed(), ok, "{u:?}");
        }
    }

    #[test]
    fn documents_follow_the_same_rule_and_the_office_policy_covers_consents_without_documents() {
        let given = c(ConsentDecision::Given, true);
        let narrow = c(ConsentDecision::Given, false);
        let refused = c(ConsentDecision::Refused, false);
        assert_eq!(ai_documents_use(Some(&given), false, false), AiUse::Consent);
        assert_eq!(ai_documents_use(None, true, false), AiUse::OfficePolicy);
        assert_eq!(ai_documents_use(None, false, false), AiUse::None);
        assert_eq!(
            ai_documents_use(Some(&refused), true, false),
            AiUse::Refused
        );
        assert_eq!(
            ai_documents_use(Some(&narrow), false, false),
            AiUse::ConsentWithoutDocuments
        );
        assert_eq!(
            ai_documents_use(Some(&narrow), true, false),
            AiUse::OfficePolicy
        );
        // 架空の世帯は同意が要らない
        assert_eq!(ai_documents_use(None, false, true), AiUse::Fictional);
        assert_eq!(ai_use(Some(&refused), false, true), AiUse::Fictional);
    }

    #[test]
    fn the_grant_state_keeps_the_words_already_in_household_files() {
        assert_eq!(AiUse::Consent.grant_state(), "given");
        assert_eq!(AiUse::Fictional.grant_state(), "fictional");
        assert_eq!(AiUse::None.grant_state(), "none");
        assert_eq!(AiUse::OfficePolicy.grant_state(), "officePolicy");
    }
}
