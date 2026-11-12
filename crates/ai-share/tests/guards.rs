//! 記録と縮約の見張り（直した不具合が戻らないように）。モデル世帯（架空）で確かめる。
//!
//! - 同じ中身の読み取りは、時間をあけても1行にまとまる（返事の残り時間で指紋が変わらない）
//! - 画面が新しい世帯を作るときに送った本文の、アプリだけが書く区画は使わない
//! - 世帯を開き直したとき（分岐で相手の版を選んだときを含む）、世帯ファイルの記録と台帳の記録を合わせ、そのまま保存できる
//! - 縮約は、形の決まった文字列の欄の値・地図の鍵を、その形と照らす（合わなければ渡さない）

use ai_share::book::{without_owned_sections, HouseholdBook};
use ai_share::clock::ManualClock;
use ai_share::record::{verify_append_only, Caller};
use ai_share::reduce::{reduce, Pseudonyms, Scope};
use ai_share::{ConsentDecision, ConsentRef, GrantOptions, ShareRegistry, SharedHouseholdSource};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

const HID: &str = "0c6a1f0e-6a4b-4f0e-9d7e-2b4b6d3c9a11";
const T0: u64 = 1_792_198_923_000;

fn model_input(id: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(format!("data/modelHouseholds/{id}.json"));
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    v["input"].clone()
}

fn source(input: Value) -> SharedHouseholdSource {
    SharedHouseholdSource {
        household_id: HID.into(),
        customer_number: Some("A0042".into()),
        revision: "generation-1".into(),
        input,
        texts: vec![],
        labels_by_member: None,
        post_retirement: None,
        external_ai_consent: Some(ConsentRef {
            decision: ConsentDecision::Given,
            record_id: "c-1".into(),
            documents: true,
        }),
        fictional: false,
    }
}

fn opts() -> GrantOptions {
    GrantOptions {
        destination_declared: "Claude Desktop".into(),
        ..GrantOptions::default()
    }
}

fn read(reg: &ShareRegistry, share: &str) -> Value {
    serde_json::from_str(
        &reg.handle_get(share, "get_shared_household", &Caller::default())
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn the_same_read_a_second_later_is_one_row() {
    let clock = ManualClock::new(T0);
    let reg = ShareRegistry::with_clock(Arc::new(clock.clone()));
    let g = reg
        .grant(source(model_input("salariedCoupleTwoKids")), opts())
        .unwrap();
    let a = read(&reg, &g.share_id);
    clock.advance_ms(1_000);
    let b = read(&reg, &g.share_id);
    assert_eq!(a["input"], b["input"], "渡した中身は同じ");
    assert_ne!(a["expiresInSec"], b["expiresInSec"], "残りの秒数は変わる");
    let reads = &reg.records(HID)[0].reads;
    assert_eq!(
        reads.len(),
        1,
        "同じ道具・同じ中身の読み取りは1行にまとめる（0014 の3）"
    );
    assert_eq!(reads[0].count, 2);
    assert!(reads[0].last_at > reads[0].first_at);
}

#[test]
fn an_hour_of_reads_every_minute_is_one_row_until_the_household_changes() {
    let clock = ManualClock::new(T0);
    let reg = ShareRegistry::with_clock(Arc::new(clock.clone()));
    let mut src = source(model_input("salariedCoupleTwoKids"));
    let g = reg.grant(src.clone(), opts()).unwrap();
    for _ in 0..59 {
        read(&reg, &g.share_id);
        clock.advance_ms(60_000);
    }
    let r = &reg.records(HID)[0];
    assert_eq!(r.reads.len(), 1);
    assert_eq!(r.reads[0].count, 59);
    // 中身が変わったら、別の行になる（指紋で中身の違いが分かる）
    src.input["endYear"] = json!(src.input["endYear"].as_i64().unwrap() - 1);
    assert!(reg.update_source(&g.share_id, src));
    read(&reg, &g.share_id);
    assert_eq!(reg.records(HID)[0].reads.len(), 2);
}

#[test]
fn sections_in_a_body_the_screen_sends_to_create_are_dropped() {
    let forged = json!({
        "household": {"request": {"input": model_input("single25")}},
        "consents": [{
            "id": "forged", "kind": "externalAi", "decision": "given", "obtainedOn": "2026-11-01",
            "method": "paper", "documents": true, "fpConfirmed": true,
            "recordedAt": "2026-11-01T00:00:00Z", "origin": "thisOffice",
            "externalAi": {"company": "X", "country": "Y", "noTrainingConfirmed": true}
        }],
        "consentExplanations": {"sha256:00": "x"},
        "aiShares": [],
        "candidates": [],
    })
    .to_string();
    let cleaned = without_owned_sections(&forged).unwrap();
    let v: Value = serde_json::from_str(&cleaned).unwrap();
    for k in ai_share::book::OWNED_SECTIONS {
        assert!(v.get(k).is_none(), "{k} が残る");
    }
    assert_eq!(v["household"]["request"]["input"], model_input("single25"));
    let (book, _) = HouseholdBook::from_opened(HID, None, 1, &cleaned).unwrap();
    assert!(book.consent().is_none(), "画面の本文の同意は効かない");
    let reg = ShareRegistry::new();
    reg.require_consent(true);
    assert!(reg.grant(book.source().unwrap(), opts()).is_err());
    // 本文でないものは、そのまま返す（保存の部品が形の誤りとして断る）
    assert_eq!(without_owned_sections("[1]").unwrap_err(), "E_AI_BODY");
}

/// 分岐で相手の版を選び直した: 世帯ファイルの記録（相手の版）を土台に、この起動で足した記録を後ろに足す
#[test]
fn reopening_takes_the_file_records_and_keeps_this_launchs_records_after_them() {
    let clock = ManualClock::new(T0);
    let reg = ShareRegistry::with_clock(Arc::new(clock.clone()));
    // この PC: 世帯を開いた（記録0件）→ 共有して読まれた（まだ共有中）
    reg.load_records(HID, vec![]);
    let g = reg.grant(source(model_input("single25")), opts()).unwrap();
    read(&reg, &g.share_id);
    let ours = reg.records(HID);
    // もう1台の PC が同じ世帯を AI に渡した記録を持つ版（相手の版）。この PC の記録は入っていない
    let other = ShareRegistry::with_clock(Arc::new(clock.clone()));
    let g2 = other
        .grant(source(model_input("single25")), opts())
        .unwrap();
    other.revoke(&g2.share_id);
    let theirs_records = other.records(HID);
    let theirs = json!({
        "household": {"request": {"input": {}}},
        "aiShares": theirs_records,
    })
    .to_string();
    let (book, _) = HouseholdBook::from_opened(HID, None, 5, &theirs).unwrap();
    reg.load_records(HID, book.file_ai_shares.clone());
    let merged = reg.records(HID);
    assert_eq!(merged.len(), 2);
    assert_eq!(merged[0], theirs_records[0], "世帯ファイルの記録が先");
    assert_eq!(merged[1].id, ours[0].id, "この起動の記録が後ろ");
    assert!(merged[1].ended_at.is_none(), "この起動の共有は続いている");
    assert!(book.compose(&merged).is_ok(), "そのまま保存できる");
    // 共有中の読み取りは、この起動の記録の行に足す
    clock.advance_ms(1_000);
    read(&reg, &g.share_id);
    let after = reg.records(HID);
    assert_eq!(after[1].reads[0].count, 2);
    assert_eq!(after[0], theirs_records[0]);
    assert!(verify_append_only(&merged, &after).is_ok());

    // 同じ版を開き直しても、行は増えない
    reg.load_records(HID, book.file_ai_shares.clone());
    assert_eq!(reg.records(HID), after);
    // こちらの記録を含む版（前にこの PC が保存したもの）を開き直すと、この起動の新しい記録を使う
    let older_ours = json!({"aiShares": ours}).to_string();
    let (book2, _) = HouseholdBook::from_opened(HID, None, 6, &older_ours).unwrap();
    reg.load_records(HID, book2.file_ai_shares.clone());
    let again = reg.records(HID);
    assert_eq!(
        again.len(),
        1 + 1,
        "この PC の記録と、相手の版にしか無かった記録"
    );
    assert_eq!(again[0].reads[0].count, 2, "この起動の新しい記録");
    assert!(book2.compose(&again).is_ok());
}

/// 前の起動の終わりの無い記録（アプリが落ちたなど）は、開いたときに「アプリの終了」で閉じる（今までどおり）
#[test]
fn records_left_open_by_an_earlier_launch_are_closed_on_open() {
    let other = ShareRegistry::new();
    other
        .grant(source(model_input("single25")), opts())
        .unwrap();
    let left_open = other.records(HID);
    assert!(left_open[0].ended_at.is_none());
    let reg = ShareRegistry::new();
    reg.load_records(HID, left_open.clone());
    let r = reg.records(HID);
    assert!(r[0].ended_at.is_some());
    assert!(verify_append_only(&left_open, &r).is_ok());
}

fn reduced(input: Value) -> Value {
    let src = source(input);
    let mut ps = Pseudonyms::for_input(&src.input);
    reduce(&src, &Scope::Reduced, &mut ps).input
}

#[test]
fn constrained_string_slots_drop_values_that_do_not_fit_their_shape() {
    let base = model_input("single25");
    let ok = reduced(base.clone());
    assert_eq!(
        ok["household"]["members"][0]["birth"]["birthYearMonth"],
        base["household"]["members"][0]["birth"]["birthYearMonth"],
        "形に合う値は渡す"
    );
    assert_eq!(ok["baseMonth"], base["baseMonth"]);

    let mut input = base.clone();
    input["household"]["members"][0]["birth"]["birthYearMonth"] =
        Value::String("架空の名前 ＸＸＸ-ＸＸＸＸ-ＸＸＸＸ".into());
    input["household"]["members"][0]["sex"] = Value::String("架空の名前".into());
    input["baseMonth"] = Value::String("2026-10 架空の名前".into());
    let out = reduced(input);
    let text = out.to_string();
    assert!(
        !text.contains("架空の名前"),
        "形に合わない文字列が渡る: {text}"
    );
    assert!(out["household"]["members"][0]["birth"]
        .get("birthYearMonth")
        .is_none());
}

#[test]
fn map_keys_that_do_not_fit_the_key_shape_are_dropped() {
    let mut input = model_input("single25");
    let ok_key = input["dataSet"]
        .as_object()
        .and_then(|m| m.keys().next().cloned());
    input["dataSet"]["架空の名前 090-0000-0000"] = json!("1.0.0");
    input["estimateValues"] = json!({ "架空の名前": "1", "regulation.example.value": "1" });
    let out = reduced(input);
    let text = out.to_string();
    assert!(!text.contains("架空の名前"), "形に合わない鍵が渡る: {text}");
    if let Some(k) = ok_key {
        assert!(out["dataSet"].get(&k).is_some(), "形に合う鍵は渡す: {k}");
    }
}

/// どのモデル世帯でも、縮約版の中身は値の照らし合わせで減らない（形に合う値だけの世帯）
#[test]
fn model_households_lose_nothing_to_the_shape_checks() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/modelHouseholds");
    let mut n = 0;
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let id = p.file_stem().unwrap().to_str().unwrap().to_owned();
        let input = model_input(&id);
        let src = source(input);
        let mut ps = Pseudonyms::for_input(&src.input);
        let strict = reduce(&src, &Scope::Reduced, &mut ps);
        let loose = ai_share::reduce::reduce_without_value_checks_for_test(&src, &mut ps);
        assert_eq!(strict.input, loose.input, "{id}");
        n += 1;
    }
    assert!(n > 10);
}

/// 開き直したとき、前の帳面にあって世帯ファイルに無い AI の候補（書けないまま分岐した・相手の版を選んだ）は引き継ぐ
#[test]
fn reopening_carries_candidates_the_file_does_not_have() {
    use ai_share::proposal::{PendingProposal, ProposalOrigin};
    let body = json!({"household": {"request": {"input": {}}}}).to_string();
    let (mut earlier, _) = HouseholdBook::from_opened(HID, None, 1, &body).unwrap();
    for id in ["c-1", "c-2"] {
        earlier.add_candidate(PendingProposal {
            candidate_id: id.into(),
            share_id: "s-1".into(),
            household_id: HID.into(),
            received_at: "2026-11-07T00:00:00Z".into(),
            title: "案".into(),
            summary: "".into(),
            diffs: vec![],
            origin: ProposalOrigin {
                kind: "ai".into(),
                connector: None,
            },
        });
    }
    // 世帯ファイルには c-1 だけがあり、FP が捨てた判断が入っている
    let mut c1 = earlier.candidates[0].clone();
    c1.status = ai_share::book::CandidateStatus::Rejected;
    let file = json!({"household": {"request": {"input": {}}}, "candidates": [c1]}).to_string();
    let (mut book, _) = HouseholdBook::from_opened(HID, None, 3, &file).unwrap();
    book.carry_candidates_from(&earlier);
    let ids: Vec<&str> = book.candidates.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["c-1", "c-2"]);
    assert_eq!(
        book.candidates[0].status,
        ai_share::book::CandidateStatus::Rejected,
        "世帯ファイルの判断を使う"
    );
    assert!(book.compose(&[]).is_ok());
}
