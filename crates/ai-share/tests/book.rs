//! 世帯ごとの「同意とAIの記録」の帳面と、アプリの方針（同意が必須）の試験。モデル世帯（架空）で確かめる。
//!
//! - 同意が無い世帯は渡せず、接続口からも見えない・読めない
//! - 同意を撤回したら、その場で読めなくなる
//! - 縮約版に、識別子（世帯の内部ID・顧客番号・呼び名）とFPのメモ・面談の履歴が入らない
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
/// 今日（版3の説明を出した日。境目の日を直しても通るように、その定数から）
const TODAY: &str = ai_share::consent::EXTERNAL_AI_EXPLANATION_V3_SINCE;
const NOW: &str = "2026-11-23T01:00:00Z";

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
        // 書類の読み取りの記録（0148）も、どの版でも AI に渡さない（候補・元の場所の文字・照合の値は計算の要求の外）
        "documents": {
            "version": 1,
            "readings": [{ "id": "doc-1", "kind": "document", "candidates": [{ "source": { "text": "目印の書類の文字" }, "note": "目印の添え書き" }], "references": [{ "label": "目印の照合", "amount": 2470000 }] }]
        },
        // 面談の履歴（0182）も、どの版でも AI に渡さない（お客さまと見てよい欄も FP だけの欄も、計算の要求の外）
        "meetings": {
            "version": 1,
            "records": [{ "id": "mt-1", "on": "2026-10-19", "shared": { "talked": "目印の話したこと", "decided": "目印の決めたこと", "todo": "目印の次まで", "insurance": { "initial": "目印の当初の意向", "final": "", "reason": "" } }, "fpOnly": { "note": "目印の面談のFPメモ" } }]
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
        "documents",
        "目印の書類の文字",
        "目印の添え書き",
        "2470000",
        "meetings",
        "目印の話したこと",
        "目印の当初の意向",
        "目印の面談のFPメモ",
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
        false,
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

/// 版1の説明（書類を含まない）で同意した世帯（0157）: 計算の項目は今までどおり渡せるが、書類の候補は受けない。
/// 今の版の説明で取り直すと、書類の候補も受け、説明文は両方の版が1回ずつ写る
#[test]
fn consents_on_the_first_explanation_need_renewal_for_documents() {
    let v1 = ai_share::consent::EXTERNAL_AI_EXPLANATION_V1;
    let v1_ref = ai_share::consent::explanation_ref(v1);
    let mut file: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    file["consents"] = json!([{
        "id": "c-old", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-10-19", "method": "paper",
        "explanationRef": v1_ref,
        "externalAi": { "company": "架空AI株式会社", "country": "日本", "noTrainingConfirmed": true },
        "scope": "reduced", "fpConfirmed": true, "recordedAt": "2026-10-19T00:00:00Z", "origin": "thisOffice"
    }]);
    file["consentExplanations"] = json!({ v1_ref.clone(): v1 });
    let (mut b, _) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &file.to_string())
            .unwrap();
    let (reg, _) = registry();
    let view = b.view(&[], None, false);
    assert_eq!(view.consent_state, "given");
    assert!(!view.consent_documents);
    assert_eq!(view.explanation_version, 3);
    assert_ne!(view.explanation_ref, v1_ref);

    // 計算の項目は渡せる・読める。書類の候補は受けない（共有は閉じない）
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    get(&reg, &g.share_id).unwrap();
    let answer: Value = serde_json::from_str(
        &std::fs::read_to_string(
            repo().join("crates/lifeplan/tests/fixtures/propose-inputs/answer.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let err = reg
        .handle_propose_documents(&g.share_id, &answer, &Caller::default())
        .unwrap_err();
    assert!(err.1.contains("前の版の説明"), "{}", err.1);
    assert!(reg.document_proposals(HOUSEHOLD_ID).is_empty());
    get(&reg, &g.share_id).unwrap();

    // 書き戻しても前の行は変わらない（documents の欄を足さない）
    let composed: Value =
        serde_json::from_str(&b.compose(&reg.records(HOUSEHOLD_ID)).unwrap()).unwrap();
    assert!(composed["consents"][0].get("documents").is_none());

    // 今の版の説明で取り直す: 同意がもうあっても記録できる
    let r = b
        .record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    assert!(r.documents);
    assert!(b.view(&[], None, false).consent_documents);
    assert_eq!(b.explanations.len(), 2, "両方の版の説明文が1回ずつ");
    assert_eq!(b.explanations.get(&v1_ref).map(String::as_str), Some(v1));
    assert!(reg.update_source(&g.share_id, b.source().unwrap()));
    reg.handle_propose_documents(&g.share_id, &answer, &Caller::default())
        .unwrap();
    assert_eq!(reg.document_proposals(HOUSEHOLD_ID).len(), 1);
    // 今の版の同意は2回は記録しない
    assert_eq!(
        b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
            .unwrap_err(),
        "E_AI_CONSENT_ALREADY"
    );
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

/// 定年後の働き方の条件（世帯ファイルの household.postRetirement。0195）は、数と選択肢だけを縮約版に入れる（物の ID は仮名）。
/// 条件の無い世帯は空の条件として渡す（画面で保存した世帯を開いたときと同じく、推し量らない）。渡した記録の項目にも残る
#[test]
fn post_retirement_goes_with_numbers_and_choices_only() {
    let (reg, _) = registry();
    let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    let self_id = v["household"]["request"]["input"]["household"]["members"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    v["household"]["postRetirement"] = json!({
        self_id.clone(): { "fromAge": 60, "type": "contract", "annualSalary": 3000000, "memo": "目印の定年のメモ" },
    });
    let (mut b, _) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &v.to_string())
            .unwrap();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    let got: Value = serde_json::from_str(&get(&reg, &g.share_id).unwrap()).unwrap();
    let post = got["postRetirement"].as_object().unwrap();
    assert_eq!(post.len(), 1);
    let (alias, cond) = post.iter().next().unwrap();
    assert_ne!(alias, &self_id, "物の ID が仮名になっていません");
    assert_eq!(
        alias.as_str(),
        got["input"]["household"]["members"][0]["id"]
            .as_str()
            .unwrap()
    );
    assert_eq!(
        cond,
        &json!({ "fromAge": 60, "type": "contract", "annualSalary": 3000000 })
    );
    let text = got.to_string();
    assert!(!text.contains("目印の定年のメモ") && !text.contains(&self_id));
    assert!(got["fields"]
        .as_array()
        .unwrap()
        .contains(&json!("postRetirement")));
    assert!(reg.records(HOUSEHOLD_ID)[0]
        .fields
        .contains(&"postRetirement".to_owned()));

    // 条件の無い世帯: 空の条件
    let mut plain = book();
    plain
        .record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g2 = reg.grant(plain.source().unwrap(), opts()).unwrap();
    let got2: Value = serde_json::from_str(&get(&reg, &g2.share_id).unwrap()).unwrap();
    assert_eq!(got2["postRetirement"], json!({}));
}

/// 候補の変更の場所 at・lever（0201。世帯ファイルの形式 0.75）: 世帯ファイルの候補を開いて書き戻すと、場所を添えた候補も添えない候補も
/// 1文字も変わらない（前の版の候補に欄を書き足さない）。画面に返す本文には候補の区画が無い
#[test]
fn candidate_places_survive_open_and_save() {
    let p = repo().join("crates/household-store/tests/fixtures/household-format/0.75/body.json");
    let body: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let (b, screen) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &body.to_string())
            .unwrap();
    assert!(serde_json::from_str::<Value>(&screen)
        .unwrap()
        .get("candidates")
        .is_none());
    assert_eq!(b.candidates.len(), 2);
    assert!(b.candidates[0].diffs[0].at.is_none() && b.candidates[0].diffs[0].lever.is_none());
    assert_eq!(
        b.candidates[1].diffs[0].lever.as_deref(),
        Some("investStopAge")
    );
    assert_eq!(b.candidates[1].diffs[1].at.as_ref().unwrap().len(), 3);
    let composed: Value = serde_json::from_str(&b.compose(&[]).unwrap()).unwrap();
    assert_eq!(composed["candidates"], body["candidates"]);
}

/// 画面の入力の進み具合（0222 の追記 2026-11-19）: 本文の保存した・足した入力項目の数と仮の値を入れた欄のキーを、接続口の計算の読み取りに
/// だけ添える（AI に見せるふつうの読み取りには添えない）。欄のキーの物の ID は仮の ID に置き換え、この世帯に無い ID の鍵は落とす
#[test]
fn the_entered_state_goes_only_to_calc_reads_with_pseudonyms() {
    let (reg, _) = registry();
    let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    let first = v["household"]["request"]["input"]["household"]["members"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let unknown = "0f0e0d0c-0b0a-4909-8807-060504030201";
    v["household"]["confirmed"] = json!(["family", "work"]);
    v["household"]["addedItems"] = json!([{ "id": "a-1" }]);
    v["household"]["assumed"] = json!({
        format!("family/{first}/birth"): "仮の値",
        format!("family/{unknown}/birth"): "仮の値",
    });
    let mut b =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &v.to_string())
            .unwrap()
            .0;
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    let calc: Value = serde_json::from_str(
        &reg.handle_get_for_calc(&g.share_id, "get_hearing_options", &Caller::default())
            .unwrap(),
    )
    .unwrap();
    let st = &calc["enteredState"];
    assert_eq!(st["confirmed"], 2);
    assert_eq!(st["addedItems"], 1);
    let assumed = st["assumed"].as_array().unwrap();
    assert_eq!(
        assumed.len(),
        1,
        "この世帯に無い ID の鍵は落とす: {assumed:?}"
    );
    let key = assumed[0].as_str().unwrap();
    assert!(key.starts_with("family/") && key.ends_with("/birth"));
    assert!(!calc.to_string().contains(&first), "物の ID は仮の ID に");
    assert!(!calc.to_string().contains(unknown));
    let view: Value = serde_json::from_str(&get(&reg, &g.share_id).unwrap()).unwrap();
    assert!(
        view.get("enteredState").is_none(),
        "AI に見せる読み取りには添えない"
    );
}

/// 顧客のフォローの要約の材料（0248）: 日付・数・区分の記号だけを読み、面談の中身・メモ・印の見出しは返事に入らない。
/// 形の合わない面談・印は数えない。面談の履歴が無い世帯は日付なし・数0
#[test]
fn followup_facts_carry_dates_and_counts_only() {
    let (reg, _) = registry();
    let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    v["meetings"]["records"].as_array_mut().unwrap().extend([
        json!({ "id": "mt-2", "on": "2026-03-02", "shared": {}, "fpOnly": {} }),
        // 形の合わない日・同じ ID は数えない
        json!({ "id": "mt-3", "on": "2026-02-30", "shared": {}, "fpOnly": {} }),
        json!({ "id": "mt-1", "on": "2027-01-01", "shared": {}, "fpOnly": {} }),
    ]);
    v["household"]["recheck"] = json!([
        { "id": "r1", "card": "c", "cardLabel": "目印の入力項目", "label": "目印の行", "on": "2026-10-01" },
        { "id": "r1", "card": "c", "cardLabel": "x", "label": "y", "on": "2026-10-01" },
        { "id": "r2", "card": "c", "cardLabel": "x", "label": "y", "on": "2026-10" },
        { "id": "r3", "card": "c", "cardLabel": "x", "label": "y", "on": "2026-10-02" }
    ]);
    v["snapshots"] = json!([
        { "id": "s1", "createdAt": "2025-04-12T10:00:00+09:00" },
        { "id": "s2", "createdAt": "2025-09-01T10:00:00+09:00" },
        { "id": "s3", "createdAt": "壊れた日付" }
    ]);
    let (mut b, _) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &v.to_string())
            .unwrap();
    b.category = Some("A".into());
    let f = b.source().unwrap().followup.unwrap();
    assert_eq!(f.category.as_deref(), Some("A"));
    assert_eq!(f.last_meeting_on.as_deref(), Some("2026-10-19"));
    assert_eq!(f.meetings, 2);
    assert_eq!(f.last_snapshot_month.as_deref(), Some("2025-09"));
    assert_eq!(f.recheck_marks, 2);

    // 返事: 計算に使う読み取りの形に followup を添える。文は入らない。記録に followup.* の項目が残る
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    let g = reg.grant(b.source().unwrap(), opts()).unwrap();
    reg.set_office_categories(Some(Arc::new(|| Some(json!({ "A": "顧問契約" })))));
    let out = reg
        .handle_get_followup(
            &g.share_id,
            "summarize_shared_households",
            &Caller::default(),
        )
        .unwrap();
    let p: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(p["followup"]["category"], "A");
    assert_eq!(p["followup"]["categoryName"], "顧問契約");
    assert_eq!(p["followup"]["recheckMarks"], 2);
    assert!(p["input"].is_object() && p.get("officeEstimates").is_some());
    for secret in ["目印", CUSTOMER_NO, HOUSEHOLD_ID, MEMO] {
        assert!(!out.contains(secret), "{secret} が渡っています");
    }
    let r = &reg.records(HOUSEHOLD_ID)[0].reads[0];
    assert_eq!(r.tool, "summarize_shared_households");
    for f in ai_share::FOLLOWUP_FIELDS {
        assert!(r.fields.iter().any(|x| x == f), "{f}");
    }
    // ふだんの読み取りの指紋とは別（材料も指紋に入る）
    get(&reg, &g.share_id).unwrap();
    let reads = &reg.records(HOUSEHOLD_ID)[0].reads;
    assert_ne!(reads[0].digest, reads[1].digest);

    // 面談の履歴・控え・印・区分の無い世帯
    let (plain, _) = HouseholdBook::from_opened(
        HOUSEHOLD_ID,
        None,
        1,
        &json!({ "household": { "request": { "input": {} } } }).to_string(),
    )
    .unwrap();
    assert_eq!(
        plain.source().unwrap().followup.unwrap(),
        ai_share::FollowupFacts::default()
    );
    // 区分の記号の形でないものは渡さない
    let mut odd = plain.clone();
    odd.category = Some("顧問".into());
    assert_eq!(odd.source().unwrap().followup.unwrap().category, None);
}

/// 本文に、名前の入ったメモと面談の履歴（両方の欄）を入れる（0249）
fn body_with_notes() -> Value {
    let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
    v["household"]["memo"] = json!([
        "田中さんのご主人は来年転職の予定",
        "長女の花子ちゃんは私立を希望"
    ]);
    v["meetings"] = json!({ "version": 1, "records": [
        { "id": "mt-1", "on": "2026-05-10",
          "shared": { "talked": "住宅の買い替え", "decided": "頭金を増やす", "todo": "源泉徴収票を用意", "insurance": { "initial": "", "final": "", "reason": "" } },
          "fpOnly": { "note": "奥さまは田中様の転職に慎重。目印の秘書のメモ", "insurance": { "initial": "医療保険を見直したい", "final": "", "reason": "" } } },
        { "id": "mt-0", "on": "2026-01-20", "shared": { "talked": "初回の相談" }, "fpOnly": { "note": "" } }
    ]});
    v
}

fn v2_consent(file: &mut Value) {
    let v2 = ai_share::consent::EXTERNAL_AI_EXPLANATION_V2;
    let r = ai_share::consent::explanation_ref(v2);
    file["consents"] = json!([{
        "id": "c-v2", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-10-19", "method": "paper",
        "explanationRef": r, "scope": "reduced", "documents": true, "fpConfirmed": true,
        "recordedAt": "2026-10-19T00:00:00Z", "origin": "thisOffice"
    }]);
    file["consentExplanations"] = json!({ r: v2 });
}

fn notes_opts(words: &[&str]) -> GrantOptions {
    GrantOptions {
        notes: true,
        mask_words: words.iter().map(|w| (*w).to_owned()).collect(),
        ..opts()
    }
}

/// メモと面談の履歴も渡す（0249）: 印の付いた共有だけ、メモと面談の両方の欄が名前を伏せて包んで渡る。印の無い共有・計算に使う読み取りでは出ない。
/// 前の版の説明の同意・断った・撤回した世帯は、事務所の2つの確かめがあっても渡せない。同意の答えが無い世帯は、事務所の2つの確かめがあれば渡せる
#[test]
fn notes_are_shared_only_with_the_mark_and_the_new_consent() {
    let (reg, _) = registry();
    reg.require_consent(true);
    // 前の版（版2）の同意: 計算の項目は渡せるが、メモと面談の履歴は渡せない
    let mut file = body_with_notes();
    v2_consent(&mut file);
    let (mut b, _) =
        HouseholdBook::from_opened(HOUSEHOLD_ID, Some(CUSTOMER_NO.into()), 1, &file.to_string())
            .unwrap();
    let view = b.view_with_notes(&[], None, false, false);
    assert!(!view.consent_notes);
    assert_eq!(view.ai_notes_use, ai_share::AiUse::ConsentWithoutNotes);
    assert_eq!(view.notes_count, 5, "メモ2行・面談の欄3つ");
    assert_eq!(
        reg.grant(b.source().unwrap(), notes_opts(&[])).unwrap_err(),
        GrantError::NotesNotAllowed {
            state: "consentWithoutNotes".into()
        }
    );
    // 印の無い共有: 今までどおり文は出ない
    let plain = reg.grant(b.source().unwrap(), opts()).unwrap();
    let out = get(&reg, &plain.share_id).unwrap();
    for secret in [
        "田中",
        "花子",
        "源泉徴収票",
        "目印の秘書のメモ",
        "医療保険を見直したい",
    ] {
        assert!(!out.contains(secret), "{secret} が渡っています");
    }
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["texts"], json!([]));
    assert_eq!(v["notes"], false);
    reg.revoke(&plain.share_id);

    // 前の版の同意は、事務所の2つの確かめがあっても渡せない（説明で「FPのメモは渡しません」と約束しているため）
    reg.set_notes_policy(true);
    reg.set_office_policy(true);
    assert_eq!(
        b.view_with_notes(&[], None, true, true).ai_notes_use,
        ai_share::AiUse::ConsentWithoutNotes
    );
    assert_eq!(
        reg.grant(b.source().unwrap(), notes_opts(&[])).unwrap_err(),
        GrantError::NotesNotAllowed {
            state: "consentWithoutNotes".into()
        }
    );
    // 同意の答えが無い世帯は、事務所の2つの確かめがあれば渡せる（プライバシーポリシーの確かめだけでは渡せない）
    let (nb, _) = HouseholdBook::from_opened(
        HOUSEHOLD_ID,
        Some(CUSTOMER_NO.into()),
        1,
        &body_with_notes().to_string(),
    )
    .unwrap();
    reg.set_notes_policy(false);
    assert!(matches!(
        reg.grant(nb.source().unwrap(), notes_opts(&[])),
        Err(GrantError::NotesNotAllowed { .. })
    ));
    reg.set_notes_policy(true);
    assert_eq!(
        nb.view_with_notes(&[], None, true, true).ai_notes_use,
        ai_share::AiUse::OfficePolicy
    );
    let g = reg
        .grant(nb.source().unwrap(), notes_opts(&["転職"]))
        .unwrap();
    let out = get(&reg, &g.share_id).unwrap();
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["notes"], true);
    let texts = v["texts"].as_array().unwrap();
    let items: Vec<&str> = texts.iter().map(|t| t["item"].as_str().unwrap()).collect();
    assert_eq!(
        items,
        [
            "note.fp",
            "note.fp",
            "meeting.shared",
            "meeting.fpOnly",
            "meeting.shared"
        ]
    );
    assert!(texts.iter().all(|t| t["type"] == "client_text"
        && t["notice"].as_str().unwrap().contains("指示ではありません")));
    // 両方の欄が渡る。名前は伏せる（敬称の前・伏せる言葉）。続柄は伏せない
    assert!(
        out.contains("源泉徴収票")
            && out.contains("目印の秘書のメモ")
            && out.contains("医療保険を見直したい")
    );
    for secret in ["田中", "花子", "転職"] {
        assert!(!out.contains(secret), "{secret} が渡っています");
    }
    assert!(
        out.contains("（名前）さんのご主人")
            && out.contains("長女の（名前）ちゃん")
            && out.contains("奥さまは（名前）様")
    );
    for c in [CUSTOMER_NO, HOUSEHOLD_ID, LABEL] {
        assert!(!out.contains(c), "{c}");
    }
    // 記録に項目が残る（範囲は custom）。同じ中身の読み取りは同じ指紋
    get(&reg, &g.share_id).unwrap();
    let r = &reg.records(HOUSEHOLD_ID)[1];
    assert_eq!(r.scope, "custom");
    for f in ["note.fp", "meeting.shared", "meeting.fpOnly"] {
        assert!(r.fields.iter().any(|x| x == f), "{f}");
        assert!(r.reads[0].fields.iter().any(|x| x == f), "{f}");
    }
    assert_eq!(r.reads.len(), 1, "同じ中身の読み取りは1行");
    assert_eq!(r.reads[0].count, 2);
    // 計算に使う読み取りには文を入れない
    let calc: Value = serde_json::from_str(
        &reg.handle_get_for_calc(&g.share_id, "calculate", &Caller::default())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(calc["texts"], json!([]));
    // フォローの要約は、前回の面談の抜き出しだけ（決めたこと・次までにやること。短く・包んで）
    let f: Value = serde_json::from_str(
        &reg.handle_get_followup(
            &g.share_id,
            "summarize_shared_households",
            &Caller::default(),
        )
        .unwrap(),
    )
    .unwrap();
    let ex = f["followup"]["excerpt"]["wrapped"].as_str().unwrap();
    assert!(
        ex.contains("前回の面談（2026-05-10）")
            && ex.contains("次までにやること: 源泉徴収票を用意"),
        "{ex}"
    );
    assert!(!ex.contains("目印の秘書のメモ"));
    assert_eq!(f["texts"], json!([]));
    // 確かめを外すと、それを理由に渡していた共有は閉じる
    assert_eq!(reg.set_notes_policy(false), 1);
    assert!(get(&reg, &g.share_id).is_err());

    // 今の版の説明で取り直すと、確かめが無くても渡せる。撤回すると渡せない
    reg.set_office_policy(false);
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    assert!(b.view(&[], None, false).consent_notes);
    let g = reg.grant(b.source().unwrap(), notes_opts(&[])).unwrap();
    // 印の無い共有のフォローの要約には抜き出しを入れない
    let p = reg.grant(b.source().unwrap(), opts()).unwrap();
    let f: Value = serde_json::from_str(
        &reg.handle_get_followup(
            &p.share_id,
            "summarize_shared_households",
            &Caller::default(),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(f["followup"].get("excerpt").is_none());
    b.record_consent(&consent(ConsentDecision::Withdrawn), TODAY, NOW, None)
        .unwrap();
    assert!(!reg.update_source(&g.share_id, b.source().unwrap()));
    assert!(matches!(
        reg.grant(b.source().unwrap(), notes_opts(&[])),
        Err(GrantError::ConsentMissing { .. })
    ));
    // 断った世帯も渡せない（事務所の確かめがあっても）
    let mut refused = book();
    refused
        .record_consent(&consent(ConsentDecision::Refused), TODAY, NOW, None)
        .unwrap();
    reg.set_office_policy(true);
    reg.set_notes_policy(true);
    assert!(matches!(
        reg.grant(refused.source().unwrap(), notes_opts(&[])),
        Err(GrantError::ConsentMissing { .. })
    ));
}

/// 世帯を開いたときの記録の読み込み（0248 の追記）: ほかの PC がいま渡している共有の記録は閉じない（期限が過ぎていれば期限切れで閉じる）。
/// この PC の前の起動の記録・PC の ID の無い前の版の記録は、今までどおり「アプリの終了」で閉じる
#[test]
fn records_of_shares_on_another_pc_are_not_closed() {
    let clock = ManualClock::new(1_792_198_923_000);
    let a = ShareRegistry::with_clock(Arc::new(clock.clone()));
    a.set_device(Some("pc-a".into()));
    let mut b = book();
    b.record_consent(&consent(ConsentDecision::Given), TODAY, NOW, None)
        .unwrap();
    a.grant(b.source().unwrap(), opts()).unwrap();
    let file = a.records(HOUSEHOLD_ID);
    assert_eq!(file[0].device.as_deref(), Some("pc-a"));
    assert!(file[0].launch.is_some());
    let load = |device: Option<&str>| {
        let r = ShareRegistry::with_clock(Arc::new(clock.clone()));
        r.set_device(device.map(str::to_owned));
        r.load_records(HOUSEHOLD_ID, file.clone());
        r.records(HOUSEHOLD_ID)[0].end_reason
    };
    // ほかの PC（期限内）: 閉じない
    assert_eq!(load(Some("pc-b")), None);
    // 同じ PC の前の起動・PC の ID が分からない: アプリの終了
    assert_eq!(load(Some("pc-a")), Some(EndReason::AppClosed));
    assert_eq!(load(None), Some(EndReason::AppClosed));
    // 前の版の記録（PC の ID が無い）: アプリの終了
    let mut legacy = file.clone();
    legacy[0].device = None;
    let r = ShareRegistry::with_clock(Arc::new(clock.clone()));
    r.set_device(Some("pc-b".into()));
    r.load_records(HOUSEHOLD_ID, legacy);
    assert_eq!(
        r.records(HOUSEHOLD_ID)[0].end_reason,
        Some(EndReason::AppClosed)
    );
    // ほかの PC の記録でも、期限が過ぎていれば期限切れ
    clock.advance_ms(61 * 60 * 1000);
    assert_eq!(load(Some("pc-b")), Some(EndReason::Expired));
}

/// 抜き出しと長い欄の切れ目（0249 の点検の直し）: 名前を伏せてから切るので、切れ目の前後に「名前＋敬称」があっても名前は残らない。
/// 「（名前）」の途中では切らない
#[test]
fn excerpt_and_long_fields_are_cut_after_masking() {
    use ai_share::registry::masked_text;
    let excerpt_of = |decided: &str, todo: &str, note: &str| {
        let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
        v["meetings"] = json!({ "version": 1, "records": [{ "id": "m1", "on": "2026-05-10",
            "shared": { "decided": decided, "todo": todo }, "fpOnly": { "note": note } }] });
        let (b, _) = HouseholdBook::from_opened(HOUSEHOLD_ID, None, 1, &v.to_string()).unwrap();
        b.source().unwrap().texts
    };
    for (field, max) in [("decided", 60usize), ("todo", 80usize)] {
        for name in ["田中", "山田太郎"] {
            // 名前の終わりが、上限の1字前・ちょうど・1字後
            for end in [max - 1, max, max + 1] {
                let n = name.chars().count();
                let text = format!("{}{name}さんに確認する", "あ".repeat(end - n));
                let (d, t) = if field == "decided" {
                    (text.as_str(), "")
                } else {
                    ("", text.as_str())
                };
                let texts = excerpt_of(d, t, "");
                let ex = texts.iter().find(|t| t.item == "meeting.excerpt").unwrap();
                let out = masked_text(&ex.item, &ex.body, &[]).text;
                assert!(!out.contains(name), "{field} {name} {end}: {out}");
                // 伏せる言葉（敬称なし）も同じ
                let text = format!("{}{name}に確認する", "あ".repeat(end - n));
                let (d, t) = if field == "decided" {
                    (text.as_str(), "")
                } else {
                    ("", text.as_str())
                };
                let texts = excerpt_of(d, t, "");
                let ex = texts.iter().find(|t| t.item == "meeting.excerpt").unwrap();
                let out = masked_text(&ex.item, &ex.body, &[name.to_owned()]).text;
                assert!(
                    !out.contains(name),
                    "伏せる言葉 {field} {name} {end}: {out}"
                );
                assert!(!out.contains("（名前") || out.contains("（名前）"), "{out}");
                assert!(!out.contains("（名…") && !out.contains("（…"), "{out}");
            }
        }
    }
    // 4000字の欄の切れ目
    for end in [3999usize, 4000, 4001] {
        let note = format!("{}田中さん", "い".repeat(end - 2));
        let texts = excerpt_of("", "", &note);
        let fp = texts.iter().find(|t| t.item == "meeting.fpOnly").unwrap();
        let out = masked_text(&fp.item, &fp.body, &[]).text;
        assert!(!out.contains("田中"), "{end}");
    }
    // 切らない長さなら、そのまま（伏せた所だけ変わる）
    let texts = excerpt_of("田中さんと決めた", "源泉徴収票", "");
    let ex = texts.iter().find(|t| t.item == "meeting.excerpt").unwrap();
    assert_eq!(
        masked_text(&ex.item, &ex.body, &[]).text,
        "前回の面談（2026-05-10）\n決めたこと: （名前）さんと決めた\n次までにやること: 源泉徴収票"
    );
}

/// 前のほうで伏せた長い語が「（名前）」に縮むとき（0249 の2回目の点検の直し）: 伏せる前に切らないので、上限の外にあった名前が上限の中に
/// 入ってきても伏せてある。切ったときは「…」が付く
#[test]
fn shrinking_masks_do_not_pull_names_into_the_excerpt() {
    use ai_share::registry::masked_text;
    let excerpt = |decided: &str, todo: &str, words: &[&str]| {
        let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
        v["meetings"] = json!({ "version": 1, "records": [{ "id": "m1", "on": "2026-05-10",
            "shared": { "decided": decided, "todo": todo }, "fpOnly": {} }] });
        let (b, _) = HouseholdBook::from_opened(HOUSEHOLD_ID, None, 1, &v.to_string()).unwrap();
        let t = b
            .source()
            .unwrap()
            .texts
            .into_iter()
            .find(|t| t.item == "meeting.excerpt")
            .unwrap();
        let w: Vec<String> = words.iter().map(|x| (*x).to_owned()).collect();
        masked_text(&t.item, &t.body, &w).text
    };
    // 伏せる言葉（15字）が2回 → 22字縮む。75〜76字目の「田中」（「さん」は77字目から）
    let co = "株式会社ヤマダコーポレーション";
    let head = format!("{co}と{co}の件");
    let n = head.chars().count();
    let decided = format!("{head}{}田中さんに確認", "あ".repeat(74 - n));
    let out = excerpt(&decided, "", &[co]);
    assert!(!out.contains("田中"), "{out}");
    assert!(out.contains("…"), "切れているのに「…」が無い: {out}");
    // 伏せる言葉なし: 長い語＋敬称が2つで縮む。95〜96字目の「山田」
    let head = "保険会社住宅資金担当責任者さんと不動産会社営業担当責任者さんの件";
    let n = head.chars().count();
    let todo = format!("{head}{}山田さんに連絡", "い".repeat(94 - n));
    let out = excerpt("", &todo, &[]);
    assert!(!out.contains("山田"), "{out}");
    assert!(out.contains("…"), "{out}");
    // 上限に収まる文には「…」を付けない
    let out = excerpt("頭金を増やす", "源泉徴収票", &[]);
    assert!(!out.contains("…"), "{out}");
}

/// 「決めたこと」「次までにやること」に改行があっても、抜き出しは欄ごとに60字・80字で切る（0249 の3回目の点検の直し）。
/// 改行のまわりの名前も伏せる
#[test]
fn excerpt_fields_with_line_breaks_are_cut_as_a_whole() {
    use ai_share::registry::masked_text;
    let excerpt = |decided: &str, todo: &str| {
        let mut v: Value = serde_json::from_str(&body("salariedCoupleTwoKids")).unwrap();
        v["meetings"] = json!({ "version": 1, "records": [{ "id": "m1", "on": "2026-05-10",
            "shared": { "decided": decided, "todo": todo }, "fpOnly": {} }] });
        let (b, _) = HouseholdBook::from_opened(HOUSEHOLD_ID, None, 1, &v.to_string()).unwrap();
        let t = b
            .source()
            .unwrap()
            .texts
            .into_iter()
            .find(|t| t.item == "meeting.excerpt")
            .unwrap();
        masked_text(&t.item, &t.body, &[]).text
    };
    let decided = format!("1つ目\n{}\n{}", "あ".repeat(300), "い".repeat(300));
    let todo = format!("{}\n{}", "う".repeat(300), "え".repeat(300));
    let out = excerpt(&decided, &todo);
    let n = out.chars().count();
    // 見出しの行（前回の面談（2026-05-10））と見出しの言葉を足しても、60＋80字と「…」2つに収まる
    assert!(
        n <= "前回の面談（2026-05-10）\n決めたこと: \n次までにやること: "
            .chars()
            .count()
            + 60
            + 80
            + 2,
        "{n}: {out}"
    );
    assert_eq!(out.matches('…').count(), 2, "{out}");
    assert!(
        out.contains("決めたこと: 1つ目 あ") && out.contains("次までにやること: "),
        "{out}"
    );
    // 欄の中に見出しと同じ文字の行が何行あっても、上限は欄ごと（行の数だけ増えない）
    let many = (0..20)
        .map(|i| format!("決めたこと: {i}{}", "か".repeat(30)))
        .collect::<Vec<_>>()
        .join("\n");
    let out = excerpt(&many, "");
    assert!(
        out.chars().count()
            <= "前回の面談（2026-05-10）\n決めたこと: ".chars().count() + 60 + 1,
        "{out}"
    );
    // 改行のまわりの名前
    let out = excerpt("頭金を増やす\n田中さんに確認", "山田様へ連絡\n書類を用意");
    assert!(!out.contains("田中") && !out.contains("山田"), "{out}");
    assert!(
        out.contains("（名前）さんに確認") && out.contains("（名前）様へ連絡"),
        "{out}"
    );
    // 上限の外の2行目にある名前は、切って出さない
    let out = excerpt(&format!("{}\n田中さんに確認", "お".repeat(70)), "");
    assert!(!out.contains("田中") && !out.contains("（名前）"), "{out}");
}
