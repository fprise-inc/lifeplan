//! 機能を有効にするコード（0110）。鍵はテストの中だけで作る（リポジトリに秘密鍵を置かない）

use feature_code::issuer;
use feature_code::{
    add, decode_unverified, issue, normalize, parse_date, reference, remove, status, today_jst,
    verify, CodeState, Error, PublicKey, Request, SecretKey,
};

fn key(kid: &str) -> SecretKey {
    SecretKey::generate(kid).unwrap()
}

fn req(id: &str, expires: &str) -> Request {
    Request {
        id: id.into(),
        name: "見本 花子".into(),
        features: vec!["combinedBs".into()],
        issued: "2026-11-01".into(),
        expires: expires.into(),
    }
}

#[test]
fn issued_code_verifies_with_the_public_key_only() {
    let k = key("test-1");
    let code = issue(&k, &req("0001", "2027-05-31")).unwrap();
    assert!(code.starts_with("LPFC1-"));
    let c = verify(&code, &[k.public()]).unwrap();
    assert_eq!(c.name, "見本 花子");
    assert_eq!(c.features, vec!["combinedBs"]);
    assert_eq!(c.expires, "2027-05-31");
    assert_eq!(c.kid, "test-1");
    // 写すときに入った改行・空白は無視する
    let wrapped = format!("  {}\n{} \r\n", &code[..40], &code[40..]);
    assert_eq!(verify(&wrapped, &[k.public()]).unwrap(), c);
    // ほかの鍵（同じ名前でも別の鍵）では通らない
    let other = key("test-1");
    assert_eq!(verify(&code, &[other.public()]), Err(Error::SIGNATURE));
    // 知らない鍵の名前
    assert_eq!(verify(&code, &[key("test-2").public()]), Err(Error::KEY));
}

#[test]
fn tampered_code_is_rejected() {
    let k = key("test-1");
    let code = issue(&k, &req("0001", "2027-05-31")).unwrap();
    let (body, sig) = code.trim_start_matches("LPFC1-").split_once('.').unwrap();
    // 中身の期限を書き換えて付け直す（署名は元のまま）
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let payload = String::from_utf8(b64.decode(body).unwrap()).unwrap();
    let forged = payload.replace("2027-05-31", "2099-12-31");
    let forged = format!("LPFC1-{}.{sig}", b64.encode(forged.as_bytes()));
    assert_eq!(verify(&forged, &[k.public()]), Err(Error::SIGNATURE));
    // 名前の書き換えも
    let renamed = payload.replace("見本 花子", "別の 人");
    let renamed = format!("LPFC1-{}.{sig}", b64.encode(renamed.as_bytes()));
    assert_eq!(verify(&renamed, &[k.public()]), Err(Error::SIGNATURE));
    // 形の違うもの
    for bad in [
        "",
        "LPFC1-",
        "LPFC1-abc",
        "LPFC2-abc.def",
        "hello",
        &code[..code.len() - 3],
    ] {
        assert!(verify(bad, &[k.public()]).is_err(), "{bad}");
    }
    // 長すぎるもの
    assert_eq!(verify(&"A".repeat(5000), &[k.public()]), Err(Error::FORMAT));
}

#[test]
fn issuing_checks_the_input() {
    let k = key("test-1");
    let bad = |f: &dyn Fn(&mut Request)| {
        let mut r = req("0001", "2027-05-31");
        f(&mut r);
        issue(&k, &r).unwrap_err()
    };
    assert!(bad(&|r| r.features = vec!["unknownFeature".into()]).contains("ありません"));
    assert!(bad(&|r| r.features = vec![]).contains("機能"));
    assert!(
        bad(&|r| r.features = vec!["combinedBs".into(), "combinedBs".into()]).contains("重なって")
    );
    assert!(bad(&|r| r.expires = "2026-02-30".into()).contains("日付"));
    assert!(bad(&|r| r.expires = "2026-10-01".into()).contains("発行日より前"));
    assert!(bad(&|r| r.name = "".into()).contains("名前"));
    assert!(bad(&|r| r.name = " 前に空白".into()).contains("空白"));
    assert!(bad(&|r| r.name = "改行\nあり".into()).contains("制御"));
    assert!(bad(&|r| r.name = "=HYPERLINK(1)".into()).contains("最初の文字"));
    assert!(bad(&|r| r.name = "あ".repeat(41)).contains("長すぎ"));
    assert!(bad(&|r| r.id = "番号".into()).contains("番号"));
    assert!(bad(&|r| r.id = "-1".into()).contains("番号"));
    assert!(issue(&k, &req("fc_2026.01-a", "2027-05-31")).is_ok());
}

#[test]
fn secret_key_file_round_trip() {
    let k = key("dev-1");
    let text = k.to_text();
    let back = SecretKey::from_text(&text).unwrap();
    assert_eq!(back.public().line(), k.public().line());
    let line = k.public().line();
    assert_eq!(PublicKey::parse(&line).unwrap().line(), line);
    // 公開鍵の行が秘密鍵と合わない（取り違え）
    let other = key("dev-1").public().line();
    let mixed = text.replace(&line, &other);
    assert!(SecretKey::from_text(&mixed)
        .unwrap_err()
        .contains("合いません"));
    assert!(SecretKey::from_text("kid = x\nsecret = y\n").is_err());
    assert!(PublicKey::parse("dev-1:short").is_err());
    assert!(PublicKey::parse("UPPER:AAAA").is_err());
}

#[test]
fn dates_are_japan_dates() {
    // 2026-11-01T14:59:59Z は日本では 23:59:59、15:00:00Z は翌日
    let base = (parse_date("2026-11-01").unwrap()) * 86_400;
    assert_eq!(today_jst(base + 14 * 3600 + 59 * 60 + 59), "2026-11-01");
    assert_eq!(today_jst(base + 15 * 3600), "2026-11-02");
    assert!(parse_date("2028-02-29").is_some());
    assert!(parse_date("2027-02-29").is_none());
    assert!(parse_date("2027-13-01").is_none());
    assert!(parse_date("2027-1-01").is_none());
}

#[test]
fn status_marks_expiring_and_expired() {
    let k = key("test-1");
    let keys = [k.public()];
    let code = issue(&k, &req("0001", "2027-05-31")).unwrap();
    let codes = vec![code.clone()];
    let s = status(&codes, &keys, "2027-01-01");
    assert_eq!(s.active, vec!["combinedBs"]);
    assert_eq!(s.codes[0].state, CodeState::Active);
    assert_eq!(s.codes[0].reference, reference(&code));
    // 30日前から更新の知らせ
    assert_eq!(
        status(&codes, &keys, "2027-05-01").codes[0].state,
        CodeState::Expiring
    );
    assert_eq!(status(&codes, &keys, "2027-05-01").codes[0].days_left, 30);
    assert_eq!(
        status(&codes, &keys, "2027-04-30").codes[0].state,
        CodeState::Active
    );
    // 期限の日の終わりまで使える
    let last = status(&codes, &keys, "2027-05-31");
    assert_eq!(last.codes[0].state, CodeState::Expiring);
    assert_eq!(last.active, vec!["combinedBs"]);
    // 翌日から切れる（中身は見えるまま。機能は出さない）
    let after = status(&codes, &keys, "2027-06-01");
    assert_eq!(after.codes[0].state, CodeState::Expired);
    assert!(after.active.is_empty());
    assert_eq!(after.codes[0].name, "見本 花子");
    // 鍵を差し替えたあとは確かめられないコードとして残る（外せる）
    let swapped = status(&codes, &[key("test-1").public()], "2027-01-01");
    assert!(swapped.active.is_empty());
    assert_eq!(swapped.invalid[0].error, "E_FEATURE_CODE_SIGNATURE");
    assert_eq!(swapped.invalid[0].reference, reference(&code));
}

#[test]
fn adding_replaces_the_older_code_and_rejects_expired() {
    let k = key("test-1");
    let keys = [k.public()];
    let old = issue(&k, &req("0001", "2027-05-31")).unwrap();
    let list = add(&[], &old, &keys, "2026-11-01").unwrap();
    assert_eq!(list, vec![normalize(&old)]);
    // 同じコードをもう一度: 増えない
    assert_eq!(
        add(&list, &format!(" {old}\n"), &keys, "2026-11-01").unwrap(),
        list
    );
    // 更新のコード（新しい番号・遅い期限）: 古いコードを外す
    let renewed = issue(&k, &req("0002", "2027-11-30")).unwrap();
    let list2 = add(&list, &renewed, &keys, "2027-05-20").unwrap();
    assert_eq!(list2, vec![renewed.clone()]);
    // 期限の切れたコードは入れない
    assert_eq!(add(&[], &old, &keys, "2027-06-01"), Err(Error::EXPIRED));
    // 期限の切れたコードの後に、新しいコードを入れると戻る（切れたコードは外れる）
    let s = status(&list, &keys, "2027-06-10");
    assert!(s.active.is_empty());
    let back = add(&list, &renewed, &keys, "2027-06-10").unwrap();
    assert_eq!(
        status(&back, &keys, "2027-06-10").active,
        vec!["combinedBs"]
    );
    assert_eq!(back.len(), 1);
    // 偽物・知らない鍵
    assert_eq!(
        add(
            &[],
            &issue(&key("test-1"), &req("9", "2027-05-31")).unwrap(),
            &keys,
            "2026-11-01"
        ),
        Err(Error::SIGNATURE)
    );
    // 外す
    assert_eq!(
        remove(&back, &reference(&renewed)).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(remove(&back, "0000"), Err(Error::NOT_FOUND));
}

#[test]
fn record_csv_and_batch() {
    let dir = std::env::temp_dir().join(format!("feature-code-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("issued.csv");
    let k = key("test-1");
    // 1件ずつ
    let code = issue(&k, &req("0001", "2027-05-31")).unwrap();
    let c = decode_unverified(&code).unwrap();
    issuer::append_records(&log, std::slice::from_ref(&c)).unwrap();
    assert_eq!(issuer::logged_ids(&log).unwrap(), vec!["0001"]);
    // 同じ番号は足さない
    assert!(issuer::append_records(&log, &[c])
        .unwrap_err()
        .contains("既に"));
    // 一覧からまとめて（番号の無い行は続きの番号。カンマ・引用符を含む名前）
    let list = "\u{feff}id,name,features,expires\n,\"山田, 一郎\",combinedBs,2027-05-31\nA-7,\"引用\"\"符\",combinedBs,2027-06-30\n,三人目,combinedBs,2027-07-31\n";
    let rows = issuer::read_batch(list).unwrap();
    assert_eq!(rows.len(), 3);
    let logged = issuer::logged_ids(&log).unwrap();
    let out = issuer::issue_batch(&k, &rows, &logged, "2026-11-01").unwrap();
    let ids: Vec<&str> = out.iter().map(|(c, _)| c.id.as_str()).collect();
    assert_eq!(ids, vec!["0002", "A-7", "0003"]);
    assert_eq!(out[0].0.name, "山田, 一郎");
    assert_eq!(out[1].0.name, "引用\"符");
    for (c, code) in &out {
        assert_eq!(&verify(code, &[k.public()]).unwrap(), c);
    }
    let claims: Vec<_> = out.iter().map(|(c, _)| c.clone()).collect();
    issuer::append_records(&log, &claims).unwrap();
    assert_eq!(
        issuer::logged_ids(&log).unwrap(),
        vec!["0001", "0002", "A-7", "0003"]
    );
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(text.starts_with("\u{feff}id,name,features,expires,issued\n"));
    assert!(text.contains("\"山田, 一郎\""));
    // 誤りが1つでもあれば1件も発行しない
    let bad = "name,features,expires\n四人目,combinedBs,2027-05-31\n五人目,unknownX,2027-05-31\n六人目,combinedBs,2020-01-01\n";
    let err = issuer::issue_batch(
        &k,
        &issuer::read_batch(bad).unwrap(),
        &issuer::logged_ids(&log).unwrap(),
        "2026-11-01",
    )
    .unwrap_err();
    assert!(
        err.contains("3行目") && err.contains("4行目") && !err.contains("2行目"),
        "{err}"
    );
    // 記録にある番号を一覧に書いた
    let dup = "id,name,features,expires\nA-7,七人目,combinedBs,2027-05-31\n";
    assert!(issuer::issue_batch(
        &k,
        &issuer::read_batch(dup).unwrap(),
        &issuer::logged_ids(&log).unwrap(),
        "2026-11-01"
    )
    .unwrap_err()
    .contains("既に"));
    // 秘密鍵のファイル: 作る・上書きしない・読む
    let kp = dir.join("keys").join("signing.key");
    issuer::write_new_key(&kp, &k).unwrap();
    assert!(issuer::write_new_key(&kp, &key("test-1"))
        .unwrap_err()
        .contains("上書きしません"));
    assert_eq!(
        issuer::read_key(&kp).unwrap().public().line(),
        k.public().line()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            std::fs::metadata(&kp).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn issuer_refuses_paths_inside_a_repository() {
    // この crate はリポジトリの中にある
    let inside = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("signing.key");
    assert!(issuer::outside_repository(&inside)
        .unwrap_err()
        .contains("git"));
    assert!(issuer::write_new_key(&inside, &key("test-1")).is_err());
    assert!(!inside.exists());
}

#[test]
fn csv_parsing() {
    let rows = issuer::parse_csv("a,b\r\n\"x,y\",\"q\"\"\"\n\n,last").unwrap();
    assert_eq!(
        rows,
        vec![vec!["a", "b"], vec!["x,y", "q\""], vec!["", "last"]]
    );
    assert!(issuer::parse_csv("\"open").is_err());
    assert_eq!(
        issuer::next_id(&["0009".into(), "A-1".into(), "12".into()]),
        "0013"
    );
    assert_eq!(issuer::next_id(&[]), "0001");
}
