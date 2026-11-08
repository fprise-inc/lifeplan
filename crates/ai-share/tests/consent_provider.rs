//! 外部AIへの提供の同意の見張り（直した不具合が戻らないように）。
//!
//! - この版は1世帯につき1社。共有を始めるとき、申告した AI の会社と同意した会社を照らし、合わなければ止める
//! - 同意の会社を変えるときは、先に撤回を記録する（取り直しで別の会社にしない）
//! - 取り方が「ヒアリングシートの同意欄」の同意は、シートの同意欄の文の指紋で、書類を含まない同意として記録する。
//!   書類を AI に渡す世帯は、今の説明を見せて取り直せる

use ai_share::book::HouseholdBook;
use ai_share::consent::{
    explanation_ref, ExternalAiConsentInput, EXTERNAL_AI_EXPLANATION,
    HEARING_SHEET_EXTERNAL_AI_TEXT,
};
use ai_share::ConsentDecision;
use serde_json::json;
use std::path::PathBuf;

const HID: &str = "0c6a1f0e-6a4b-4f0e-9d7e-2b4b6d3c9a11";
const TODAY: &str = "2026-11-08";
const NOW: &str = "2026-11-08T00:00:00Z";

fn book() -> HouseholdBook {
    let body = json!({"household": {"request": {"input": {}}}}).to_string();
    HouseholdBook::from_opened(HID, None, 1, &body).unwrap().0
}

fn input(decision: ConsentDecision, company: &str, method: &str) -> ExternalAiConsentInput {
    ExternalAiConsentInput {
        decision,
        obtained_on: TODAY.into(),
        method: method.into(),
        company: company.into(),
        country: "日本".into(),
        no_training_confirmed: true,
        fp_confirmed: true,
    }
}

fn given(b: &mut HouseholdBook, company: &str, method: &str) -> Result<(), &'static str> {
    b.record_consent(
        &input(ConsentDecision::Given, company, method),
        TODAY,
        NOW,
        None,
    )
    .map(|_| ())
}

#[test]
fn a_second_company_is_not_added_and_changing_company_needs_a_withdrawal_first() {
    let mut b = book();
    given(&mut b, "架空AI株式会社", "hearingSheet").unwrap();
    // 書類を含まない同意（シートの同意欄）の取り直しでも、別の会社にはしない
    assert_eq!(
        given(&mut b, "別のAI合同会社", "paper"),
        Err("E_AI_CONSENT_COMPANY_CHANGE")
    );
    // 同じ会社なら取り直せる（書き方の違いは同じ会社とみる）
    given(&mut b, "架空ＡＩ 株式会社", "paper").unwrap();
    // 今の説明で取った後に、2つ目の会社は足さない
    assert_eq!(
        given(&mut b, "別のAI合同会社", "paper"),
        Err("E_AI_CONSENT_ALREADY")
    );
    // 撤回してから、新しい会社で同意を記録する
    b.record_consent(
        &input(ConsentDecision::Withdrawn, "", "inPerson"),
        TODAY,
        NOW,
        None,
    )
    .unwrap();
    given(&mut b, "別のAI合同会社", "paper").unwrap();
    assert_eq!(b.check_share_company("別のAI"), Ok(()));
    assert_eq!(
        b.check_share_company("架空AI株式会社"),
        Err("E_AI_COMPANY_MISMATCH")
    );
}

#[test]
fn starting_a_share_checks_the_declared_company_against_the_consent() {
    let mut b = book();
    // 同意が無ければ、会社を照らす前に止める
    assert_eq!(b.check_share_company("Example AI"), Err("E_AI_NO_CONSENT"));
    given(&mut b, "Example AI, L.L.C.", "paper").unwrap();
    for same in [
        "Example AI",
        "exampleai",
        "ＥｘａｍｐｌｅＡＩ",
        " Example AI Inc. ",
        "Example AI Co., Ltd.",
    ] {
        assert_eq!(b.check_share_company(same), Ok(()), "{same}");
    }
    for other in [
        "Other AI",
        "Sample Labs LLC",
        "エグザンプルAI",
        "Example AI Japan 合同会社",
    ] {
        assert_eq!(
            b.check_share_company(other),
            Err("E_AI_COMPANY_MISMATCH"),
            "{other}"
        );
    }
    assert_eq!(b.check_share_company("  "), Err("E_AI_COMPANY"));
    assert_eq!(b.check_share_company(&"あ".repeat(61)), Err("E_AI_COMPANY"));
}

#[test]
fn a_hearing_sheet_consent_records_the_sheet_text_and_does_not_cover_documents() {
    let mut b = book();
    let r = b
        .record_consent(
            &input(ConsentDecision::Given, "架空AI株式会社", "hearingSheet"),
            TODAY,
            NOW,
            None,
        )
        .unwrap();
    assert!(
        !r.documents,
        "シートの同意欄の文は書類に触れないので、書類を含む同意にしない"
    );
    let sheet = explanation_ref(HEARING_SHEET_EXTERNAL_AI_TEXT);
    assert_eq!(r.explanation_ref.as_deref(), Some(sheet.as_str()));
    assert_eq!(
        b.explanations.get(&sheet).map(String::as_str),
        Some(HEARING_SHEET_EXTERNAL_AI_TEXT),
        "シートの文を世帯ファイルに写す"
    );
    assert!(
        !b.explanations
            .contains_key(&explanation_ref(EXTERNAL_AI_EXPLANATION)),
        "見せていないアプリの説明文は写さない"
    );
    let v = b.view(&[], None);
    assert_eq!(v.consent_state, "given");
    assert!(!v.consent_documents);
    assert_eq!(v.hearing_sheet_explanation, HEARING_SHEET_EXTERNAL_AI_TEXT);

    // シートの同意欄では取り直せない（今の説明を見せて取り直す）
    assert_eq!(
        given(&mut b, "架空AI株式会社", "hearingSheet"),
        Err("E_AI_CONSENT_ALREADY")
    );
    // 書類を AI に渡す世帯は、今の説明を見せて取り直す
    let renewed = b
        .record_consent(
            &input(ConsentDecision::Given, "架空AI株式会社", "inPerson"),
            TODAY,
            NOW,
            None,
        )
        .unwrap();
    assert!(renewed.documents);
    assert_eq!(
        renewed.explanation_ref,
        Some(explanation_ref(EXTERNAL_AI_EXPLANATION))
    );
    assert!(b.consent().unwrap().documents);
    assert_eq!(b.explanations.len(), 2, "シートの文と今の説明の両方が残る");
}

#[test]
fn a_refusal_on_the_hearing_sheet_points_at_the_sheet_text() {
    let mut b = book();
    let r = b
        .record_consent(
            &input(ConsentDecision::Refused, "", "hearingSheet"),
            TODAY,
            NOW,
            None,
        )
        .unwrap();
    assert_eq!(
        r.explanation_ref,
        Some(explanation_ref(HEARING_SHEET_EXTERNAL_AI_TEXT))
    );
    assert!(!r.documents);
}

/// シートの同意欄の文は、ヒアリングの項目の登録と、今のシート（基本・くわしい）の文と同じ
#[test]
fn the_sheet_text_is_the_text_on_the_current_sheets() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let registry = std::fs::read_to_string(root.join("registry/hearing.yaml")).unwrap();
    assert!(
        registry.contains(&format!("label: \"{HEARING_SHEET_EXTERNAL_AI_TEXT}\"")),
        "registry/hearing.yaml の hs.consent.externalAi と違う"
    );
    for sheet in ["basic/2.json", "full/4.json"] {
        let s = std::fs::read_to_string(root.join("hearing/sheets").join(sheet)).unwrap();
        assert!(
            s.contains(&format!("\"label\": \"{HEARING_SHEET_EXTERNAL_AI_TEXT}\"")),
            "{sheet} の同意欄の文と違う"
        );
    }
}
