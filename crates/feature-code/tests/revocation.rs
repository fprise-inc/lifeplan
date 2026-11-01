//! 期限なしのコードと、提供元が止めた一覧（0110 の追記）。鍵はテストの中だけで作る

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use feature_code::issuer::{self, Draft};
use feature_code::revocation::{self, apply_fetch, revoked_ids, List, Outcome, RevError};
use feature_code::{
    add, decode_unverified, issue, status, verify, CodeState, Error, Request, SecretKey,
};

fn key(kid: &str) -> SecretKey {
    SecretKey::generate(kid).unwrap()
}

fn req(id: &str, expires: Option<&str>) -> Request {
    Request {
        id: id.into(),
        name: "見本 花子".into(),
        features: vec!["combinedBs".into()],
        issued: "2026-11-01".into(),
        expires: expires.map(str::to_owned),
    }
}

fn list(serial: u64, revoked: &[&str]) -> List {
    List {
        v: 1,
        serial,
        issued: "2026-11-01".into(),
        revoked: revoked.iter().map(|s| (*s).to_owned()).collect(),
    }
}

/// コードの中身の JSON を差し替えた（署名の無い）コード。中身の形の確かめだけを見る
fn unsigned(payload: &str) -> String {
    format!(
        "LPFC1-{}.{}",
        B64.encode(payload.as_bytes()),
        B64.encode([0u8; 64])
    )
}

#[test]
fn code_without_expiry_never_expires() {
    let k = key("test-1");
    let keys = [k.public()];
    let code = issue(&k, &req("0001", None)).unwrap();
    let c = verify(&code, &keys).unwrap();
    assert_eq!(c.v, 2);
    assert_eq!(c.expires, None);
    for today in ["2026-11-01", "2030-01-01", "2999-12-31"] {
        let s = status(std::slice::from_ref(&code), &keys, today, &[]);
        assert_eq!(s.active, vec!["combinedBs"], "{today}");
        assert_eq!(s.codes[0].state, CodeState::Active);
        assert_eq!(s.codes[0].expires, None);
        assert_eq!(s.codes[0].days_left, None);
    }
    // 期限なしのコードは、期限のあるコード（更新の前のコード）を外す。逆は外さない
    let dated = issue(&k, &req("0002", Some("2027-05-31"))).unwrap();
    let l = add(&[], &dated, &keys, "2026-11-01", &[]).unwrap();
    assert_eq!(
        add(&l, &code, &keys, "2026-11-01", &[]).unwrap(),
        vec![code.clone()]
    );
    let both = add(
        std::slice::from_ref(&code),
        &dated,
        &keys,
        "2026-11-01",
        &[],
    )
    .unwrap();
    assert_eq!(both.len(), 2);
    // 並びは期限の遅い順（期限なしがいちばん遅い）
    let s = status(&both, &keys, "2026-11-01", &[]);
    assert_eq!(s.codes[0].id, "0001");
    assert_eq!(s.codes[1].id, "0002");
}

#[test]
fn old_form_codes_still_read() {
    let k = key("test-1");
    // 期限のあるコードは、前の版と同じ形（版 1・欄の並びも同じ）で出す。前の版のアプリでも読める
    let code = issue(&k, &req("0001", Some("2027-05-31"))).unwrap();
    let body = code.trim_start_matches("LPFC1-").split_once('.').unwrap().0;
    assert_eq!(
        String::from_utf8(B64.decode(body).unwrap()).unwrap(),
        r#"{"v":1,"kid":"test-1","id":"0001","name":"見本 花子","features":["combinedBs"],"issued":"2026-11-01","expires":"2027-05-31"}"#
    );
    assert_eq!(
        verify(&code, &[k.public()]).unwrap().expires.as_deref(),
        Some("2027-05-31")
    );
    // 版 1 で期限の無いもの・知らない版・版 2 で期限のあるもの
    let base = r#""kid":"test-1","id":"0001","name":"見本 花子","features":["combinedBs"],"issued":"2026-11-01""#;
    assert_eq!(
        decode_unverified(&unsigned(&format!("{{\"v\":1,{base}}}"))),
        Err(Error::FORMAT)
    );
    assert_eq!(
        decode_unverified(&unsigned(&format!(
            "{{\"v\":3,{base},\"expires\":\"2027-05-31\"}}"
        ))),
        Err(Error::FORMAT)
    );
    assert!(decode_unverified(&unsigned(&format!(
        "{{\"v\":2,{base},\"expires\":\"2027-05-31\"}}"
    )))
    .is_ok());
    assert!(decode_unverified(&unsigned(&format!("{{\"v\":2,{base}}}"))).is_ok());
}

#[test]
fn signed_list_round_trip_and_bad_lists_are_ignored() {
    let rk = key("rv-1");
    let rkeys = [rk.public()];
    let text = revocation::sign(&rk, &list(3, &["0007", "0002"])).unwrap();
    let l = revocation::verify(text.as_bytes(), &rkeys).unwrap();
    assert_eq!(l.serial, 3);
    // 名前の順に並べ直す
    assert_eq!(l.revoked, vec!["0002", "0007"]);
    // 中身を書き換えた（署名は元のまま）
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    let payload = v["payload"].as_str().unwrap();
    let mut forged = v.clone();
    forged["payload"] = payload.replace("\"0002\",", "").into();
    assert_eq!(
        revocation::verify(forged.to_string().as_bytes(), &rkeys),
        Err(RevError::SIGNATURE)
    );
    // 同じ名前の別の鍵・知らない鍵（コードの鍵で署名した一覧も、止めた一覧の鍵の並びに無いので通らない）
    assert_eq!(
        revocation::verify(text.as_bytes(), &[key("rv-1").public()]),
        Err(RevError::SIGNATURE)
    );
    let code_key = key("test-1");
    let by_code_key = revocation::sign(&code_key, &list(4, &[])).unwrap();
    assert_eq!(
        revocation::verify(by_code_key.as_bytes(), &rkeys),
        Err(RevError::KEY)
    );
    // 形の違うもの
    for bad in [
        "".to_owned(),
        "{}".to_owned(),
        "<html>not found</html>".to_owned(),
        text.replace(revocation::FORMAT, "other-format"),
        "x".repeat(revocation::MAX_LIST_BYTES + 1),
    ] {
        assert!(
            revocation::verify(bad.as_bytes(), &rkeys).is_err(),
            "{bad:.40}"
        );
    }
    // 形の違う番号・重なりは署名の前に断る
    assert!(revocation::sign(&rk, &list(1, &["番号"])).is_err());
    assert!(revocation::sign(&rk, &list(1, &["0001", "0001"])).is_err());
}

#[test]
fn stop_by_list_and_come_back_when_removed() {
    let k = key("test-1");
    let keys = [k.public()];
    let rk = key("rv-1");
    let rkeys = [rk.public()];
    let a = issue(&k, &req("0001", None)).unwrap();
    let b = issue(&k, &req("0002", Some("2027-05-31"))).unwrap();
    let codes = vec![a.clone()];
    let today = "2026-11-01";

    // 1回目: 一覧を取れた（0001 は載っていない）
    let first = revocation::sign(&rk, &list(1, &["0099"])).unwrap();
    let (saved, o) = apply_fetch(None, Some(first.as_bytes()), &rkeys);
    assert_eq!(o, Outcome::Ok);
    let ids = revoked_ids(saved.as_deref(), &rkeys);
    assert_eq!(
        status(&codes, &keys, today, &ids).active,
        vec!["combinedBs"]
    );

    // 2回目: 0001 を載せた一覧 → 止まる（中身は見えるまま。機能は出さない）
    let stopped = revocation::sign(&rk, &list(2, &["0001", "0099"])).unwrap();
    let (saved, o) = apply_fetch(saved.as_deref(), Some(stopped.as_bytes()), &rkeys);
    assert_eq!(o, Outcome::Ok);
    let ids = revoked_ids(saved.as_deref(), &rkeys);
    let s = status(&codes, &keys, today, &ids);
    assert!(s.active.is_empty());
    assert_eq!(s.codes[0].state, CodeState::Revoked);
    assert_eq!(s.codes[0].name, "見本 花子");
    // 止めたコードは入れ直せない。ほかのコードは入る
    assert_eq!(add(&[], &a, &keys, today, &ids), Err(Error::REVOKED));
    assert!(add(&codes, &b, &keys, today, &ids).is_ok());

    // つながらない: 最後に取れた一覧のまま（止まったまま）
    let (kept, o) = apply_fetch(saved.as_deref(), None, &rkeys);
    assert_eq!(o, Outcome::Offline);
    assert_eq!(kept, saved);
    // 署名の合わない一覧・壊れた一覧は無視する（止まったまま。外れたことにもしない）
    let forged = revocation::sign(&key("rv-1"), &list(3, &[])).unwrap();
    let (kept, o) = apply_fetch(saved.as_deref(), Some(forged.as_bytes()), &rkeys);
    assert_eq!(o, Outcome::Rejected(RevError::SIGNATURE));
    assert_eq!(kept, saved);
    let (kept, o) = apply_fetch(saved.as_deref(), Some(b"<html>503</html>"), &rkeys);
    assert_eq!(o, Outcome::Rejected(RevError::FORMAT));
    assert_eq!(kept, saved);
    // 古い一覧（通し番号が小さい）は受け付けない（外れたことにしない）
    let (kept, o) = apply_fetch(saved.as_deref(), Some(first.as_bytes()), &rkeys);
    assert_eq!(o, Outcome::Rejected(RevError::OLDER));
    assert_eq!(kept, saved);

    // 3回目: 一覧から外した → 次に確かめたときに戻る（コードの入れ直しは要らない）
    let back = revocation::sign(&rk, &list(3, &["0099"])).unwrap();
    let (saved, o) = apply_fetch(saved.as_deref(), Some(back.as_bytes()), &rkeys);
    assert_eq!(o, Outcome::Ok);
    let ids = revoked_ids(saved.as_deref(), &rkeys);
    let s = status(&codes, &keys, today, &ids);
    assert_eq!(s.active, vec!["combinedBs"]);
    assert_eq!(s.codes[0].state, CodeState::Active);

    // 保存しておいた一覧が確かめられない（鍵を差し替えた後など）ときは止めない
    assert!(revoked_ids(Some(stopped.as_bytes()), &[key("rv-2").public()]).is_empty());
    assert!(revoked_ids(Some(b"broken"), &rkeys).is_empty());
    // 一度も取れていない・つながらない: 止めない（今の状態のまま使える）
    let (none, o) = apply_fetch(None, None, &rkeys);
    assert_eq!((none, o), (None, Outcome::Offline));
    assert_eq!(
        status(&codes, &keys, today, &revoked_ids(None, &rkeys)).active,
        vec!["combinedBs"]
    );
}

#[test]
fn expired_and_revoked_codes_show_revoked() {
    let k = key("test-1");
    let keys = [k.public()];
    let code = issue(&k, &req("0001", Some("2027-05-31"))).unwrap();
    let s = status(&[code], &keys, "2027-06-10", &["0001".to_owned()]);
    // 期限が切れていても、止めたコードは「止めた」として出す
    assert_eq!(s.codes[0].state, CodeState::Revoked);
    assert!(s.active.is_empty());
}

#[test]
fn issuer_draft_add_remove_sign() {
    let rk = key("rv-1");
    let mut d = Draft::default();
    assert_eq!(
        issuer::draft_add(&mut d, &["0007".into(), "0002".into()]).unwrap(),
        vec!["0007", "0002"]
    );
    // 既にある番号は飛ばす。形の違う番号は断る
    assert!(issuer::draft_add(&mut d, &["0002".into()])
        .unwrap()
        .is_empty());
    assert!(issuer::draft_add(&mut d, &["番号".into()]).is_err());
    assert_eq!(d.revoked, vec!["0002", "0007"]);
    let (text, next) = issuer::sign_draft(&rk, &d, "2026-11-01").unwrap();
    assert_eq!(next.serial, 1);
    let l = revocation::verify(text.as_bytes(), &[rk.public()]).unwrap();
    assert_eq!(
        (l.serial, l.revoked.clone()),
        (1, vec!["0002".into(), "0007".into()])
    );
    // 外して署名し直すと、通し番号が上がる
    let mut d = next;
    issuer::draft_remove(&mut d, &["0007".into()]).unwrap();
    assert!(issuer::draft_remove(&mut d, &["0007".into()]).is_err());
    let (text2, next2) = issuer::sign_draft(&rk, &d, "2026-11-02").unwrap();
    assert_eq!(next2.serial, 2);
    let (saved, o) = apply_fetch(
        Some(text.as_bytes()),
        Some(text2.as_bytes()),
        &[rk.public()],
    );
    assert_eq!(o, Outcome::Ok);
    assert_eq!(revoked_ids(saved.as_deref(), &[rk.public()]), vec!["0002"]);
    // 下書きのファイル（リポジトリの中は断る）
    let inside = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("draft.json");
    assert!(issuer::write_draft(&inside, &d).is_err());
    assert!(!inside.exists());
    let dir = std::env::temp_dir().join(format!("feature-code-rv-{}", std::process::id()));
    let p = dir.join("revocations-draft.json");
    assert_eq!(issuer::read_draft(&p).unwrap(), None);
    issuer::write_draft(&p, &d).unwrap();
    assert_eq!(issuer::read_draft(&p).unwrap(), Some(d));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn batch_no_expiry_needs_an_explicit_word() {
    let k = key("test-1");
    let rows = issuer::read_batch(
        "name,features,expires\n一人目,combinedBs,none\n二人目,combinedBs,なし\n",
    )
    .unwrap();
    let out = issuer::issue_batch(&k, &rows, &[], "2026-11-01").unwrap();
    assert!(out.iter().all(|(c, _)| c.expires.is_none() && c.v == 2));
    assert!(issuer::record_line(&out[0].0).ends_with(",combinedBs,,2026-11-01"));
    // 空の期限は誤り（書き忘れで期限なしのコードを出さない）
    let empty = issuer::read_batch("name,features,expires\n三人目,combinedBs,\n").unwrap();
    assert!(issuer::issue_batch(&k, &empty, &[], "2026-11-01")
        .unwrap_err()
        .contains("2行目"));
}
