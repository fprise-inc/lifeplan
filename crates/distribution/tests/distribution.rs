//! 配布と更新の目録の確かめ方のテスト（0017・0022・0117）。
//!
//! 鍵はすべてテストの中で作る使い捨てのもの（決まった種から作る）。本物の鍵・証明書は使わない。
//! `tests/data/tauri-*` は、本物の道具（`tauri signer generate`・`tauri signer sign`）で作った使い捨ての鍵の公開鍵と署名で、
//! この部品の minisign の読み方が Tauri の出すものと合うことを確かめる（秘密鍵はリポジトリに置いていない）。

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine as _;
use distribution::app_catalog::{self, UpdatePlan};
use distribution::envelope;
use distribution::keys::{KeyConfig, KeyRing, Role};
use distribution::minisig::{testing, MinisignPublicKey, MinisignSignature};
use distribution::pack_catalog::{self, Decision, Installed};
use distribution::revocations::{self, AppGate, Freshness};
use distribution::rollout::{Cohort, Wait};
use distribution::{parse_utc, Reject, Version};
use ed25519_dalek::SigningKey;
use serde_json::json;

const FIXTURE_PUB: &str = include_str!("data/tauri-throwaway.pub");
const FIXTURE_PAYLOAD: &str = include_str!("data/tauri-catalog-payload.json");
const FIXTURE_SIG: &str = include_str!("data/tauri-catalog-payload.json.sig");

fn sk(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn ed_line(kid: &str, seed: u8) -> String {
    format!(
        "{kid}:{}",
        B64URL.encode(sk(seed).verifying_key().to_bytes())
    )
}

const APP_CUR: ([u8; 8], u8) = ([1, 0, 0, 0, 0, 0, 0, 0xA1], 11);
const APP_NEXT: ([u8; 8], u8) = ([2, 0, 0, 0, 0, 0, 0, 0xA2], 12);

/// 現用・次期の2本ずつを入れた束
fn ring() -> KeyRing {
    let app = [
        testing::tauri_pubkey(&sk(APP_CUR.1), APP_CUR.0),
        testing::tauri_pubkey(&sk(APP_NEXT.1), APP_NEXT.0),
    ];
    let data = [ed_line("data-a", 21), ed_line("data-b", 22)];
    let auto = [ed_line("auto-a", 31), ed_line("auto-b", 32)];
    let rev = [ed_line("rev-a", 41), ed_line("rev-b", 42)];
    let (app, data, auto, rev) = (strs(&app), strs(&data), strs(&auto), strs(&rev));
    KeyRing::from_config(&KeyConfig {
        app_update: &app,
        data: &data,
        auto_delivery: &auto,
        revocation: &rev,
    })
    .unwrap()
}

fn t(s: &str) -> i64 {
    parse_utc(s).unwrap()
}

fn strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

const NOW: &str = "2027-03-10T00:00:00Z";

// ---- 鍵の束 ----

#[test]
fn ring_from_config_rules() {
    let r = ring();
    assert_eq!(r.for_role(Role::Data).count(), 2);
    assert!(r.get(Role::Data, "data-a").is_some());
    assert!(
        r.get(Role::AutoDelivery, "data-a").is_none(),
        "役割が違えば見つからない"
    );

    let three = [
        ed_line("data-a", 21),
        ed_line("data-b", 22),
        ed_line("data-c", 23),
    ];
    let three: Vec<&str> = three.iter().map(String::as_str).collect();
    assert!(KeyRing::from_config(&KeyConfig {
        data: &three,
        ..Default::default()
    })
    .is_err());

    // 同じ公開鍵を2つの役割に使わない
    let d = [ed_line("data-a", 21)];
    let a = [ed_line("auto-a", 21)];
    let (d, a): (Vec<&str>, Vec<&str>) = (
        d.iter().map(String::as_str).collect(),
        a.iter().map(String::as_str).collect(),
    );
    assert!(KeyRing::from_config(&KeyConfig {
        data: &d,
        auto_delivery: &a,
        ..Default::default()
    })
    .is_err());

    // 鍵の名前の重なり・形の誤り
    let dup = [ed_line("same", 21), ed_line("same", 22)];
    let dup: Vec<&str> = dup.iter().map(String::as_str).collect();
    assert!(KeyRing::from_config(&KeyConfig {
        data: &dup,
        ..Default::default()
    })
    .is_err());
    assert!(KeyRing::from_config(&KeyConfig {
        data: &["Data-A:xxxx"],
        ..Default::default()
    })
    .is_err());
    assert!(KeyRing::from_config(&KeyConfig {
        app_update: &["not-a-tauri-key"],
        ..Default::default()
    })
    .is_err());

    // 空の設定（鍵を入れる前）は空の束
    assert!(KeyRing::from_config(&KeyConfig::default())
        .unwrap()
        .is_empty());
}

#[test]
fn revoked_keys_leave_the_ring_except_revocation_keys() {
    let r = ring().without(&["data-a".into(), "rev-a".into(), "auto-b".into()]);
    assert!(r.get(Role::Data, "data-a").is_none());
    assert!(r.get(Role::Data, "data-b").is_some());
    assert!(r.get(Role::AutoDelivery, "auto-b").is_none());
    assert!(
        r.get(Role::Revocation, "rev-a").is_some(),
        "取り下げ用の鍵は一覧では外せない"
    );
}

// ---- minisign（Tauri の形） ----

#[test]
fn reads_keys_and_signatures_made_by_the_real_tauri_tool() {
    let pk = MinisignPublicKey::from_tauri(FIXTURE_PUB).unwrap();
    assert_eq!(pk.kid(), "900E2F4996888A89");
    let sig = MinisignSignature::from_tauri(FIXTURE_SIG).unwrap();
    assert_eq!(sig.kid(), pk.kid());
    assert!(sig.trusted_comment().contains("file:catalog-payload.json"));
    assert!(sig.verify(&pk, FIXTURE_PAYLOAD.as_bytes()));
    let mut tampered = FIXTURE_PAYLOAD.to_owned();
    tampered.push(' ');
    assert!(!sig.verify(&pk, tampered.as_bytes()));
    // 別の鍵では確かめられない
    let other =
        MinisignPublicKey::from_tauri(&testing::tauri_pubkey(&sk(APP_CUR.1), APP_CUR.0)).unwrap();
    assert!(!sig.verify(&other, FIXTURE_PAYLOAD.as_bytes()));
}

#[test]
fn tampered_trusted_comment_is_rejected() {
    let pk =
        MinisignPublicKey::from_tauri(&testing::tauri_pubkey(&sk(APP_CUR.1), APP_CUR.0)).unwrap();
    let good = testing::tauri_sign(&sk(APP_CUR.1), APP_CUR.0, b"hello", "timestamp:1");
    assert!(MinisignSignature::from_tauri(&good)
        .unwrap()
        .verify(&pk, b"hello"));
    // 注記だけを書き換えた署名
    use base64::engine::general_purpose::STANDARD as B64;
    let text = String::from_utf8(B64.decode(&good).unwrap()).unwrap();
    let forged = B64.encode(text.replace("timestamp:1", "timestamp:2"));
    assert!(!MinisignSignature::from_tauri(&forged)
        .unwrap()
        .verify(&pk, b"hello"));
}

// ---- 封筒 ----

#[test]
fn envelope_accepts_current_and_next_rejects_others() {
    let r = ring();
    let payload = r#"{"format":"x"}"#;
    for (kid, seed) in [("data-a", 21), ("data-b", 22)] {
        let e = envelope::seal(payload, "t-envelope", &[(kid, &sk(seed))]);
        let o = envelope::open(e.as_bytes(), "t-envelope", &[Role::Data], &r).unwrap();
        assert_eq!(o.kid, kid);
        assert_eq!(o.payload, payload);
    }
    // 知らない鍵
    let e = envelope::seal(payload, "t-envelope", &[("data-z", &sk(29))]);
    assert_eq!(
        envelope::open(e.as_bytes(), "t-envelope", &[Role::Data], &r),
        Err(Reject::KEY)
    );
    // 役割の違う鍵（取り下げ用の鍵でデータに署名した）
    let e = envelope::seal(payload, "t-envelope", &[("rev-a", &sk(41))]);
    assert_eq!(
        envelope::open(e.as_bytes(), "t-envelope", &[Role::Data], &r),
        Err(Reject::KEY)
    );
    // 名前は合っているが、別の秘密鍵で署名した
    let e = envelope::seal(payload, "t-envelope", &[("data-a", &sk(99))]);
    assert_eq!(
        envelope::open(e.as_bytes(), "t-envelope", &[Role::Data], &r),
        Err(Reject::SIGNATURE)
    );
    // 署名なし・形の名前の違い
    let e = envelope::seal(payload, "t-envelope", &[]);
    assert_eq!(
        envelope::open(e.as_bytes(), "t-envelope", &[Role::Data], &r),
        Err(Reject::KEY)
    );
    let e = envelope::seal(payload, "t-envelope", &[("data-a", &sk(21))]);
    assert_eq!(
        envelope::open(e.as_bytes(), "other-envelope", &[Role::Data], &r),
        Err(Reject::FORMAT)
    );
    // 中身を書き換えた
    let tampered = e.replace(r#"\"x\""#, r#"\"y\""#);
    assert_ne!(tampered, e);
    assert_eq!(
        envelope::open(tampered.as_bytes(), "t-envelope", &[Role::Data], &r),
        Err(Reject::SIGNATURE)
    );
}

#[test]
fn envelope_has_the_same_shape_as_the_notices_envelope() {
    // お知らせの一覧（0087）の封筒の必須の欄と同じ名前であること
    let e = envelope::seal("{}", "financia-notices-envelope", &[("data-a", &sk(21))]);
    let v: serde_json::Value = serde_json::from_str(&e).unwrap();
    for k in ["format", "formatVersion", "payload", "signatures"] {
        assert!(v.get(k).is_some(), "{k}");
    }
    let s = &v["signatures"][0];
    for k in ["keyId", "alg", "sig"] {
        assert!(s.get(k).is_some(), "{k}");
    }
}

// ---- アプリ本体の更新の目録 ----

fn app_payload(over: serde_json::Value) -> String {
    let mut p = json!({
        "format": "financia-app-catalog",
        "catalogVersion": "1.0",
        "serial": 5,
        "issuedAt": "2027-03-01T00:00:00Z",
        "expiresAt": "2027-06-01T00:00:00Z",
        "version": "1.2.0",
        "rollout": { "stage": 1, "percent": 10 },
        "paused": false,
        "noDefer": false,
        "critical": []
    });
    for (k, v) in over.as_object().unwrap() {
        p[k] = v.clone();
    }
    p.to_string()
}

fn app_envelope(payload: &str, key: ([u8; 8], u8)) -> String {
    json!({
        "format": "financia-app-catalog-envelope",
        "formatVersion": "1.0",
        "payload": payload,
        "signature": testing::tauri_sign(&sk(key.1), key.0, payload.as_bytes(), "timestamp:1")
    })
    .to_string()
}

fn v(s: &str) -> Version {
    Version::app(s).unwrap()
}

#[test]
fn app_catalog_signed_by_the_real_tauri_tool_is_accepted() {
    let pubkey = FIXTURE_PUB.trim();
    let r = KeyRing::from_config(&KeyConfig {
        app_update: &[pubkey],
        ..Default::default()
    })
    .unwrap();
    let env = json!({
        "format": "financia-app-catalog-envelope",
        "formatVersion": "1.0",
        "payload": FIXTURE_PAYLOAD,
        "signature": FIXTURE_SIG.trim()
    })
    .to_string();
    let ok = app_catalog::verify(env.as_bytes(), &r, None, t(NOW)).unwrap();
    assert_eq!(ok.signer_kid(), "900E2F4996888A89");
    match app_catalog::plan(&ok, &v("0.1.0"), Cohort::new(99).unwrap(), None) {
        UpdatePlan::Offer {
            version,
            tauri_pubkey,
            required,
        } => {
            assert_eq!(version, "0.2.0");
            assert_eq!(
                tauri_pubkey, pubkey,
                "Tauri の updater にそのまま渡せる文字列"
            );
            assert!(!required);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn app_catalog_rotation_current_and_next() {
    let r = ring();
    let p = app_payload(json!({}));
    let a = app_catalog::verify(app_envelope(&p, APP_CUR).as_bytes(), &r, None, t(NOW)).unwrap();
    let b = app_catalog::verify(app_envelope(&p, APP_NEXT).as_bytes(), &r, None, t(NOW)).unwrap();
    assert_ne!(a.signer_kid(), b.signer_kid());
    // 次期の鍵で署名したものは、次期の公開鍵を Tauri に渡す
    let pk_of = |plan| match plan {
        UpdatePlan::Offer { tauri_pubkey, .. } => tauri_pubkey,
        other => panic!("{other:?}"),
    };
    let c = Cohort::new(0).unwrap();
    assert_eq!(
        pk_of(app_catalog::plan(&b, &v("1.1.0"), c, None)),
        testing::tauri_pubkey(&sk(APP_NEXT.1), APP_NEXT.0)
    );
    assert_ne!(
        pk_of(app_catalog::plan(&a, &v("1.1.0"), c, None)),
        pk_of(app_catalog::plan(&b, &v("1.1.0"), c, None))
    );
    // 取り下げた鍵は使わない
    let without = r.without(&[a.signer_kid()]);
    assert_eq!(
        app_catalog::verify(app_envelope(&p, APP_CUR).as_bytes(), &without, None, t(NOW))
            .unwrap_err(),
        Reject::KEY
    );
    // 知らない鍵
    let stranger = ([9, 9, 9, 9, 9, 9, 9, 9], 77);
    assert_eq!(
        app_catalog::verify(app_envelope(&p, stranger).as_bytes(), &r, None, t(NOW)).unwrap_err(),
        Reject::KEY
    );
}

#[test]
fn app_catalog_rejects_tampered_old_expired_unknown() {
    let r = ring();
    let now = t(NOW);
    let good = app_envelope(&app_payload(json!({})), APP_CUR);
    let tampered = good.replace("1.2.0", "9.9.9");
    assert_eq!(
        app_catalog::verify(tampered.as_bytes(), &r, None, now).unwrap_err(),
        Reject::SIGNATURE
    );
    assert_eq!(
        app_catalog::verify(good.as_bytes(), &r, Some(6), now).unwrap_err(),
        Reject::OLDER
    );
    assert!(app_catalog::verify(good.as_bytes(), &r, Some(5), now).is_ok());
    assert_eq!(
        app_catalog::verify(good.as_bytes(), &r, None, t("2027-06-01T00:00:00Z")).unwrap_err(),
        Reject::EXPIRED
    );
    let major2 = app_envelope(&app_payload(json!({ "catalogVersion": "2.0" })), APP_CUR);
    assert_eq!(
        app_catalog::verify(major2.as_bytes(), &r, None, now).unwrap_err(),
        Reject::UNSUPPORTED
    );
    // 知らない欄は、critical に載っていなければ無視する。載っていれば当てない
    let extra = app_envelope(&app_payload(json!({ "newThing": 1 })), APP_CUR);
    assert!(app_catalog::verify(extra.as_bytes(), &r, None, now).is_ok());
    let crit = app_envelope(
        &app_payload(json!({ "newThing": 1, "critical": ["newThing"] })),
        APP_CUR,
    );
    assert_eq!(
        app_catalog::verify(crit.as_bytes(), &r, None, now).unwrap_err(),
        Reject::UNSUPPORTED
    );
    // データ用の鍵では署名できない（封筒の形が違う・鍵の役割が違う）
    let data_signed = envelope::seal(
        &app_payload(json!({})),
        "financia-app-catalog-envelope",
        &[("data-a", &sk(21))],
    );
    assert_eq!(
        app_catalog::verify(data_signed.as_bytes(), &r, None, now).unwrap_err(),
        Reject::FORMAT
    );
}

#[test]
fn app_rollout_pause_and_minimum() {
    let r = ring();
    let now = t(NOW);
    let cat = |over| {
        app_catalog::verify(
            app_envelope(&app_payload(over), APP_CUR).as_bytes(),
            &r,
            None,
            now,
        )
        .unwrap()
    };
    let ten = cat(json!({}));
    let c = |n| Cohort::new(n).unwrap();
    assert!(matches!(
        app_catalog::plan(&ten, &v("1.1.0"), c(9), None),
        UpdatePlan::Offer { .. }
    ));
    assert_eq!(
        app_catalog::plan(&ten, &v("1.1.0"), c(10), None),
        UpdatePlan::Wait(Wait::NotYourTurn)
    );
    assert_eq!(
        app_catalog::plan(&ten, &v("1.2.0"), c(0), None),
        UpdatePlan::UpToDate
    );
    assert_eq!(
        app_catalog::plan(&ten, &v("1.3.0"), c(0), None),
        UpdatePlan::UpToDate,
        "古い版へ戻さない"
    );
    // 一時停止
    let paused = cat(json!({ "paused": true, "rollout": { "stage": 2, "percent": 100 } }));
    assert_eq!(
        app_catalog::plan(&paused, &v("1.1.0"), c(0), None),
        UpdatePlan::Wait(Wait::Paused)
    );
    // 最低版より古いアプリは、段階の順番を待たずに受け取り、遅らせられない
    match app_catalog::plan(&ten, &v("1.0.0"), c(99), Some(&v("1.2.0"))) {
        UpdatePlan::Offer { required, .. } => assert!(required),
        other => panic!("{other:?}"),
    }
    // 目録の版が最低版に届かないなら、順番どおり
    assert_eq!(
        app_catalog::plan(&ten, &v("1.0.0"), c(99), Some(&v("1.5.0"))),
        UpdatePlan::Wait(Wait::NotYourTurn)
    );
    let no_defer = cat(json!({ "noDefer": true, "rollout": { "stage": 3, "percent": 100 } }));
    match app_catalog::plan(&no_defer, &v("1.1.0"), c(50), None) {
        UpdatePlan::Offer { required, .. } => assert!(required),
        other => panic!("{other:?}"),
    }
}

// ---- データパックの配信の目録 ----

const PACK_BYTES: &[u8] = b"{\"packId\":\"regulation.tax\"}";

fn sha256_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

fn pack_payload(signer: (&str, &str), over: serde_json::Value) -> String {
    let mut p = json!({
        "format": "financia-pack-catalog",
        "catalogVersion": "1.0",
        "packId": "regulation.tax",
        "field": "tax",
        "version": "2027.3.1",
        "signer": { "keyId": signer.0, "role": signer.1 },
        "file": { "path": "packs/regulation.tax/2027.3.1.json", "sha256": sha256_hex(PACK_BYTES), "size": PACK_BYTES.len() },
        "changes": [{ "valueId": "incomeTax.basicDeduction", "kind": "addPeriod", "from": "2027-04" }],
        "issuedAt": "2027-03-01T00:00:00Z",
        "serial": 12,
        "expiresAt": "2027-06-01T00:00:00Z",
        "reviewWindowEndsAt": null,
        "rollout": { "stage": 0, "percent": 100 },
        "paused": false,
        "rollbackOf": null,
        "critical": []
    });
    for (k, v) in over.as_object().unwrap() {
        p[k] = v.clone();
    }
    p.to_string()
}

fn pack_env(payload: &str, kid: &str, seed: u8) -> String {
    envelope::seal(
        payload,
        "financia-pack-catalog-envelope",
        &[(kid, &sk(seed))],
    )
}

fn none() -> Installed<'static> {
    Installed::default()
}

#[test]
fn pack_catalog_signed_by_data_key() {
    let r = ring();
    let now = t(NOW);
    for (kid, seed) in [("data-a", 21), ("data-b", 22)] {
        let e = pack_env(&pack_payload((kid, "data"), json!({})), kid, seed);
        let ok = pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap();
        assert_eq!(ok.role, Role::Data);
        assert_eq!(
            pack_catalog::decide(&ok, Some("2027.3.0"), Cohort::new(99).unwrap(), now),
            Decision::Apply
        );
        assert_eq!(
            pack_catalog::decide(&ok, Some("2027.3.1"), Cohort::new(0).unwrap(), now),
            Decision::AlreadyInstalled
        );
        assert!(pack_catalog::check_file(&ok, PACK_BYTES).is_ok());
        assert_eq!(
            pack_catalog::check_file(&ok, b"{\"packId\":\"regulation.tay\"}"),
            Err(Reject::DIGEST)
        );
    }
    // 人の鍵なら、自動配信の範囲の外の変更も受け付ける
    let e = pack_env(
        &pack_payload(
            ("data-a", "data"),
            json!({ "changes": [{ "valueId": "x.y", "kind": "addValue" }] }),
        ),
        "data-a",
        21,
    );
    assert!(pack_catalog::verify(e.as_bytes(), &r, &none(), now).is_ok());
}

#[test]
fn pack_catalog_signer_must_match_the_key() {
    let r = ring();
    let now = t(NOW);
    // 「data」と書いて自動配信用の鍵で署名した
    let e = pack_env(&pack_payload(("data-a", "data"), json!({})), "auto-a", 31);
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::SIGNER_MISMATCH
    );
    // 自動配信用の鍵で、署名者を「data」と偽った
    let e = pack_env(&pack_payload(("auto-a", "data"), json!({})), "auto-a", 31);
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::SIGNER_MISMATCH
    );
    // 取り下げ用の鍵は目録に使えない
    let e = pack_env(
        &pack_payload(("rev-a", "revocation"), json!({})),
        "rev-a",
        41,
    );
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::KEY
    );
}

#[test]
fn auto_delivery_scope_and_review_window() {
    let r = ring();
    let now = t(NOW);
    let auto = ("auto-a", "auto_delivery");
    let window = json!({ "reviewWindowEndsAt": "2027-03-12T00:00:00Z" });
    let ok = pack_env(&pack_payload(auto, window.clone()), "auto-a", 31);
    let ok = pack_catalog::verify(ok.as_bytes(), &r, &none(), now).unwrap();
    assert_eq!(ok.role, Role::AutoDelivery);
    let c = Cohort::new(0).unwrap();
    assert_eq!(
        pack_catalog::decide(&ok, Some("2027.3.0"), c, now),
        Decision::Wait(Wait::ReviewWindow)
    );
    assert_eq!(
        pack_catalog::decide(&ok, Some("2027.3.0"), c, t("2027-03-12T00:00:00Z")),
        Decision::Apply
    );

    // 確認期間の無い自動配信、範囲の外の変更は受け付けない
    let no_window = pack_env(&pack_payload(auto, json!({})), "auto-a", 31);
    assert_eq!(
        pack_catalog::verify(no_window.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::SCOPE
    );
    for kind in ["addValue", "modifyPeriod", "changeStatus", "removePeriod"] {
        let mut over = window.clone();
        over["changes"] = json!([{ "valueId": "incomeTax.basicDeduction", "kind": kind }]);
        let e = pack_env(&pack_payload(auto, over), "auto-a", 31);
        assert_eq!(
            pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
            Reject::SCOPE,
            "{kind}"
        );
    }
    let mut empty = window.clone();
    empty["changes"] = json!([]);
    let e = pack_env(&pack_payload(auto, empty), "auto-a", 31);
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::SCOPE
    );
    // 巻き戻し: 前の版を指して、足した期間を外すのは自動配信用の鍵でもよい（版は新しくする）
    let mut rb = window.clone();
    rb["version"] = json!("2027.3.2");
    rb["rollbackOf"] = json!("2027.3.1");
    rb["changes"] = json!([{ "valueId": "incomeTax.basicDeduction", "kind": "removePeriod", "from": "2027-04" }]);
    let e = pack_env(&pack_payload(auto, rb), "auto-a", 31);
    assert!(pack_catalog::verify(e.as_bytes(), &r, &none(), now).is_ok());
    // 巻き戻しの元は、配る版より前でなければならない
    let mut bad_rb = window;
    bad_rb["rollbackOf"] = json!("2027.3.1");
    let e = pack_env(&pack_payload(auto, bad_rb), "auto-a", 31);
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::FORMAT
    );
}

#[test]
fn pack_rollout_pause_old_expired_unknown() {
    let r = ring();
    let now = t(NOW);
    let data = ("data-a", "data");
    let staged = pack_env(
        &pack_payload(data, json!({ "rollout": { "stage": 1, "percent": 25 } })),
        "data-a",
        21,
    );
    let staged = pack_catalog::verify(staged.as_bytes(), &r, &none(), now).unwrap();
    assert_eq!(
        pack_catalog::decide(&staged, None, Cohort::new(24).unwrap(), now),
        Decision::Apply
    );
    assert_eq!(
        pack_catalog::decide(&staged, None, Cohort::new(25).unwrap(), now),
        Decision::Wait(Wait::NotYourTurn)
    );
    let paused = pack_env(&pack_payload(data, json!({ "paused": true })), "data-a", 21);
    let paused = pack_catalog::verify(paused.as_bytes(), &r, &none(), now).unwrap();
    assert_eq!(
        pack_catalog::decide(&paused, None, Cohort::new(0).unwrap(), now),
        Decision::Wait(Wait::Paused)
    );

    let e = pack_env(&pack_payload(data, json!({})), "data-a", 21);
    let older_serial = Installed {
        last_serial: Some(13),
        version: None,
    };
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &older_serial, now).unwrap_err(),
        Reject::OLDER
    );
    let newer_installed = Installed {
        last_serial: Some(12),
        version: Some("2027.4.0"),
    };
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &newer_installed, now).unwrap_err(),
        Reject::OLDER
    );
    assert_eq!(
        pack_catalog::verify(e.as_bytes(), &r, &none(), t("2027-06-01T00:00:00Z")).unwrap_err(),
        Reject::EXPIRED
    );
    let crit = pack_env(
        &pack_payload(data, json!({ "zzz": 1, "critical": ["zzz"] })),
        "data-a",
        21,
    );
    assert_eq!(
        pack_catalog::verify(crit.as_bytes(), &r, &none(), now).unwrap_err(),
        Reject::UNSUPPORTED
    );
    // ほかのホスト・上の階層を指す場所は使えない
    for path in ["https://example.com/p.json", "../p.json", "/abs/p.json"] {
        let mut over = json!({});
        over["file"] =
            json!({ "path": path, "sha256": sha256_hex(PACK_BYTES), "size": PACK_BYTES.len() });
        let e = pack_env(&pack_payload(data, over), "data-a", 21);
        assert_eq!(
            pack_catalog::verify(e.as_bytes(), &r, &none(), now).unwrap_err(),
            Reject::FORMAT,
            "{path}"
        );
    }
}

#[test]
fn pack_index_is_split_into_envelopes() {
    let r = ring();
    let a = pack_env(&pack_payload(("data-a", "data"), json!({})), "data-a", 21);
    let b = pack_env(
        &pack_payload(
            ("data-b", "data"),
            json!({ "packId": "master.education.tuition", "field": "tuition" }),
        ),
        "data-b",
        22,
    );
    let index = json!({
        "format": "financia-pack-index",
        "formatVersion": "1.0",
        "entries": [serde_json::from_str::<serde_json::Value>(&a).unwrap(), serde_json::from_str::<serde_json::Value>(&b).unwrap()]
    })
    .to_string();
    let entries = pack_catalog::split_index(index.as_bytes()).unwrap();
    assert_eq!(entries.len(), 2);
    for e in entries {
        assert!(pack_catalog::verify(&e, &r, &none(), t(NOW)).is_ok());
    }
}

// ---- 取り下げの一覧 ----

fn rev_payload(over: serde_json::Value) -> String {
    let mut p = json!({
        "format": "fprise-lifeplan-revocations",
        "formatVersion": "1.0",
        "serial": 42,
        "issuedAt": "2027-03-01T00:00:00Z",
        "expiresAt": "2027-05-30T00:00:00Z",
        "minAppVersion": "1.2.0",
        "revoked": {
            "regulationValues": [{ "id": "incomeTax.basicDeduction", "packVersion": "2027.3.1" }],
            "componentRevisions": [{ "id": "pension.oldAge.basic", "revision": 14 }],
            "packs": [{ "id": "regulation.tax", "version": "2027.3.0" }],
            "appVersions": ["1.1.3"],
            "keys": ["data-a"]
        },
        "notice": "事実だけの短い説明"
    });
    for (k, v) in over.as_object().unwrap() {
        p[k] = v.clone();
    }
    p.to_string()
}

fn rev_env(payload: &str, kid: &str, seed: u8) -> String {
    envelope::seal(
        payload,
        "fprise-lifeplan-revocations-envelope",
        &[(kid, &sk(seed))],
    )
}

#[test]
fn revocations_list_rules() {
    let r = ring();
    let e = rev_env(&rev_payload(json!({})), "rev-b", 42);
    let list = revocations::verify(e.as_bytes(), &r, Some(42)).unwrap();
    assert_eq!(
        revocations::verify(e.as_bytes(), &r, Some(43)).unwrap_err(),
        Reject::OLDER
    );
    // データ用の鍵では取り下げの一覧に署名できない
    let e = rev_env(&rev_payload(json!({})), "data-b", 22);
    assert_eq!(
        revocations::verify(e.as_bytes(), &r, None).unwrap_err(),
        Reject::KEY
    );

    // 最低版・取り下げた版
    assert_eq!(
        revocations::app_gate(&v("1.1.9"), &list),
        AppGate::BelowMinimum
    );
    assert_eq!(revocations::app_gate(&v("1.2.0"), &list), AppGate::Ok);
    let no_min = rev_env(&rev_payload(json!({ "minAppVersion": null })), "rev-a", 41);
    let no_min = revocations::verify(no_min.as_bytes(), &r, None).unwrap();
    assert_eq!(
        revocations::app_gate(&v("1.1.3"), &no_min),
        AppGate::Revoked
    );

    // 取り下げた鍵は束から外れ、その鍵で署名した目録は受け付けない
    let ring2 = revocations::apply_to_ring(&r, &list);
    let pe = pack_env(&pack_payload(("data-a", "data"), json!({})), "data-a", 21);
    assert_eq!(
        pack_catalog::verify(pe.as_bytes(), &ring2, &none(), t(NOW)).unwrap_err(),
        Reject::KEY
    );
    let pe = pack_env(&pack_payload(("data-b", "data"), json!({})), "data-b", 22);
    assert!(pack_catalog::verify(pe.as_bytes(), &ring2, &none(), t(NOW)).is_ok());
}

#[test]
fn revocations_freshness() {
    let r = ring();
    let e = rev_env(&rev_payload(json!({})), "rev-a", 41);
    let list = revocations::verify(e.as_bytes(), &r, None).unwrap();
    let install = t("2027-01-01T00:00:00Z");
    let fetched = t("2027-03-02T00:00:00Z");
    assert_eq!(
        revocations::freshness(Some(&list), Some(fetched), install, t(NOW)),
        Freshness::Fresh
    );
    // 30日を超えて取れていない
    assert_eq!(
        revocations::freshness(
            Some(&list),
            Some(fetched),
            install,
            t("2027-04-02T00:00:01Z")
        ),
        Freshness::Stale
    );
    // 期限切れの一覧（取れていても）
    assert_eq!(
        revocations::freshness(
            Some(&list),
            Some(t("2027-05-30T00:00:00Z")),
            install,
            t("2027-05-30T00:00:00Z")
        ),
        Freshness::Stale
    );
    // 一度も取れていない
    assert_eq!(
        revocations::freshness(None, None, install, t("2027-01-02T00:00:00Z")),
        Freshness::Stale
    );
}
