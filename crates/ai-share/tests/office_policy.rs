//! AI接続を使える条件（0226。利用者の判断 2026-11-18）: 同意がある世帯か、事務所の設定で「事務所のプライバシーポリシーに AI の利用を書いている」を
//! FP が確かめていて、お客さまが「同意しない」と答えていない世帯。4通り（同意あり／答え無し＋確かめ済み／答え無し＋未確認／同意しない＋確かめ済み）を、
//! 共有の台帳（接続口からの依頼に答える所）と、画面に返す形（世帯の帳面の view）の両方で確かめる。モデル世帯（架空）で確かめる。

use ai_share::book::HouseholdBook;
use ai_share::clock::ManualClock;
use ai_share::record::{Caller, EndReason};
use ai_share::{
    AiUse, ConsentDecision, ConsentRef, ExternalAiConsentInput, GrantError, GrantOptions,
    ShareRegistry, SharedHouseholdSource,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

const HOUSEHOLD_ID: &str = "3a7c9e1b-5d2f-4e8a-b6c4-0d9e8f7a6b5c";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn model_input() -> Value {
    let s = std::fs::read_to_string(repo().join("data/modelHouseholds/sampleCoupleNoKids.json"))
        .unwrap();
    serde_json::from_str::<Value>(&s).unwrap()["input"].clone()
}

fn registry() -> ShareRegistry {
    let reg = ShareRegistry::with_clock(Arc::new(ManualClock::new(1_792_198_923_000)));
    // アプリ本体と同じく、渡す理由の無い世帯は渡さない
    reg.require_consent(true);
    reg
}

fn caller() -> Caller {
    Caller {
        mcp_client_declared: Some("test-ai 1.0".into()),
        ..Caller::default()
    }
}

fn source(consent: Option<(ConsentDecision, bool)>) -> SharedHouseholdSource {
    SharedHouseholdSource {
        household_id: HOUSEHOLD_ID.into(),
        customer_number: Some("C0042".into()),
        revision: "generation-1".into(),
        input: model_input(),
        texts: vec![],
        labels_by_member: None,
        post_retirement: None,
        display: None,
        external_ai_consent: consent.map(|(decision, documents)| ConsentRef {
            decision,
            record_id: "c-1".into(),
            documents,
            notes: false,
        }),
        fictional: false,
        entered: None,
        followup: None,
    }
}

fn opts() -> GrantOptions {
    GrantOptions {
        destination_declared: "Claude Desktop".into(),
        ..GrantOptions::default()
    }
}

fn read(reg: &ShareRegistry, share_id: &str) -> Result<Value, (String, String)> {
    reg.handle_get(share_id, "get_shared_household", &caller())
        .map(|s| serde_json::from_str(&s).unwrap())
        .map_err(|(c, m)| (c.as_str().to_owned(), m))
}

fn list(reg: &ShareRegistry) -> Vec<Value> {
    let v: Value = serde_json::from_str(&reg.handle_list().unwrap()).unwrap();
    v["shares"].as_array().unwrap().clone()
}

fn answer() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            repo().join("crates/lifeplan/tests/fixtures/propose-inputs/answer.json"),
        )
        .unwrap(),
    )
    .unwrap()
}

/// 同意あり: 事務所の設定にかかわらず渡せる。理由は consent
#[test]
fn households_with_consent_share_whatever_the_office_setting() {
    for office in [false, true] {
        let reg = registry();
        reg.set_office_policy(office);
        let g = reg
            .grant(source(Some((ConsentDecision::Given, true))), opts())
            .unwrap();
        assert_eq!(g.basis, AiUse::Consent);
        assert!(!g.consent_warned);
        assert_eq!(reg.records(HOUSEHOLD_ID)[0].consent_at_grant.state, "given");
        let got = read(&reg, &g.share_id).unwrap();
        assert_eq!(got["basis"], "consent");
        assert_eq!(list(&reg)[0]["basis"], "consent");
        assert!(reg
            .handle_propose_documents(&g.share_id, &answer(), &caller())
            .is_ok());
    }
}

/// 答え無し＋確かめ済み: 渡せる。理由は officePolicy（AIへの返事にも出る）。記録の同意の欄には officePolicy と残る
#[test]
fn households_without_an_answer_share_when_the_office_policy_is_confirmed() {
    let reg = registry();
    reg.set_office_policy(true);
    let g = reg.grant(source(None), opts()).unwrap();
    assert_eq!(g.basis, AiUse::OfficePolicy);
    assert!(!g.consent_warned);
    let rec = &reg.records(HOUSEHOLD_ID)[0];
    assert_eq!(rec.consent_at_grant.state, "officePolicy");
    assert_eq!(rec.consent_at_grant.record_id, None);
    assert!(!rec.consent_at_grant.warned);
    let got = read(&reg, &g.share_id).unwrap();
    assert_eq!(got["basis"], "officePolicy");
    assert!(
        got["basisNote"]
            .as_str()
            .unwrap()
            .contains("事務所のプライバシーポリシー"),
        "{got}"
    );
    let l = list(&reg);
    assert_eq!(l[0]["basis"], "officePolicy");
    assert_eq!(l[0]["documents"], true);
    // 書類の候補も受ける（お客さまは断っていない）
    assert!(reg
        .handle_propose_documents(&g.share_id, &answer(), &caller())
        .is_ok());
}

/// 答え無し＋未確認: 渡せない（今までどおり）
#[test]
fn households_without_an_answer_do_not_share_when_the_office_policy_is_not_confirmed() {
    let reg = registry();
    assert!(!reg.office_policy(), "既定は確かめていない");
    assert_eq!(
        reg.grant(source(None), opts()).unwrap_err(),
        GrantError::ConsentMissing {
            state: "none".into()
        }
    );
    assert!(list(&reg).is_empty());
}

/// 同意しない＋確かめ済み: 渡せない（お客さまの断りを事務所の設定で上書きしない）。撤回も同じ
#[test]
fn households_that_refused_do_not_share_even_with_the_office_policy() {
    let reg = registry();
    reg.set_office_policy(true);
    assert_eq!(
        reg.grant(source(Some((ConsentDecision::Refused, false))), opts())
            .unwrap_err(),
        GrantError::ConsentMissing {
            state: "refused".into()
        }
    );
    assert_eq!(
        reg.grant(source(Some((ConsentDecision::Withdrawn, false))), opts())
            .unwrap_err(),
        GrantError::ConsentMissing {
            state: "withdrawn".into()
        }
    );
    // 事務所のプライバシーポリシーで渡していた世帯で、お客さまが「同意しない」と答えたら、その場で閉じる。AI には断った理由が分かる文を返す
    let g = reg.grant(source(None), opts()).unwrap();
    assert!(!reg.update_source(&g.share_id, source(Some((ConsentDecision::Refused, false)))));
    assert_eq!(
        reg.records(HOUSEHOLD_ID)[0].end_reason,
        Some(EndReason::ConsentWithdrawn)
    );
    let (code, _) = read(&reg, &g.share_id).unwrap_err();
    assert_eq!(code, "REVOKED");
    assert!(list(&reg).is_empty());
}

/// 共有の後にお客さまの断りが届いた世帯（帳面の外で届いた状態）を読むと、断った理由の分かる文で閉じる
#[test]
fn the_refusal_reason_reaches_the_ai() {
    let reg = registry();
    reg.set_office_policy(true);
    let g = reg.grant(source(None), opts()).unwrap();
    // require を一度外して中身を置き換え、読むときの確かめで閉じさせる（update_source は require のときその場で閉じるため）
    reg.require_consent(false);
    assert!(reg.update_source(&g.share_id, source(Some((ConsentDecision::Refused, false)))));
    reg.require_consent(true);
    let (code, msg) = read(&reg, &g.share_id).unwrap_err();
    assert_eq!(code, "REVOKED");
    assert!(msg.contains("「同意しない」と答えました"), "{msg}");
}

/// 事務所の設定の確かめを外すと、それを理由に渡していた共有だけをその場で閉じる（同意のある世帯の共有は続く）
#[test]
fn unchecking_the_office_policy_ends_only_the_shares_that_relied_on_it() {
    let reg = registry();
    reg.set_office_policy(true);
    let by_policy = reg.grant(source(None), opts()).unwrap();
    let mut other = source(Some((ConsentDecision::Given, false)));
    other.household_id = "6b2d8f0a-1c3e-4f5a-9b7d-2e4f6a8c0b1d".into();
    let by_consent = reg.grant(other, opts()).unwrap();
    // 書類を含まない同意の世帯も、確かめ済みなら書類の候補を受ける
    assert!(reg
        .handle_propose_documents(&by_consent.share_id, &answer(), &caller())
        .is_ok());
    assert_eq!(reg.set_office_policy(false), 1);
    assert_eq!(read(&reg, &by_policy.share_id).unwrap_err().0, "REVOKED");
    assert_eq!(
        reg.records(HOUSEHOLD_ID)[0].end_reason,
        Some(EndReason::Revoked)
    );
    let got = read(&reg, &by_consent.share_id).unwrap();
    assert_eq!(got["basis"], "consent");
    // 外した後は、書類を含まない同意の世帯の書類の候補は受けない（計算の項目は読める）
    let (code, msg) = reg
        .handle_propose_documents(&by_consent.share_id, &answer(), &caller())
        .unwrap_err();
    assert_eq!(code.as_str(), "NOT_SHARED");
    assert!(msg.contains("事務所のプライバシーポリシー"), "{msg}");
}

fn book(consent: Option<ConsentDecision>) -> HouseholdBook {
    let s = std::fs::read_to_string(repo().join("data/modelHouseholds/sampleCoupleNoKids.json"))
        .unwrap();
    let request: Value = serde_json::from_str(&s).unwrap();
    let body = json!({ "meta": { "customerNo": "C0042" }, "household": { "request": request }, "proposals": [], "workspace": {} });
    let (mut b, _) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some("C0042".into()), 1, &body.to_string())
            .unwrap();
    if let Some(decision) = consent {
        b.record_consent(
            &ExternalAiConsentInput {
                decision,
                obtained_on: "2026-11-18".into(),
                method: "paper".into(),
                no_training_confirmed: true,
                fp_confirmed: true,
            },
            "2026-11-18",
            "2026-11-18T01:00:00Z",
            None,
        )
        .unwrap();
    }
    b
}

/// 画面に返す形（同意と共有の画面・上の帯が見る判定）も、同じ関数の4通り
#[test]
fn the_screen_gets_the_same_decision_for_the_four_cases() {
    let cases = [
        (Some(ConsentDecision::Given), false, AiUse::Consent),
        (None, true, AiUse::OfficePolicy),
        (None, false, AiUse::None),
        (Some(ConsentDecision::Refused), true, AiUse::Refused),
    ];
    for (consent, office, want) in cases {
        let v = book(consent).view(&[], None, office);
        assert_eq!(v.ai_use, want, "{consent:?} {office}");
        assert_eq!(v.ai_documents_use, want, "{consent:?} {office}");
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(
            json["aiUse"],
            json!(match want {
                AiUse::Consent => "consent",
                AiUse::OfficePolicy => "officePolicy",
                AiUse::None => "none",
                _ => "refused",
            })
        );
    }
}
