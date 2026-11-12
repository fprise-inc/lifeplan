// 共有フォルダのファイル（名簿・世帯の鍵の札・世帯の札・開いている印・参加の申請・明細の辞書・office.json）の、
// 過去のすべての形式の版の見本（0023 の追記 2026-11-04。世帯ファイルの見本 0011 の5 と同じ扱い）。
//
// `tests/fixtures/shared-format/<版>/` に、その版のアプリが書いた事務所のフォルダ（`lifeplan-office/`）・試験用の鍵の作り方（keys.txt）・
// 暗号を外した中身（expected.json）を置き、消さない。毎回すべての版を、今のアプリの読み方で開いて中身を比べる。
// 試験用の鍵は秘密ではない（keys.txt に書いた文字列の SHA-256）。中身は架空（FP の表示名も架空）。
//
// 見本を作るのは、共有フォルダの形式の版を上げたときだけ:
// `cargo test -p household-store --test shared_format_fixtures -- --ignored regenerate_shared_fixture`
// （今の版の見本のフォルダがまだ無いときだけ作る。既にある見本は書き換えない）
use std::path::{Path, PathBuf};

use household_store::member::{self, MemberKeys};
use household_store::numbering::{Category, Label};
use household_store::office::{self, Author, Card, HouseholdKeys, Member, Paths, Roster};
use household_store::statement_dict::{DictionaryEntry, LearnedFormat, StatementOffice};
use household_store::{crypto, migrate};
use serde_json::{json, Value};

fn base() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("shared-format")
}

// 見本の中の決まった ID（乱数の ID の形。人や機器の情報は含めない）
const OFFICE: &str = "0f0f0f0f-0000-4000-8000-000000000001";
const MASTER_ID: &str = "0f0f0f0f-0000-4000-8000-000000000002";
const PREVIOUS_MASTER_ID: &str = "0f0f0f0f-0000-4000-8000-000000000003";
const MEMBER_A: &str = "0f0f0f0f-0000-4000-8000-0000000000a1";
const MEMBER_B: &str = "0f0f0f0f-0000-4000-8000-0000000000b1";
const MEMBER_C: &str = "0f0f0f0f-0000-4000-8000-0000000000c1";
const MEMBER_D: &str = "0f0f0f0f-0000-4000-8000-0000000000d1";
const MEMBER_E: &str = "0f0f0f0f-0000-4000-8000-0000000000e1";
const HOUSEHOLD: &str = "0f0f0f0f-0000-4000-8000-000000000101";
const HOUSEHOLD_KEY: &str = "0f0f0f0f-0000-4000-8000-000000000201";
const HOUSEHOLD_KEY_OLD: &str = "0f0f0f0f-0000-4000-8000-000000000202";
const DEVICE: &str = "0f0f0f0f-0000-4000-8000-000000000301";

/// keys.txt の各行（`名前: 文字列`）の文字列の SHA-256
fn seeds(dir: &Path) -> std::collections::HashMap<String, [u8; 32]> {
    std::fs::read_to_string(dir.join("keys.txt"))
        .unwrap()
        .lines()
        .filter_map(|l| l.split_once(": "))
        .map(|(k, v)| (k.trim().to_owned(), crypto::sha256(v.trim().as_bytes())))
        .collect()
}

fn key(b: [u8; 32]) -> crypto::Key {
    zeroize::Zeroizing::new(b)
}

fn member_keys(b: [u8; 32]) -> MemberKeys {
    MemberKeys::from_hex(&crypto::hex_encode(&b)).unwrap()
}

/// 名簿の中身（比べる形。鍵は試験用なので 16 進で書く）
fn roster_view(r: &Roster) -> Value {
    json!({
        "officeId": r.office_id,
        "masterKeyId": r.master_key_id,
        "members": r.members,
        "removed": r.removed,
        "previous": r.previous.iter().map(|p| json!({
            "masterKeyId": p.master_key_id,
            "key": crypto::hex_encode(p.key.as_ref()),
            "retiredAt": p.retired_at,
        })).collect::<Vec<_>>(),
        "recovery": r.recovery,
        "events": r.events,
        "closed": r.closed,
        "usage": r.usage,
        "categories": r.categories,
        "updatedAt": r.updated_at,
        "updatedBy": r.updated_by,
        "extra": r.extra,
    })
}

fn keys_view(k: &HouseholdKeys) -> Value {
    json!({
        "currentId": k.current_id,
        "current": crypto::hex_encode(k.current.as_ref()),
        "previous": k.previous.iter().map(|(id, k)| json!([id, crypto::hex_encode(k.as_ref())])).collect::<Vec<_>>(),
    })
}

/// 見本のフォルダの中身を開いて、比べる形にする（今のアプリの読み方で）
fn open_all(dir: &Path) -> Value {
    let s = seeds(dir);
    let master = key(s["master"]);
    let previous = key(s["previousMaster"]);
    let p = Paths::new(dir.join(office::OFFICE_DIR));
    let of = office::OfficeFile::read(&p).unwrap();
    let roster_bytes = std::fs::read(p.members()).unwrap();
    // メンバーそれぞれの秘密鍵で名簿が開け、同じ親鍵が出てくる
    let mut rosters = vec![];
    for (name, id) in [
        ("memberA", MEMBER_A),
        ("memberB", MEMBER_B),
        ("memberD", MEMBER_D),
    ] {
        let (r, m) = office::open_roster(&roster_bytes, &member_keys(s[name]), id).unwrap();
        assert_eq!(*m, *master, "{name} の包みから今の親鍵");
        rosters.push(r);
    }
    // 外したメンバーの鍵では開かない
    assert!(office::open_roster(&roster_bytes, &member_keys(s["memberC"]), MEMBER_C).is_err());
    let r = office::open_roster_with_master(&roster_bytes, &master).unwrap();
    let lookup = |mk: &str| r.master_for(&master, mk);
    let keys = office::open_keys(
        &std::fs::read(p.key_file(MASTER_ID, HOUSEHOLD)).unwrap(),
        HOUSEHOLD,
        &master,
    )
    .unwrap();
    let old_keys = office::open_keys(
        &std::fs::read(p.key_file(PREVIOUS_MASTER_ID, HOUSEHOLD)).unwrap(),
        HOUSEHOLD,
        &previous,
    )
    .unwrap();
    let card = office::open_card(
        &std::fs::read(p.card(HOUSEHOLD)).unwrap(),
        HOUSEHOLD,
        lookup,
    )
    .unwrap();
    let presence = office::open_presence(
        &std::fs::read(p.presence(HOUSEHOLD, MEMBER_B)).unwrap(),
        HOUSEHOLD,
        MEMBER_B,
        lookup,
    )
    .unwrap();
    let request: office::JoinRequest =
        serde_json::from_slice(&std::fs::read(p.request(MEMBER_E)).unwrap()).unwrap();
    let request = request.checked(OFFICE).unwrap();
    let dict = office::open_statement_dict(
        &std::fs::read(p.statement_dict(MEMBER_A)).unwrap(),
        MEMBER_A,
        lookup,
    )
    .unwrap();
    for x in &rosters {
        assert_eq!(roster_view(x), roster_view(&r));
    }
    json!({
        "officeFile": of,
        "roster": roster_view(&r),
        "officeCode": member::office_code(&master),
        "keys": keys_view(&keys),
        "previousEpochKeys": keys_view(&old_keys),
        "card": card,
        "presence": presence,
        "request": request,
        "statementDictionary": dict,
    })
}

#[test]
fn every_shared_format_version_has_a_fixture_and_opens() {
    let mut found: Vec<String> = std::fs::read_dir(base())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| migrate::parse(n).is_some())
        .collect();
    found.sort_by_key(|v| migrate::parse(v).unwrap());
    let known: Vec<String> = office::SHARED_KNOWN.iter().map(|v| v.to_string()).collect();
    assert_eq!(
        found, known,
        "見本の版と、これまでの共有フォルダの形式の版（office::SHARED_KNOWN）がそろっている"
    );
    assert_eq!(
        known.last().map(String::as_str),
        Some(office::SHARED_FORMAT_VERSION)
    );
    for v in &found {
        let dir = base().join(v);
        let mut got = open_all(&dir);
        let mut expected: Value =
            serde_json::from_slice(&std::fs::read(dir.join("expected.json")).unwrap()).unwrap();
        // 事務所の確かめ用の番号はファイルの中身ではなく、親鍵から導いて画面に出す値。0.1 の見本は前の版の8文字で、
        // 今の16文字（0023 の追記 2026-11-04）は前の8文字から続く（同じ親鍵なら、前の版の画面と前半が同じ）
        let shown = expected
            .as_object_mut()
            .unwrap()
            .remove("officeCode")
            .unwrap();
        let now = got.as_object_mut().unwrap().remove("officeCode").unwrap();
        assert!(
            now.as_str().unwrap().starts_with(shown.as_str().unwrap()),
            "{v}: 事務所の確かめ用の番号 {now} が {shown} から続く"
        );
        assert_eq!(got, expected, "{v}: 開いた中身が expected.json と同じ");
        assert_eq!(got["officeFile"]["formatVersion"], json!(v));
        // 今のアプリで書き直しても、同じ中身で開ける（知らない欄を落とさない）
        let s = seeds(&dir);
        let master = key(s["master"]);
        let p = Paths::new(dir.join(office::OFFICE_DIR));
        let r =
            office::open_roster_with_master(&std::fs::read(p.members()).unwrap(), &master).unwrap();
        let again =
            office::open_roster_with_master(&office::encode_roster(&r, &master).unwrap(), &master)
                .unwrap();
        assert_eq!(roster_view(&again), roster_view(&r), "{v}: 名簿の書き直し");
        let lookup = |mk: &str| r.master_for(&master, mk);
        let c = office::open_card(
            &std::fs::read(p.card(HOUSEHOLD)).unwrap(),
            HOUSEHOLD,
            lookup,
        )
        .unwrap();
        let c2 = office::open_card(
            &office::encode_card(OFFICE, MASTER_ID, HOUSEHOLD, &c, &master),
            HOUSEHOLD,
            lookup,
        )
        .unwrap();
        assert_eq!(c2, c, "{v}: 世帯の札の書き直し");
    }
}

/// 今の版の見本を作る（無いときだけ）。中身は架空
#[test]
#[ignore]
fn regenerate_shared_fixture() {
    let v = office::SHARED_FORMAT_VERSION;
    let dir = base().join(v);
    assert!(!dir.exists(), "{v} の見本は既にある（見本は書き換えない）");
    let root = dir.join(office::OFFICE_DIR);
    std::fs::create_dir_all(&root).unwrap();
    let seed =
        |name: &str| format!("lifeplan shared-format fixture {v} {name} (test key, not a secret)");
    let names = [
        "master",
        "previousMaster",
        "memberA",
        "memberB",
        "memberC",
        "memberD",
        "memberE",
        "householdKey",
        "householdKeyOld",
    ];
    let mut text = String::new();
    for n in names {
        text.push_str(&format!("{n}: {}\n", seed(n)));
    }
    text.push_str(
        "\n試験用の鍵は、各行の「: 」の後の文字列（UTF-8）の SHA-256。秘密ではない。中身は架空。\n",
    );
    std::fs::write(dir.join("keys.txt"), &text).unwrap();
    let s = seeds(&dir);
    let master = key(s["master"]);
    let previous = key(s["previousMaster"]);
    let mk = |n: &str| member_keys(s[n]);
    let p = Paths::new(root.clone());
    std::fs::write(
        p.office_file(),
        serde_json::to_vec_pretty(&office::OfficeFile::new(OFFICE)).unwrap(),
    )
    .unwrap();
    let member_of = |id: &str, name: &str, keys: &MemberKeys, approved_by: Option<&str>| Member {
        member_id: id.into(),
        display_name: name.into(),
        public_key: keys.public_hex(),
        fingerprint: member::fingerprint(&keys.public()),
        joined_at: "2026-10-19T09:00:00Z".into(),
        approved_by: approved_by.map(str::to_owned),
        role: office::ROLE_MEMBER.into(),
        extra: Default::default(),
    };
    let roster = Roster {
        office_id: OFFICE.into(),
        master_key_id: MASTER_ID.into(),
        members: vec![
            member_of(MEMBER_A, "見本の担当A", &mk("memberA"), None),
            member_of(MEMBER_B, "見本の担当B", &mk("memberB"), Some(MEMBER_A)),
            member_of(MEMBER_D, "見本の担当D", &mk("memberD"), None),
        ],
        removed: vec![office::RemovedMember {
            member_id: MEMBER_C.into(),
            display_name: "見本の担当C".into(),
            removed_at: "2026-10-20T09:00:00Z".into(),
            removed_by: Some(MEMBER_A.into()),
            extra: Default::default(),
        }],
        previous: vec![office::PreviousMaster {
            master_key_id: PREVIOUS_MASTER_ID.into(),
            key: previous.clone(),
            retired_at: "2026-10-20T09:00:00Z".into(),
        }],
        recovery: Some(office::RecoveryAck {
            master_key_id: MASTER_ID.into(),
            acknowledged_at: "2026-10-20T09:05:00Z".into(),
            acknowledged_by: MEMBER_A.into(),
            verified_at: Some("2026-10-21T09:00:00Z".into()),
            verified_by: Some(MEMBER_D.into()),
            extra: Default::default(),
        }),
        events: vec![office::RosterEvent {
            kind: office::EVENT_RECOVERY_JOIN.into(),
            member_id: MEMBER_D.into(),
            display_name: "見本の担当D".into(),
            at: "2026-10-21T09:00:00Z".into(),
            extra: Default::default(),
        }],
        closed: None,
        usage: Some(office::USAGE_OFFICE.into()),
        categories: Some(vec![
            Category {
                code: "A".into(),
                name: "顧問契約".into(),
            },
            Category {
                code: "C".into(),
                name: "見込み客".into(),
            },
        ]),
        updated_at: "2026-10-21T09:00:00Z".into(),
        updated_by: Some(MEMBER_D.into()),
        extra: Default::default(),
    };
    std::fs::write(
        p.members(),
        office::encode_roster(&roster, &master).unwrap(),
    )
    .unwrap();
    let hk_old = HouseholdKeys {
        current_id: HOUSEHOLD_KEY_OLD.into(),
        current: key(s["householdKeyOld"]),
        previous: vec![],
    };
    let hk = HouseholdKeys {
        current_id: HOUSEHOLD_KEY.into(),
        current: key(s["householdKey"]),
        previous: vec![(HOUSEHOLD_KEY_OLD.into(), key(s["householdKeyOld"]))],
    };
    for (m_id, m, k) in [
        (MASTER_ID, &master, &hk),
        (PREVIOUS_MASTER_ID, &previous, &hk_old),
    ] {
        std::fs::create_dir_all(p.keys_dir(m_id)).unwrap();
        std::fs::write(
            p.key_file(m_id, HOUSEHOLD),
            office::encode_keys(OFFICE, m_id, HOUSEHOLD, k, m),
        )
        .unwrap();
    }
    let card = Card {
        customer_no: "A0042".into(),
        summary: "本人・配偶者・子1".into(),
        created_at: "2026-10-19T10:00:00Z".into(),
        updated_at: "2026-10-21T10:00:00Z".into(),
        updated_by: Some(Author {
            member_id: MEMBER_B.into(),
            name: "見本の担当B".into(),
        }),
        generation: 3,
        label: Label {
            category: Some("A".into()),
            serial: Some(42),
            branch: None,
            sample: None,
            fictional: false,
        },
        extra: Default::default(),
    };
    std::fs::create_dir_all(p.cards_dir()).unwrap();
    std::fs::write(
        p.card(HOUSEHOLD),
        office::encode_card(OFFICE, MASTER_ID, HOUSEHOLD, &card, &master),
    )
    .unwrap();
    let presence = office::Presence {
        member_id: MEMBER_B.into(),
        display_name: "見本の担当B".into(),
        opened_at: 1_792_400_000,
        heartbeat_at: 1_792_400_060,
        device_id: DEVICE.into(),
    };
    std::fs::create_dir_all(p.presence_dir()).unwrap();
    std::fs::write(
        p.presence(HOUSEHOLD, MEMBER_B),
        office::encode_presence(OFFICE, MASTER_ID, HOUSEHOLD, &presence, &master),
    )
    .unwrap();
    let request = office::JoinRequest {
        format: office::REQUEST_FORMAT.into(),
        format_version: v.into(),
        office_id: OFFICE.into(),
        member_id: MEMBER_E.into(),
        display_name: "見本の担当E".into(),
        public_key: mk("memberE").public_hex(),
        requested_at: "2026-10-22T09:00:00Z".into(),
    };
    std::fs::create_dir_all(p.requests_dir()).unwrap();
    std::fs::write(
        p.request(MEMBER_E),
        serde_json::to_vec_pretty(&request).unwrap(),
    )
    .unwrap();
    let dict = StatementOffice {
        dictionary: vec![DictionaryEntry {
            key: "架空ノ店".into(),
            category: "food".into(),
            annual: false,
            at: "2026-10-21T11:00:00Z".into(),
            by: Some(MEMBER_A.into()),
            removed: false,
        }],
        formats: vec![LearnedFormat {
            fingerprint: "0".repeat(64),
            kind: "card".into(),
            mapping: json!({"date": 0, "payee": 1, "amount": 2}),
            label: Some("架空のカード".into()),
            at: "2026-10-21T11:00:00Z".into(),
            by: Some(MEMBER_A.into()),
        }],
    };
    std::fs::create_dir_all(p.statement_dict_dir()).unwrap();
    std::fs::write(
        p.statement_dict(MEMBER_A),
        office::encode_statement_dict(OFFICE, MASTER_ID, MEMBER_A, &dict, &master),
    )
    .unwrap();
    let expected = open_all(&dir);
    std::fs::write(
        dir.join("expected.json"),
        serde_json::to_vec_pretty(&expected).unwrap(),
    )
    .unwrap();
}
