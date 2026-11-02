//! 期限の切れた・提供元が止めたコードの知らせは、分かった日から7日で出さなくなる（0110 の追記 2026-11-02）。鍵はテストの中だけで作る

use feature_code::notice::{self, Record, NOTICE_DAYS};
use feature_code::{
    date_of_days, issue, parse_date, reference, status, CodeState, Error, Request, SecretKey,
};

fn req(id: &str, expires: Option<&str>) -> Request {
    Request {
        id: id.into(),
        name: "見本 花子".into(),
        features: vec!["combinedBs".into()],
        issued: "2026-11-01".into(),
        expires: expires.map(str::to_owned),
    }
}

/// day 日後の日付
fn plus(day: &str, n: i64) -> String {
    date_of_days(parse_date(day).unwrap() + n)
}

/// その日の状態に記録を当てる（記録は書き換える）。返すのは、最初のコードの知らせを出すか
fn seen(
    codes: &[String],
    keys: &[feature_code::PublicKey],
    today: &str,
    revoked: &[String],
    records: &mut Vec<Record>,
) -> bool {
    let mut s = status(codes, keys, today, revoked);
    *records = notice::apply(&mut s, records);
    s.codes[0].notice
}

#[test]
fn revoked_notice_shows_for_seven_days_then_fades() {
    let k = SecretKey::generate("test-1").unwrap();
    let keys = [k.public()];
    let code = issue(&k, &req("0001", None)).unwrap();
    let codes = [code.clone()];
    let revoked = vec!["0001".to_owned()];
    let mut records = vec![];
    // 使えるうちは知らせも記録も無い
    assert!(!seen(&codes, &keys, "2026-11-01", &[], &mut records));
    assert!(records.is_empty());
    // 止められたのを初めて見た日が「分かった日」。そこから7日目までは出る
    let day1 = "2026-11-02";
    for n in 0..NOTICE_DAYS {
        assert!(
            seen(&codes, &keys, &plus(day1, n), &revoked, &mut records),
            "{n}"
        );
    }
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].since, day1);
    assert_eq!(records[0].state, CodeState::Revoked);
    // 8日目からは出さない。コードは外さず、止めたままの状態で残る
    let mut s = status(&codes, &keys, &plus(day1, NOTICE_DAYS), &revoked);
    records = notice::apply(&mut s, &records);
    assert!(!s.codes[0].notice);
    assert_eq!(s.codes[0].state, CodeState::Revoked);
    assert_eq!(s.codes[0].notice_since.as_deref(), Some(day1));
    assert!(s.active.is_empty());
    // 止めるのをやめたら戻り、記録は消える
    assert!(!seen(&codes, &keys, &plus(day1, 10), &[], &mut records));
    assert!(records.is_empty());
    let back = status(&codes, &keys, &plus(day1, 10), &[]);
    assert_eq!(back.active, vec!["combinedBs"]);
    // 再び止められたら、新しい日付で出直す
    let again = plus(day1, 12);
    assert!(seen(&codes, &keys, &again, &revoked, &mut records));
    assert_eq!(records[0].since, again);
}

#[test]
fn dismissed_notice_stays_hidden_until_revoked_again() {
    let k = SecretKey::generate("test-1").unwrap();
    let keys = [k.public()];
    let code = issue(&k, &req("0001", None)).unwrap();
    let codes = [code.clone()];
    let revoked = vec!["0001".to_owned()];
    let mut records = vec![];
    assert!(seen(&codes, &keys, "2026-11-02", &revoked, &mut records));
    // 閉じたら、7日の内でも出さない
    records = notice::dismiss(&records, &reference(&code)).unwrap();
    assert!(records[0].dismissed);
    assert!(!seen(&codes, &keys, "2026-11-03", &revoked, &mut records));
    assert!(records[0].dismissed);
    // 知らせの無いコードは閉じられない
    assert_eq!(
        notice::dismiss(&records, "0000000000000000"),
        Err(Error::NOT_FOUND)
    );
    // 戻って再び止められたら、閉じた印も消えて出直す
    assert!(!seen(&codes, &keys, "2026-11-04", &[], &mut records));
    assert!(seen(&codes, &keys, "2026-11-05", &revoked, &mut records));
    assert!(!records[0].dismissed);
    assert_eq!(records[0].since, "2026-11-05");
}

#[test]
fn expired_notice_fades_and_restarts_when_state_changes() {
    let k = SecretKey::generate("test-1").unwrap();
    let keys = [k.public()];
    let code = issue(&k, &req("0001", Some("2027-05-31"))).unwrap();
    let codes = [code.clone()];
    let mut records = vec![];
    // 期限の翌日に初めて見たら、その日から7日
    assert!(seen(&codes, &keys, "2027-06-01", &[], &mut records));
    assert_eq!(records[0].state, CodeState::Expired);
    assert!(seen(&codes, &keys, "2027-06-07", &[], &mut records));
    assert!(!seen(&codes, &keys, "2027-06-08", &[], &mut records));
    // 期限の切れた後に止められた: 知らせの文が変わるので出直す
    let revoked = vec!["0001".to_owned()];
    assert!(seen(&codes, &keys, "2027-06-09", &revoked, &mut records));
    assert_eq!(records[0].state, CodeState::Revoked);
    assert_eq!(records[0].since, "2027-06-09");
    // コードを外したら記録も消える
    let mut s = status(&[], &keys, "2027-06-10", &revoked);
    assert!(notice::apply(&mut s, &records).is_empty());
}

#[test]
fn notice_defaults_and_odd_dates() {
    let k = SecretKey::generate("test-1").unwrap();
    let keys = [k.public()];
    let code = issue(&k, &req("0001", None)).unwrap();
    let codes = [code.clone()];
    let revoked = vec!["0001".to_owned()];
    // 記録を当てていない状態: 止めたコードは知らせを出す・使えるコードは出さない
    assert!(status(&codes, &keys, "2026-11-02", &revoked).codes[0].notice);
    assert!(!status(&codes, &keys, "2026-11-02", &[]).codes[0].notice);
    // 分かった日が今日より後（時計を戻した後など）・読めない日付なら、今日に直す
    for since in ["2026-12-31", "x"] {
        let mut records = vec![Record {
            reference: reference(&code),
            state: CodeState::Revoked,
            since: since.into(),
            dismissed: false,
        }];
        assert!(seen(&codes, &keys, "2026-11-02", &revoked, &mut records));
        assert_eq!(records[0].since, "2026-11-02");
    }
    // 保存の形（ref・state・since・dismissed）
    let r = Record {
        reference: "abcd".into(),
        state: CodeState::Expired,
        since: "2026-11-02".into(),
        dismissed: true,
    };
    let j = serde_json::to_string(&r).unwrap();
    assert_eq!(
        j,
        r#"{"ref":"abcd","state":"expired","since":"2026-11-02","dismissed":true}"#
    );
    let back: Record =
        serde_json::from_str(r#"{"ref":"abcd","state":"revoked","since":"2026-11-02"}"#).unwrap();
    assert!(!back.dismissed);
}
