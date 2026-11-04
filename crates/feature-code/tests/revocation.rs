//! 期限なしのコードと、提供元が止める（コードを止めるだけの一覧と、配布の取り下げの一覧の featureCodes。0110・0117 の追記）。
//! 本番の鍵と開発用の鍵。鍵はテストの中だけで作る

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use distribution::feature_code_revocations as fcr;
use distribution::keys::{KeyConfig, KeyRing};
use distribution::revocations::{self, Fetch};
use distribution::{envelope, parse_utc, Reject};
use ed25519_dalek::SigningKey;
use feature_code::issuer::{self, Draft};
use feature_code::{
    add, decode_unverified, issue, keys_from_ring, revoked_ids, status, verify, CodeState, Error,
    Request, SecretKey,
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

/// 取り下げ用の鍵（決まった種から作る使い捨ての鍵）
fn rv_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn rv_line(kid: &str, seed: u8) -> String {
    format!(
        "{kid}:{}",
        B64.encode(rv_key(seed).verifying_key().to_bytes())
    )
}

/// 本番の鍵の束（コードの鍵1本と取り下げ用の鍵1本）
fn ring_of(code_key: &SecretKey) -> KeyRing {
    let fc = [code_key.public().line()];
    let rv = [rv_line("rv-2026a", 41)];
    let (fc, rv): (Vec<&str>, Vec<&str>) = (
        fc.iter().map(String::as_str).collect(),
        rv.iter().map(String::as_str).collect(),
    );
    KeyRing::from_config(&KeyConfig {
        feature_code: &fc,
        revocation: &rv,
        ..Default::default()
    })
    .unwrap()
}

/// 配布の取り下げの一覧（止めるコードの番号つき）に、取り下げ用の鍵で署名する
fn rev_list(serial: u64, codes: &[&str], keys: &[&str], signer: (&str, u8)) -> String {
    let mut d = revocations::empty_draft(parse_utc("2026-11-01T00:00:00Z").unwrap());
    d.serial = serial;
    d.revoked.feature_codes = codes.iter().map(|s| (*s).to_owned()).collect();
    d.revoked.keys = keys.iter().map(|s| (*s).to_owned()).collect();
    let payload = serde_json::to_string(&d).unwrap();
    envelope::seal(
        &payload,
        revocations::ENVELOPE_FORMAT,
        &[(signer.0, &rv_key(signer.1))],
    )
}

fn ids_of(saved: Option<&[u8]>, ring: &KeyRing) -> Vec<String> {
    revocations::saved_list(saved, ring)
        .map(|v| revoked_ids(Some(&v), None))
        .unwrap_or_default()
}

#[test]
fn stop_by_distribution_list_and_come_back_when_removed() {
    let k = key("fc-2026a");
    let ring = ring_of(&k);
    let keys = keys_from_ring(&ring);
    let a = issue(&k, &req("0001", None)).unwrap();
    let b = issue(&k, &req("0002", Some("2027-05-31"))).unwrap();
    let codes = vec![a.clone()];
    let today = "2026-11-01";
    let rv = ("rv-2026a", 41);

    // 1回目: 一覧を取れた（0001 は載っていない）
    let first = rev_list(1, &["0099"], &[], rv);
    let (saved, o) = revocations::apply_fetch(None, Some(first.as_bytes()), &ring);
    assert_eq!(o, Fetch::Ok);
    let ids = ids_of(saved.as_deref(), &ring);
    assert_eq!(
        status(&codes, &keys, today, &ids).active,
        vec!["combinedBs"]
    );

    // 2回目: 0001 を載せた一覧 → 止まる（中身は見えるまま。機能は出さない）
    let stopped = rev_list(2, &["0001", "0099"], &[], rv);
    let (saved, o) = revocations::apply_fetch(saved.as_deref(), Some(stopped.as_bytes()), &ring);
    assert_eq!(o, Fetch::Ok);
    let ids = ids_of(saved.as_deref(), &ring);
    let s = status(&codes, &keys, today, &ids);
    assert!(s.active.is_empty());
    assert_eq!(s.codes[0].state, CodeState::Revoked);
    assert_eq!(s.codes[0].name, "見本 花子");
    // 止めたコードは入れ直せない。ほかのコードは入る
    assert_eq!(add(&[], &a, &keys, today, &ids), Err(Error::REVOKED));
    assert!(add(&codes, &b, &keys, today, &ids).is_ok());

    // つながらない: 最後に取れた一覧のまま（止まったまま）
    let (kept, o) = revocations::apply_fetch(saved.as_deref(), None, &ring);
    assert_eq!(o, Fetch::Offline);
    assert_eq!(kept, saved);
    // 署名の合わない一覧（知らない取り下げ用の鍵・コードの鍵では署名できない）・壊れた一覧は無視する（止まったまま）
    let forged = rev_list(3, &[], &[], ("rv-2026a", 99));
    let (kept, o) = revocations::apply_fetch(saved.as_deref(), Some(forged.as_bytes()), &ring);
    assert_eq!(o, Fetch::Rejected(Reject::SIGNATURE));
    assert_eq!(kept, saved);
    let (kept, o) = revocations::apply_fetch(saved.as_deref(), Some(b"<html>503</html>"), &ring);
    assert_eq!(o, Fetch::Rejected(Reject::FORMAT));
    assert_eq!(kept, saved);
    // 古い一覧（通し番号が小さい）は受け付けない（外れたことにしない）
    let (kept, o) = revocations::apply_fetch(saved.as_deref(), Some(first.as_bytes()), &ring);
    assert_eq!(o, Fetch::Rejected(Reject::OLDER));
    assert_eq!(kept, saved);

    // 3回目: 一覧から外した → 次に確かめたときに戻る（コードの入れ直しは要らない）
    let back = rev_list(3, &["0099"], &[], rv);
    let (saved, o) = revocations::apply_fetch(saved.as_deref(), Some(back.as_bytes()), &ring);
    assert_eq!(o, Fetch::Ok);
    let ids = ids_of(saved.as_deref(), &ring);
    let s = status(&codes, &keys, today, &ids);
    assert_eq!(s.active, vec!["combinedBs"]);
    assert_eq!(s.codes[0].state, CodeState::Active);

    // 保存しておいた一覧が確かめられない（鍵を差し替えた後など）ときは止めない
    let other = ring_of(&key("fc-2026b"));
    assert!(ids_of(Some(stopped.as_bytes()), &KeyRing::default()).is_empty());
    assert_eq!(
        ids_of(Some(stopped.as_bytes()), &other).len(),
        2,
        "取り下げ用の鍵が同じなら読める"
    );
    assert!(ids_of(Some(b"broken"), &ring).is_empty());
    // 一度も取れていない・つながらない: 止めない（今の状態のまま使える）
    let (none, o) = revocations::apply_fetch(None, None, &ring);
    assert_eq!((none, o), (None, Fetch::Offline));
}

#[test]
fn leaked_code_key_is_dropped_by_the_list() {
    // コードの鍵が漏れたとき: 取り下げの一覧の revoked.keys に鍵の名前を載せると、その鍵のコードは確かめられなくなる
    let k = key("fc-2026a");
    let ring = ring_of(&k);
    let code = issue(&k, &req("0001", None)).unwrap();
    let list = rev_list(5, &[], &["fc-2026a"], ("rv-2026a", 41));
    let v = revocations::verify(list.as_bytes(), &ring, None).unwrap();
    let after = revocations::apply_to_ring(&ring, &v);
    let keys = keys_from_ring(&after);
    assert!(keys.is_empty());
    let s = status(
        std::slice::from_ref(&code),
        &keys,
        "2026-11-01",
        &revoked_ids(Some(&v), None),
    );
    assert!(s.active.is_empty());
    assert_eq!(s.invalid[0].error, "E_FEATURE_CODE_KEY");
    // 次期の鍵で出し直したコードは使える
    let next = key("fc-2026b");
    let fc = [k.public().line(), next.public().line()];
    let rv = [rv_line("rv-2026a", 41)];
    let (fc, rv): (Vec<&str>, Vec<&str>) = (
        fc.iter().map(String::as_str).collect(),
        rv.iter().map(String::as_str).collect(),
    );
    let both = KeyRing::from_config(&KeyConfig {
        feature_code: &fc,
        revocation: &rv,
        ..Default::default()
    })
    .unwrap();
    let keys = keys_from_ring(&revocations::apply_to_ring(&both, &v));
    let renewed = issue(&next, &req("0001", None)).unwrap();
    assert_eq!(
        status(&[code, renewed], &keys, "2026-11-01", &[]).active,
        vec!["combinedBs"]
    );
}

#[test]
fn dev_key_codes_are_not_accepted_by_production_builds() {
    // 開発用の鍵（[dev_keys]。名前は dev- で始まる）で発行したコードは、開発用のビルド（with_dev）だけが受け付ける
    let prod_key = key("fc-2026a");
    let dev_key = key("dev-1");
    let prod = ring_of(&prod_key);
    let dev_line = [dev_key.public().line()];
    let dev_line: Vec<&str> = dev_line.iter().map(String::as_str).collect();
    let dev = prod
        .with_dev(&KeyConfig {
            feature_code: &dev_line,
            ..Default::default()
        })
        .unwrap();
    let dev_code = issue(&dev_key, &req("t-0001", None)).unwrap();
    let prod_code = issue(&prod_key, &req("0001", None)).unwrap();
    assert_eq!(
        verify(&dev_code, &keys_from_ring(&prod)),
        Err(Error::KEY),
        "製品のビルドでは確かめられないコード"
    );
    assert!(verify(&dev_code, &keys_from_ring(&dev)).is_ok());
    assert!(verify(&prod_code, &keys_from_ring(&dev)).is_ok());
    // 本番の欄に dev- の鍵、開発用の欄に dev- でない鍵は書けない
    assert!(KeyRing::from_config(&KeyConfig {
        feature_code: &dev_line,
        ..Default::default()
    })
    .is_err());
    let prod_line = [prod_key.public().line()];
    let prod_line: Vec<&str> = prod_line.iter().map(String::as_str).collect();
    assert!(KeyRing::default()
        .with_dev(&KeyConfig {
            feature_code: &prod_line,
            ..Default::default()
        })
        .is_err());
    // 同じ公開鍵を本番と開発用の両方に書けない
    let same = SecretKey::from_text(
        &prod_key
            .to_text()
            .replace("kid = fc-2026a", "kid = dev-9")
            .replace("public = fc-2026a:", "public = dev-9:"),
    )
    .unwrap();
    let same_line = [same.public().line()];
    let same_line: Vec<&str> = same_line.iter().map(String::as_str).collect();
    assert!(prod
        .with_dev(&KeyConfig {
            feature_code: &same_line,
            ..Default::default()
        })
        .is_err());
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

fn fr_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

/// 鍵の束に、コードを止めるだけの鍵（fr-2026a）を足したもの
fn ring_with_fr(code_key: &SecretKey) -> (KeyRing, String) {
    let fc = [code_key.public().line()];
    let rv = [rv_line("rv-2026a", 41)];
    let fr = format!(
        "fr-2026a:{}",
        B64.encode(fr_key(47).verifying_key().to_bytes())
    );
    let (fc, rv): (Vec<&str>, Vec<&str>) = (
        fc.iter().map(String::as_str).collect(),
        rv.iter().map(String::as_str).collect(),
    );
    let ring = KeyRing::from_config(&KeyConfig {
        feature_code: &fc,
        revocation: &rv,
        feature_code_revocation: &[fr.as_str()],
        ..Default::default()
    })
    .unwrap();
    (ring, fr)
}

#[test]
fn issuer_draft_add_remove_then_sign_with_the_code_revocation_key() {
    // ふだんの下書きは、コードを止めるだけの一覧（0117 の追記 2026-11-04 の2）
    let k = key("fc-2026a");
    let (ring, fr_line) = ring_with_fr(&k);
    let mut d = issuer::new_draft();
    assert!(matches!(d, Draft::Codes(_)));
    assert_eq!(d.serial(), 0);
    assert_eq!(
        issuer::draft_add(&mut d, &["0007".into(), "0002".into()]).unwrap(),
        vec!["0007", "0002"]
    );
    // 既にある番号は飛ばす。形の違う番号は断る
    assert!(issuer::draft_add(&mut d, &["0002".into()])
        .unwrap()
        .is_empty());
    assert!(issuer::draft_add(&mut d, &["番号".into()]).is_err());
    assert_eq!(d.ids(), ["0002", "0007"]);
    // 署名（配布の道具 dist-keys revocations sign と同じ段取り: 通し番号を上げ、有効期限を入れて、コードを止めるだけの鍵で封筒に入れる）
    let Draft::Codes(list) = &d else {
        unreachable!()
    };
    let now = parse_utc("2026-11-04T00:00:00Z").unwrap();
    let next = fcr::next_issue(list, now, revocations::DEFAULT_VALID_DAYS).unwrap();
    assert_eq!(next.serial, 1);
    let sealed = envelope::seal(
        &serde_json::to_string(&next).unwrap(),
        fcr::ENVELOPE_FORMAT,
        &[("fr-2026a", &fr_key(47))],
    );
    let v = fcr::verify(sealed.as_bytes(), &ring, None).unwrap();
    assert_eq!(revoked_ids(None, Some(&v)), vec!["0002", "0007"]);
    // 配信元の一覧から、配布元の設定の鍵で確かめて下書きを作り直せる（CI・続きから直すとき）
    let toml = format!("[keys]\nfeature_code_revocation = [\"{fr_line}\"]\n");
    let opened = issuer::draft_from_published(sealed.as_bytes(), &toml, false).unwrap();
    assert_eq!(
        (opened.serial(), opened.ids()),
        (1, &["0002".to_owned(), "0007".to_owned()][..])
    );
    // 鍵が設定に無い・書き換えた一覧・取り下げ用の鍵で封じた取り下げの一覧は断る
    assert!(issuer::draft_from_published(sealed.as_bytes(), "[keys]\n", false).is_err());
    let other = format!(
        "[keys]\nfeature_code_revocation = [\"fr-2026b:{}\"]\n",
        B64.encode(fr_key(48).verifying_key().to_bytes())
    );
    assert!(issuer::draft_from_published(sealed.as_bytes(), &other, false).is_err());
    let main = rev_list(3, &["0002"], &[], ("rv-2026a", 41));
    assert!(issuer::draft_from_published(main.as_bytes(), &toml, false).is_err());
    // 開発用の鍵（[dev_keys]）は --dev のときだけ
    let dev_line = format!(
        "dev-fr9:{}",
        B64.encode(fr_key(49).verifying_key().to_bytes())
    );
    let dev_toml = format!("[keys]\nfeature_code_revocation = [\"{fr_line}\"]\n[dev_keys]\nfeature_code_revocation = [\"{dev_line}\"]\n");
    let dev_sealed = envelope::seal(
        &serde_json::to_string(&next).unwrap(),
        fcr::ENVELOPE_FORMAT,
        &[("dev-fr9", &fr_key(49))],
    );
    assert!(issuer::draft_from_published(dev_sealed.as_bytes(), &dev_toml, false).is_err());
    assert!(issuer::draft_from_published(dev_sealed.as_bytes(), &dev_toml, true).is_ok());
    // 外す
    let mut d = opened;
    issuer::draft_remove(&mut d, &["0007".into()]).unwrap();
    assert!(issuer::draft_remove(&mut d, &["0007".into()]).is_err());
    // 下書きのファイル（リポジトリの中は断る。前の形の下書きは読めない）
    let inside = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("draft.json");
    assert!(issuer::write_draft(&inside, &d).is_err());
    assert!(!inside.exists());
    let dir = std::env::temp_dir().join(format!("feature-code-rv-{}", std::process::id()));
    let p = dir.join("feature-code-revocations-draft.json");
    assert_eq!(issuer::read_draft(&p).unwrap(), None);
    issuer::write_draft(&p, &d).unwrap();
    assert_eq!(issuer::read_draft(&p).unwrap(), Some(d));
    std::fs::write(&p, r#"{"serial":1,"revoked":["0002"]}"#).unwrap();
    assert!(issuer::read_draft(&p).is_err());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn issuer_can_still_edit_the_distribution_list_draft() {
    // 取り下げの一覧の下書き（取り下げ用の鍵で署名する）の revoked.featureCodes も直せる。ほかの欄はそのまま残す
    let k = key("fc-2026a");
    let ring = ring_of(&k);
    let mut d = Draft::Main(revocations::empty_draft(
        parse_utc("2026-11-01T00:00:00Z").unwrap(),
    ));
    issuer::draft_add(&mut d, &["0007".into(), "0002".into()]).unwrap();
    let Draft::Main(mut list) = d else {
        unreachable!()
    };
    list.revoked.keys = vec!["fr-2026a".into()];
    let now = parse_utc("2026-11-04T00:00:00Z").unwrap();
    let next = revocations::next_issue(&list, now, revocations::DEFAULT_VALID_DAYS).unwrap();
    assert_eq!(next.expires_at, "2027-02-02T00:00:00Z");
    let sealed = envelope::seal(
        &serde_json::to_string(&next).unwrap(),
        revocations::ENVELOPE_FORMAT,
        &[("rv-2026a", &rv_key(41))],
    );
    let v = revocations::verify(sealed.as_bytes(), &ring, None).unwrap();
    assert_eq!(revoked_ids(Some(&v), None), vec!["0002", "0007"]);
    assert_eq!(v.list.revoked.keys, vec!["fr-2026a"]);
    // 中身の format で種類を見分けて読む
    let text = serde_json::to_string(&next).unwrap();
    assert!(matches!(issuer::parse_draft(&text), Ok(Draft::Main(_))));
    let small = serde_json::to_string(&fcr::empty_draft(now)).unwrap();
    assert!(matches!(issuer::parse_draft(&small), Ok(Draft::Codes(_))));
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
