//! AIが組み立てた新しい世帯の候補（propose_household）の承認待ちと、架空の世帯の共有の決まり。モデル世帯（架空）で確かめる。

use ai_share::clock::ManualClock;
use ai_share::households::{MAX_PENDING, MAX_TITLE_CHARS};
use ai_share::record::{Caller, EndReason};
use ai_share::{
    ConsentDecision, ConsentRef, GrantError, GrantOptions, ShareRegistry, SharedHouseholdSource,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const HOUSEHOLD_ID: &str = "8d1b3c4e-2f5a-4b6c-9d7e-0f1a2b3c4d5e";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn model_input(id: &str) -> Value {
    let s =
        std::fs::read_to_string(repo().join(format!("data/modelHouseholds/{id}.json"))).unwrap();
    serde_json::from_str::<Value>(&s).unwrap()["input"].clone()
}

fn registry() -> (Arc<ShareRegistry>, ManualClock) {
    let clock = ManualClock::new(1_792_198_923_000);
    let reg = Arc::new(ShareRegistry::with_clock(Arc::new(clock.clone())));
    // アプリ本体と同じく、同意を必須にする
    reg.require_consent(true);
    (reg, clock)
}

fn caller() -> Caller {
    Caller {
        mcp_client_declared: Some("test-ai\n1.2".into()),
        ..Caller::default()
    }
}

fn proposal(kind: &str) -> Value {
    json!({
        "kind": kind,
        "title": "セミナー用 38歳の会社員と扶養のパートの妻",
        "note": "妻のパートの年収は扶養の範囲（100万円）と推定",
        "input": model_input("sampleCoupleNoKids"),
    })
}

fn propose(reg: &ShareRegistry, p: &Value) -> Result<Value, String> {
    reg.handle_propose_household(p, &caller())
        .map(|s| serde_json::from_str(&s).unwrap())
        .map_err(|(code, msg)| format!("{}: {msg}", code.as_str()))
}

/// 新しい世帯の候補は、承認待ちに入るだけ（世帯は作らない）。同じ中身はまとめ、上限を超えたら断り、作った・捨てた候補は外れる
#[test]
fn household_candidates_wait_for_the_fp() {
    let (reg, _) = registry();
    let r = propose(&reg, &proposal("fictional")).unwrap();
    assert_eq!(r["status"], "pendingReview");
    assert_eq!(r["kind"], "fictional");
    assert!(r["message"]
        .as_str()
        .unwrap()
        .contains("世帯の一覧も変わりません"));
    let id = r["candidateId"].as_str().unwrap().to_owned();
    let list = reg.household_candidates();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].candidate_id, id);
    assert_eq!(list[0].kind, "fictional");
    assert_eq!(
        list[0].connector.as_deref(),
        Some("test-ai 1.2"),
        "名乗りの改行は空白にする"
    );
    assert_eq!(list[0].received_at, "2026-10-17T01:02:03Z");
    assert_eq!(list[0].input, model_input("sampleCoupleNoKids"));
    // 世帯は作らない・共有も作らない
    assert!(reg.active_shares().is_empty());
    assert!(reg.records(HOUSEHOLD_ID).is_empty());
    // 同じ中身をもう一度出しても1件のまま
    let again = propose(&reg, &proposal("fictional")).unwrap();
    assert_eq!(again["candidateId"], json!(id));
    assert_eq!(reg.household_candidates().len(), 1);
    // 種類だけ違えば別の候補
    propose(&reg, &proposal("client")).unwrap();
    assert_eq!(reg.household_candidates().len(), 2);
    // 上限
    for i in 2..MAX_PENDING {
        let mut p = proposal("client");
        p["title"] = json!(format!("候補{i}"));
        propose(&reg, &p).unwrap();
    }
    let mut p = proposal("client");
    p["title"] = json!("多すぎる候補");
    let e = propose(&reg, &p).unwrap_err();
    assert!(e.starts_with("INVALID") && e.contains("多すぎ"), "{e}");
    // 1つ外すと出せる
    assert_eq!(reg.take_household_candidate(&id).unwrap().candidate_id, id);
    assert!(reg.take_household_candidate(&id).is_none(), "2回は外せない");
    assert!(reg.household_candidate(&id).is_none());
    propose(&reg, &p).unwrap();
    // AI接続口をオフにしたとき
    reg.clear_household_candidates();
    assert!(reg.household_candidates().is_empty());
}

/// 形の外側の確かめと、アプリ本体が入れる入力の確かめ（計算エンジンのスキーマ）。断ったら何も入らない
#[test]
fn household_candidates_are_checked() {
    let (reg, _) = registry();
    for (bad, word) in [
        (json!({ "kind": "sample" }), "kind"),
        (
            json!({ "kind": "fictional", "title": "x".repeat(MAX_TITLE_CHARS + 1) }),
            "60",
        ),
        (
            json!({ "kind": "fictional", "title": "t", "input": "x" }),
            "input",
        ),
        (
            json!({ "kind": "fictional", "title": "t", "input": { "household": {} } }),
            "members",
        ),
    ] {
        let e = propose(&reg, &bad).unwrap_err();
        assert!(e.starts_with("INVALID") && e.contains(word), "{e}");
    }
    assert!(reg.household_candidates().is_empty());
    // 入力の確かめ（アプリ本体はエンジンのスキーマで確かめる）: 断れば理由を返し、入れない。確かめは1回だけ
    let calls = Arc::new(AtomicUsize::new(0));
    let n = calls.clone();
    reg.set_household_check(Some(Arc::new(move |input: &Value| {
        n.fetch_add(1, Ordering::SeqCst);
        if input["household"]["members"]
            .as_array()
            .is_some_and(|m| m.len() > 1)
        {
            Ok(())
        } else {
            Err("計算の入力の形が違います（E_INPUT_SCHEMA）".to_owned())
        }
    })));
    let mut one = proposal("fictional");
    one["input"]["household"]["members"] = json!([one["input"]["household"]["members"][0]]);
    let e = propose(&reg, &one).unwrap_err();
    assert!(e.contains("E_INPUT_SCHEMA"), "{e}");
    assert!(reg.household_candidates().is_empty());
    propose(&reg, &proposal("fictional")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(reg.household_candidates().len(), 1);
}

fn source(fictional: bool, consent: Option<ConsentDecision>) -> SharedHouseholdSource {
    SharedHouseholdSource {
        household_id: HOUSEHOLD_ID.into(),
        customer_number: Some("C0007".into()),
        revision: "generation-1".into(),
        input: model_input("sampleCoupleNoKids"),
        texts: vec![],
        labels_by_member: None,
        post_retirement: None,
        external_ai_consent: consent.map(|decision| ConsentRef {
            decision,
            record_id: "c-1".into(),
            documents: decision == ConsentDecision::Given,
        }),
        fictional,
    }
}

fn opts() -> GrantOptions {
    GrantOptions {
        destination_declared: "Claude Desktop".into(),
        ..GrantOptions::default()
    }
}

fn read(reg: &ShareRegistry, share_id: &str) -> Result<Value, String> {
    reg.handle_get(share_id, "get_shared_household", &caller())
        .map(|s| serde_json::from_str(&s).unwrap())
        .map_err(|(c, _)| c.as_str().to_owned())
}

/// 架空の世帯は同意の記録が無くても渡せる。期限・取り消し・記録・縮約版は同じ。お客さまの世帯は今までどおり同意が要る
#[test]
fn fictional_households_share_without_consent_and_clients_still_need_it() {
    let (reg, clock) = registry();
    // お客さまの世帯（同意なし・同意しなかった・撤回）は渡せない
    for c in [
        None,
        Some(ConsentDecision::Refused),
        Some(ConsentDecision::Withdrawn),
    ] {
        assert!(matches!(
            reg.grant(source(false, c), opts()),
            Err(GrantError::ConsentMissing { .. })
        ));
    }
    // 架空の世帯は渡せる（記録の同意の欄は fictional・警告なし）
    let g = reg.grant(source(true, None), opts()).unwrap();
    assert!(!g.consent_warned);
    let rec = reg.records(HOUSEHOLD_ID);
    assert_eq!(rec[0].consent_at_grant.state, "fictional");
    assert_eq!(rec[0].consent_at_grant.record_id, None);
    assert!(!rec[0].consent_at_grant.warned);
    // 縮約版で読める・一覧に出る・読んだ記録が残る
    let v = read(&reg, &g.share_id).unwrap();
    assert_eq!(v["scope"], "reduced");
    assert!(!v.to_string().contains(HOUSEHOLD_ID) && !v.to_string().contains("C0007"));
    let list: Value = serde_json::from_str(&reg.handle_list().unwrap()).unwrap();
    assert_eq!(list["shares"].as_array().unwrap().len(), 1);
    assert_eq!(reg.records(HOUSEHOLD_ID)[0].reads[0].count, 1);
    // 書類から読んだ値の候補も受ける（お客さまの書類を含む世帯ではない）
    let answer: Value = serde_json::from_str(
        &std::fs::read_to_string(
            repo().join("crates/lifeplan/tests/fixtures/propose-inputs/answer.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(reg
        .handle_propose_documents(&g.share_id, &answer, &caller())
        .is_ok());
    // 期限は同じ
    clock.advance_ms(60 * 60 * 1000);
    assert_eq!(read(&reg, &g.share_id).unwrap_err(), "EXPIRED");
    // 取り消しも同じ
    let g2 = reg.grant(source(true, None), opts()).unwrap();
    assert!(reg.revoke(&g2.share_id));
    assert_eq!(read(&reg, &g2.share_id).unwrap_err(), "REVOKED");
    // 架空からお客さまの世帯にした（同意なし）: 共有中の共有はその場で閉じる
    let g3 = reg.grant(source(true, None), opts()).unwrap();
    assert!(!reg.update_source(&g3.share_id, source(false, None)));
    assert_eq!(read(&reg, &g3.share_id).unwrap_err(), "REVOKED");
    assert_eq!(
        reg.records(HOUSEHOLD_ID)[2].end_reason,
        Some(EndReason::ConsentWithdrawn)
    );
    // お客さまの世帯にしても、同意を記録してあれば続く
    let g4 = reg.grant(source(true, None), opts()).unwrap();
    assert!(reg.update_source(&g4.share_id, source(false, Some(ConsentDecision::Given))));
    assert!(read(&reg, &g4.share_id).is_ok());
}
