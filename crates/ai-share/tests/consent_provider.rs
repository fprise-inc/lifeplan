//! 外部AIへの提供の同意の見張り（直した不具合が戻らないように）。
//!
//! - 同意は「外部の AI サービスに渡すことへの同意」1つ。どの AI の会社かは聞かない・記録しない（0172）。
//!   前の版で記録した、会社・所在国のある行は、捨てずにそのまま読めて、書き戻しても1文字も変わらない
//! - 取り方が「ヒアリングシートの同意欄」の同意は、シートの同意欄の文の指紋で、書類を含まない同意として記録する。
//!   書類を AI に渡す世帯は、今の説明を見せて取り直せる

use ai_share::book::HouseholdBook;
use ai_share::consent::{
    explanation_ref, ConsentRecord, ExternalAiConsentInput, EXTERNAL_AI_EXPLANATION,
    EXTERNAL_AI_EXPLANATION_V1, HEARING_SHEET_EXTERNAL_AI_TEXT,
};
use ai_share::ConsentDecision;
use serde_json::{json, Value};
use std::path::PathBuf;

const HID: &str = "0c6a1f0e-6a4b-4f0e-9d7e-2b4b6d3c9a11";
const TODAY: &str = "2026-11-08";
const NOW: &str = "2026-11-08T00:00:00Z";

fn book_from(body: Value) -> HouseholdBook {
    HouseholdBook::from_opened(HID, None, 1, &body.to_string())
        .unwrap()
        .0
}

fn book() -> HouseholdBook {
    book_from(json!({"household": {"request": {"input": {}}}}))
}

fn input(decision: ConsentDecision, method: &str) -> ExternalAiConsentInput {
    ExternalAiConsentInput {
        decision,
        obtained_on: TODAY.into(),
        method: method.into(),
        no_training_confirmed: true,
        fp_confirmed: true,
    }
}

fn record(b: &mut HouseholdBook, decision: ConsentDecision, method: &str) -> ConsentRecord {
    b.record_consent(&input(decision, method), TODAY, NOW, None)
        .unwrap()
}

#[test]
fn the_consent_does_not_ask_or_record_an_ai_company() {
    let mut b = book();
    // 画面が前の版の形（会社・所在国つき）で送ってきても、会社は記録しない
    let old_screen: ExternalAiConsentInput = serde_json::from_value(json!({
        "decision": "given", "obtainedOn": TODAY, "method": "paper",
        "company": "架空AI株式会社", "country": "日本", "noTrainingConfirmed": true, "fpConfirmed": true
    }))
    .unwrap();
    let r = b.record_consent(&old_screen, TODAY, NOW, None).unwrap();
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["externalAi"], json!({"noTrainingConfirmed": true}));
    assert!(r.documents);
    // 同意は1つ。今の説明で取った後に、もう1つは記録しない
    assert_eq!(
        b.record_consent(&input(ConsentDecision::Given, "paper"), TODAY, NOW, None)
            .map(|_| ()),
        Err("E_AI_CONSENT_ALREADY")
    );
    // 撤回は世帯の同意そのものを撤回する。撤回の後は、また同意を記録できる
    record(&mut b, ConsentDecision::Withdrawn, "inPerson");
    assert_eq!(b.consent().unwrap().decision, ConsentDecision::Withdrawn);
    record(&mut b, ConsentDecision::Given, "paper");
    assert_eq!(b.consent().unwrap().decision, ConsentDecision::Given);
}

#[test]
fn rows_recorded_with_a_company_are_kept_and_read_as_they_are() {
    let old = json!({
        "id": "c-old", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-10-19", "method": "paper",
        "explanationRef": explanation_ref(EXTERNAL_AI_EXPLANATION_V1),
        "externalAi": {"company": "架空AI株式会社", "country": "日本", "noTrainingConfirmed": true},
        "scope": "reduced", "fpConfirmed": true, "recordedAt": "2026-10-19T00:00:00Z", "origin": "thisOffice"
    });
    let mut b = book_from(json!({
        "household": {"request": {"input": {}}},
        "consents": [old.clone()],
        "consentExplanations": {explanation_ref(EXTERNAL_AI_EXPLANATION_V1): EXTERNAL_AI_EXPLANATION_V1}
    }));
    let r = &b.consents[0];
    let e = r.external_ai.as_ref().unwrap();
    assert_eq!(e.company.as_deref(), Some("架空AI株式会社"));
    assert_eq!(e.country.as_deref(), Some("日本"));
    // 書き戻しても1文字も変わらない（追記だけの確かめが通る）
    assert_eq!(serde_json::to_value(r).unwrap(), old);
    // 書類を含まない前の版の同意は、会社を聞かずに今の説明で取り直せる
    let renewed = record(&mut b, ConsentDecision::Given, "inPerson");
    assert!(renewed.documents);
    assert!(renewed.external_ai.as_ref().unwrap().company.is_none());
    let composed: Value = serde_json::from_str(&b.compose(&[]).unwrap()).unwrap();
    assert_eq!(composed["consents"][0], old);
    assert_eq!(composed["consents"].as_array().unwrap().len(), 2);
}

#[test]
fn a_hearing_sheet_consent_records_the_sheet_text_and_does_not_cover_documents() {
    let mut b = book();
    let r = record(&mut b, ConsentDecision::Given, "hearingSheet");
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
        b.record_consent(
            &input(ConsentDecision::Given, "hearingSheet"),
            TODAY,
            NOW,
            None
        )
        .map(|_| ()),
        Err("E_AI_CONSENT_ALREADY")
    );
    // 書類を AI に渡す世帯は、今の説明を見せて取り直す
    let renewed = record(&mut b, ConsentDecision::Given, "inPerson");
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
    let r = record(&mut b, ConsentDecision::Refused, "hearingSheet");
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
