//! 世帯ごとの「同意とAIの記録」の帳面と、アプリの方針（同意が必須）の試験。モデル世帯（架空）で確かめる。
//!
//! - 同意が無い世帯は渡せず、接続口からも見えない・読めない
//! - 同意を撤回したら、その場で読めなくなる
//! - 縮約版に、識別子（世帯の内部ID・顧客番号・呼び名）とFPのメモが入らない
//! - 共有の記録が世帯ファイルに書く本文に残る。画面から送られた記録は使わない。既存の行の書き換えは止まる
//! - AIの候補は、FPが承認するまで世帯（計算の入力）に入らない。判断は1回だけ
//! - 画面に返す形に、パスが入らない

use ai_share::book::{CandidateStatus, HouseholdBook, OWNED_SECTIONS};
use ai_share::clock::ManualClock;
use ai_share::record::{Caller, EndReason};
use ai_share::source::ConsentDecision;
use ai_share::{ExternalAiConsentInput, GrantError, GrantOptions, ShareRegistry};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

const HOUSEHOLD_ID: &str = "7d1e4c2a-0b3f-4a6e-9c5d-1f2e3a4b5c6d";
const CUSTOMER_NO: &str = "Z0099";
const MEMO: &str = "目印のFPメモ: 来年に転職の予定";
const LABEL: &str = "目印の呼び名: 上のお子さん";
const TODAY: &str = "2026-10-19";
const NOW: &str = "2026-10-19T01:00:00Z";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// モデル世帯から、画面が保存する形の本文を作る（FPのメモと呼び名を入れる）
fn body(id: &str) -> String {
    let s =
        std::fs::read_to_string(repo().join(format!("data/modelHouseholds/{id}.json"))).unwrap();
    let request: Value = serde_json::from_str(&s).unwrap();
    let first = request["input"]["household"]["members"][0]["id"].clone();
    json!({
        "meta": { "customerNo": CUSTOMER_NO },
        "household": {
            "request": request,
            "memo": [MEMO],
            "labelsByMember": { first.as_str().unwrap(): LABEL },
        },
        "proposals": [],
        "workspace": { "band": [] },
        // 明細の取り込みの記録（0034）は、どの版でも AI に渡さない（取り込みの記録の元データ。0015 の6）
        "statements": {
            "version": 1,
            "accounts": [{ "id": "acc-1", "kind": "card", "label": "目印のカード", "owner": null }],
            "imports": [{ "id": "imp-1", "kind": "statement", "rows": [{ "id": "r1", "line": 1, "date": "2026-09-01", "merchant": "目印の店", "amount": 1234 }] }],
            "rules": [],
            "applied": []
        },
        // 移行の取り込みの記録（0113 の10）も、どの版でも AI に渡さない（縮約版は計算の要求からだけ作る）
        "migrations": {
            "version": 1,
            "imports": [{ "id": "mig-1", "kind": "migration", "memo": [{ "label": "備考", "text": "目印の移行メモ" }], "referenceValues": [{ "row": "cf.net", "year": 2030, "amount": 1830000 }] }]
        },
    })
    .to_string()
}

fn registry() -> (Arc<ShareRegistry>, ManualClock) {
    let clock = ManualClock::new(1_792_198_923_000);
    let reg = Arc::new(ShareRegistry::with_clock(Arc::new(clock.clone())));
    reg.require_consent(true);
    (reg, clock)
}

fn book() -> HouseholdBook {
    HouseholdBook::from_opened(
        HOUSEHOLD_ID,
        Some(CUSTOMER_NO.into()),
        1,
        &body("salariedCoupleTwoKids"),
    )
    .unwrap()
    .0
}

fn consent(decision: ConsentDecision) -> ExternalAiConsentInput {
    ExternalAiConsentInput {
        decision,
        obtained_on: TODAY.into(),
        method: "paper".into(),
        company: "架空AI株式会社".into(),
        country: "日本".into(),
        no_training_confirmed: true,
        fp_confirmed: true,
    }
}

fn opts() -> GrantOptions {
    GrantOptions {
        destination_declared: "手元のAIアプリ".into(),
        ..GrantOptions::default()
    }
}

fn list_len(reg: &ShareRegistry) -> usize {
    let v: Value = serde_json::from_str(&reg.handle_list().unwrap()).unwrap();
    v["shares"].as_array().unwrap().len()
}

fn get(reg: &ShareRegistry, share_id: &str) -> Result<String, String> {
    reg.handle_get(share_id, "get_shared_household", &Caller::default())
        .map_err(|(c, _)| c.as_str().to_owned())
}

#[test]
fn households_without_consent_cannot_be_shared_or_seen() {
    let (reg, _) = registry();
    let b = book();
    // 同意の記録なし: 渡せない（警告を見たうえで続ける指定でも、アプリの方針では渡せない）
    let e = reg
        .grant(
            b.source().unwrap(),
            GrantOptions {
                proceed_without_consent: true,
                ..opts()
            },
        )
        .unwrap_err();
    assert_eq!(
        e,
        GrantError::ConsentMissing {
            state: "none".into()
        }
    );
    assert_eq!(list_len(&reg), 0, "接続口から見えない");
    assert!(
        reg.records(HOUSEHOLD_ID).is_empty(),
        "渡していないので記録も無い"
    );

    // 同意しなかった記録だけの世帯も渡せない
    let mut refused = book();
    refused
        .record_consent(&consent(ConsentDecision::Refused), TODAY, NOW, None)
        .unwrap();
    assert!(matches!(
        reg.grant(refused.source().unwrap(), opts()),
        Err(GrantError::ConsentMissing { .. })
    ));
}

#[test]
fn withdrawing_consent_stops_reads_at_once() {
    let (reg, _) = registry();
    let mut b = book();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    assert_eq!(list_len(&reg), 1);
    assert!(get(&reg, &g.share_id).is_ok());

    b.record_consent(&consent(ConsentDecision::Withdrawn), TODAY, NOW, None)
        .unwrap();
    // アプリは撤回を記録したら、その世帯の共有を取り消す（0014 の6）
    assert_eq!(reg.withdraw_consent(HOUSEHOLD_ID), 1);
    assert_eq!(get(&reg, &g.share_id), Err("REVOKED".into()));
    assert_eq!(list_len(&reg), 0);
    let r = &reg.records(HOUSEHOLD_ID)[0];
    assert_eq!(r.end_reason, Some(EndReason::ConsentWithdrawn));
    assert_eq!(r.consent_at_grant.state, "given");
}

#[test]
fn a_source_without_consent_ends_the_share_even_if_withdraw_was_missed() {
    let (reg, _) = registry();
    let mut b = book();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    b.record_consent(&consent(ConsentDecision::Withdrawn), TODAY, NOW, None)
        .unwrap();
    // 保存のたびに渡す中身を置き換える。そのとき同意が無ければ、その場で閉じる（二重の守り）
    assert!(!reg.update_source(&g.share_id, b.source().unwrap()));
    assert_eq!(get(&reg, &g.share_id), Err("REVOKED".into()));
    assert_eq!(
        reg.records(HOUSEHOLD_ID)[0].end_reason,
        Some(EndReason::ConsentWithdrawn)
    );
}

#[test]
fn the_reduced_view_has_no_identifiers_or_memos() {
    let (reg, _) = registry();
    let mut b = book();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    let out = get(&reg, &g.share_id).unwrap();
    for needle in [
        HOUSEHOLD_ID,
        CUSTOMER_NO,
        MEMO,
        LABEL,
        "目印",
        "labelsByMember",
        "memo",
        "statements",
        "目印の店",
        "migrations",
        "目印の移行メモ",
        "1830000",
    ] {
        assert!(!out.contains(needle), "縮約版に {needle} が入っている");
    }
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["scope"], "reduced");
    assert_eq!(v["texts"], json!([]), "文章（メモなど）は渡さない");
    // 共有の記録の項目にも、文章の項目は入らない
    let fields = &reg.records(HOUSEHOLD_ID)[0].fields;
    assert!(!fields.iter().any(|f| f.starts_with("note.")));
}

#[test]
fn records_are_written_by_the_app_only_and_cannot_be_rewritten() {
    let (reg, _) = registry();
    let (mut b, screen) = HouseholdBook::from_opened(
        HOUSEHOLD_ID,
        Some(CUSTOMER_NO.into()),
        1,
        &body("salariedCoupleTwoKids"),
    )
    .unwrap();
    // 画面に返す本文には、アプリだけが書く区画が無い
    let sv: Value = serde_json::from_str(&screen).unwrap();
    for k in OWNED_SECTIONS {
        assert!(sv.get(k).is_none());
    }
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    get(&reg, &g.share_id).unwrap();

    // 画面から、偽の記録を入れた本文が届いても使わない
    let mut forged: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    forged["consents"] = json!([{ "id": "x", "kind": "externalAi", "decision": "given" }]);
    forged["aiShares"] = json!([]);
    forged["candidates"] = json!([{ "id": "y" }]);
    b.replace_body(&forged.to_string()).unwrap();
    let records = reg.records(HOUSEHOLD_ID);
    let composed: Value = serde_json::from_str(&b.compose(&records).unwrap()).unwrap();
    assert_eq!(composed["consents"].as_array().unwrap().len(), 1);
    assert_ne!(composed["consents"][0]["id"], "x");
    assert_eq!(
        composed["aiShares"].as_array().unwrap().len(),
        1,
        "共有の記録が残る"
    );
    assert_eq!(
        composed["aiShares"][0]["reads"][0]["tool"],
        "get_shared_household"
    );
    assert!(composed.get("candidates").is_none());
    assert!(
        composed["consentExplanations"].as_object().unwrap().len() == 1,
        "説明文を1回だけ写す"
    );
    b.mark_saved(&records, 2);
    assert!(!b.is_dirty(&records));

    // 保存した後に、既存の行を書き換えた記録は書かない
    let mut tampered = records.clone();
    tampered[0].destination_declared = "別の申告".into();
    assert!(b.compose(&tampered).is_err());
    let mut shorter = b.clone();
    shorter.consents.clear();
    assert!(shorter.compose(&records).is_err(), "同意の記録を消せない");

    // 開き直すと、記録はファイルから戻る（アプリが落ちて終わりの無い共有は「アプリの終了」で閉じる）
    let (b2, _) = HouseholdBook::from_opened(HOUSEHOLD_ID, None, 2, &composed.to_string()).unwrap();
    assert_eq!(b2.consents.len(), 1);
    assert_eq!(b2.file_ai_shares.len(), 1);
    let (reg2, _) = registry();
    reg2.load_records(HOUSEHOLD_ID, b2.file_ai_shares.clone());
    assert_eq!(
        reg2.records(HOUSEHOLD_ID)[0].end_reason,
        Some(EndReason::AppClosed)
    );
}

#[test]
fn ai_candidates_do_not_enter_the_household_until_approved() {
    let (reg, _) = registry();
    let mut b = book();
    let original_input = b.source().unwrap().input;
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    let p = json!({
        "title": "物価の想定を下げるプラン",
        "summary": "比べるため",
        "changes": [{ "target": "assumptions", "item": "assumptions.inflation", "value": "0.005" }]
    });
    reg.handle_propose(&g.share_id, &p, &Caller::default())
        .unwrap();
    for pending in reg.take_proposals() {
        b.add_candidate(pending);
    }
    assert_eq!(b.candidates.len(), 1);
    assert_eq!(b.candidates[0].status, CandidateStatus::Pending);
    let records = reg.records(HOUSEHOLD_ID);
    let composed: Value = serde_json::from_str(&b.compose(&records).unwrap()).unwrap();
    assert_eq!(
        composed["household"]["request"]["input"], original_input,
        "候補は世帯（計算の入力）を変えない"
    );
    assert_eq!(composed["candidates"][0]["status"], "pending");
    assert_eq!(
        composed["aiShares"][0]["proposals"][0]["candidateId"],
        b.candidates[0].id
    );
    b.mark_saved(&records, 2);

    // 承認は1回だけ。承認にはプランの ID が要る
    let id = b.candidates[0].id.clone();
    assert_eq!(
        b.decide(&id, true, None, NOW, None),
        Err("E_AI_CANDIDATE_PLAN")
    );
    b.decide(&id, true, Some("plan-1".into()), NOW, None)
        .unwrap();
    assert_eq!(
        b.decide(&id, false, None, NOW, None),
        Err("E_AI_CANDIDATE_DECIDED")
    );
    assert_eq!(b.candidates[0].decided_by.as_deref(), Some("fp"));
    assert!(b.compose(&records).is_ok());
    b.mark_saved(&records, 3);
    // 判断の書き換えは止まる
    let mut changed = b.clone();
    changed.candidates[0].status = CandidateStatus::Rejected;
    assert!(changed.compose(&records).is_err());
}

#[test]
fn the_screen_view_has_no_paths() {
    let (reg, _) = registry();
    let mut b = book();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    let caller = Caller {
        connector_pid: Some(7),
        connector_exe: Some("/Users/someone/Applications/x/lifeplan".into()),
        parent_exe: Some("/Applications/Some AI.app/Contents/MacOS/ai".into()),
        mcp_client_declared: Some("client 1.0".into()),
    };
    reg.handle_get(&g.share_id, "get_shared_household", &caller)
        .unwrap();
    let view = b.view(
        &reg.records(HOUSEHOLD_ID),
        reg.active_shares().into_iter().next(),
    );
    let json = serde_json::to_string(&view).unwrap();
    assert!(
        !json.contains("/Users") && !json.contains("/Applications"),
        "{json}"
    );
    assert!(json.contains("\"lifeplan\""));
    assert_eq!(view.consent_state, "given");
    assert!(view.share.is_some());
}

/// 事務所で共有しているときは、同意の記録とAIの候補の判断に、書いた人（メンバー）が残る（0023 の6）
#[test]
fn authors_are_recorded_when_the_office_is_shared() {
    let author = ai_share::Author {
        member_id: "0b8c2d4e-1a3f-4c5d-8e6f-7a8b9c0d1e2f".into(),
        name: "担当A".into(),
    };
    let mut b = book();
    let r = b
        .record_consent(
            &consent(ConsentDecision::Refused),
            TODAY,
            NOW,
            Some(author.clone()),
        )
        .unwrap();
    assert_eq!(r.recorded_by.as_ref(), Some(&author));
    let composed: Value = serde_json::from_str(&b.compose(&[]).unwrap()).unwrap();
    assert_eq!(composed["consents"][0]["recordedBy"]["name"], "担当A");
    // 共有していないとき（書いた人なし）は欄を書かない
    let mut c = book();
    c.record_consent(&consent(ConsentDecision::Refused), TODAY, NOW, None)
        .unwrap();
    let composed: Value = serde_json::from_str(&c.compose(&[]).unwrap()).unwrap();
    assert!(composed["consents"][0].get("recordedBy").is_none());
}
