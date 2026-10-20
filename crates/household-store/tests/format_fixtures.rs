// 過去のすべての形式の版の見本（0011 の5）: `tests/fixtures/household-format/<版>/` に、暗号化した世帯ファイル（household.lphf）・
// 試験用の鍵の作り方（key.txt）・暗号を外した本文（body.json）を置き、消さない。毎回すべての版を開いて今の版へ変換する。
//
// 試験用の鍵は秘密ではない（key.txt に書いた文字列の SHA-256）。架空の世帯（モデル世帯の写し）だけを入れる。
use std::path::PathBuf;

use household_store::container::{self, HouseholdHeader};
use household_store::{crypto, migrate};

fn base() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("household-format")
}

/// key.txt の1行目の文字列から試験用の鍵を作る
fn fixture_key(dir: &std::path::Path) -> [u8; 32] {
    let text = std::fs::read_to_string(dir.join("key.txt")).unwrap();
    let seed = text.lines().next().unwrap().trim();
    crypto::sha256(seed.as_bytes())
}

#[test]
fn every_format_version_has_a_fixture_and_opens() {
    let mut found: Vec<String> = std::fs::read_dir(base())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| migrate::parse(n).is_some())
        .collect();
    found.sort_by_key(|v| migrate::parse(v).unwrap());
    let known: Vec<String> = migrate::KNOWN.iter().map(|v| v.to_string()).collect();
    assert_eq!(
        found, known,
        "見本の版と、これまでの形式の版（migrate::KNOWN）がそろっている"
    );
    for v in &found {
        let dir = base().join(v);
        let key = fixture_key(&dir);
        let bytes = std::fs::read(dir.join("household.lphf")).unwrap();
        let (h, plain) =
            container::open_household(&bytes, &key).unwrap_or_else(|e| panic!("{v}: {e}"));
        assert_eq!(h.format_version, *v);
        assert_eq!(h.format, household_store::HOUSEHOLD_FORMAT);
        let body: serde_json::Value = serde_json::from_slice(&plain).unwrap();
        let expected: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("body.json")).unwrap()).unwrap();
        assert_eq!(body, expected, "{v}: 暗号を外した本文が body.json と同じ");
        assert_eq!(migrate::access(v).unwrap(), migrate::Access::ReadWrite);
        let now = migrate::upgrade(v, body).unwrap();
        // 今の版の本文の区画がそろっている
        for k in [
            "meta",
            "household",
            "proposals",
            "workspace",
            "display",
            "extDefinitions",
            "ext",
        ] {
            assert!(now.get(k).is_some(), "{v}: 変換した本文に {k} が無い");
        }
        assert!(now["household"]["request"]["input"]["household"]["members"]
            .as_array()
            .is_some_and(|m| !m.is_empty()));
        // 0.2 から: 誰が直したかの記録（0023 の6。古い版は空で足される）
        assert!(now["meta"]["revisions"].is_array(), "{v}: meta.revisions");
        assert!(now["meta"]["editors"].is_object(), "{v}: meta.editors");
        // 0.3 から: 控えの区画（任意。あるなら配列で、中身は変換で変えない）
        if let Some(snaps) = now.get("snapshots") {
            assert!(
                migrate::parse(v).unwrap() >= (0, 3),
                "{v}: 0.3 より前の版に控えの区画は無い"
            );
            assert!(snaps.as_array().is_some_and(|a| !a.is_empty()));
            assert_eq!(snaps, &expected["snapshots"], "{v}: 控えの中身は変えない");
        }
        if *v == "0.4" {
            // 0.4 から: 持ち家の評価（任意。見本の世帯は持ち家の評価を持つ）
            let homes = now["household"]["request"]["input"]["household"]["residences"]
                .as_array()
                .unwrap();
            assert!(
                homes.iter().any(|r| r.get("valuation").is_some()),
                "0.4 の見本には持ち家の評価がある"
            );
        }
        if *v == "0.5" {
            // 0.5 から: 資産運用（0026）。見本の世帯は、積立の終わりが空の積立と、取り崩しの計画を持つ
            let accounts = now["household"]["request"]["input"]["household"]["accounts"]
                .as_array()
                .unwrap();
            assert!(
                accounts.iter().any(|a| a["contributions"]
                    .as_array()
                    .is_some_and(|cs| cs.iter().any(|c| c["to"].is_null()))),
                "0.5 の見本には積立の終わりが空の積立がある"
            );
            assert!(
                now["household"]["request"]["input"]["assumptions"]["investment"]["drawdown"]
                    .is_object(),
                "0.5 の見本には取り崩しの計画がある"
            );
        }
        if *v == "0.6" {
            // 0.6 から: 住まい以外の不動産の中身（土地と建物・家賃収入・経費・取得）と、その不動産のローン（0028）
            let hh = &now["household"]["request"]["input"]["household"];
            let accounts = hh["accounts"].as_array().unwrap();
            let condo = accounts
                .iter()
                .find(|a| a["kind"] == "realEstate" && a.get("property").is_some())
                .expect("0.6 の見本には中身を入れた不動産がある");
            assert!(condo["property"]["rental"]["monthly"].is_object());
            assert!(
                hh["debts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|d| d["property"] == condo["id"]),
                "0.6 の見本にはその不動産のローンがある"
            );
        }
        if *v == "0.7" {
            // 0.7 から: 資産と負債のタブの並べる時点（既定の時点と、この世帯で選んだ時点。候補の鍵と決まった年）
            let d = &now["display"];
            assert!(d["bsPoints"]
                .as_array()
                .is_some_and(|a| (2..=4).contains(&a.len())));
            let cols = d["bsColumns"]
                .as_array()
                .expect("0.7 の見本にはこの世帯で選んだ時点がある");
            assert!(cols.iter().any(|c| c.get("point").is_some()));
            assert!(cols.iter().any(|c| c["year"].is_u64()));
        }
        if *v == "0.3" {
            assert!(now.get("snapshots").is_some(), "0.3 の見本には控えがある");
        }
        // 鍵が違えば開かない
        let mut wrong = key;
        wrong[0] ^= 1;
        assert!(container::open_household(&bytes, &wrong).is_err());
    }
}

/// 今の版の見本を作る（手で流す。見本は消さない・作り直さない。新しい版を足すときだけ）:
/// `FIXTURE_SOURCE=<画面の本文の JSON> cargo test -p household-store --test format_fixtures -- --ignored regenerate_fixture`
/// 画面の本文は app/ で `WRITE_HOUSEHOLD_FIXTURE_SOURCE=<出力先> npx vitest run test/store.test.ts` で作る
#[test]
#[ignore]
fn regenerate_fixture() {
    let src = std::env::var("FIXTURE_SOURCE").expect("FIXTURE_SOURCE");
    let dir = base().join(migrate::CURRENT);
    assert!(
        !dir.join("household.lphf").exists(),
        "見本は消さない・作り直さない（{}）",
        dir.display()
    );
    std::fs::create_dir_all(&dir).unwrap();
    let seed = format!(
        "lifeplan household-format fixture {} (test key, not a secret)",
        migrate::CURRENT
    );
    std::fs::write(dir.join("key.txt"), format!("{seed}\n\n試験用の鍵は、1行目の文字列（UTF-8）の SHA-256。秘密ではない。中身は架空のモデル世帯。\n")).unwrap();
    let mut body: serde_json::Value = serde_json::from_slice(&std::fs::read(src).unwrap()).unwrap();
    // 誰が直したかの記録（0.2 から。0023 の6）は、元の本文の meta にあれば残す
    let carried = body["meta"].clone();
    body["meta"] = serde_json::json!({
        "format": household_store::HOUSEHOLD_FORMAT,
        "formatVersion": migrate::CURRENT,
        "savedAt": "2026-10-18T00:00:00Z",
        "appVersion": "0.1.0",
        "customerNo": "A0001"
    });
    for k in ["savedBy", "revisions", "editors"] {
        if let Some(v) = carried.get(k) {
            body["meta"][k] = v.clone();
        }
    }
    let plain = serde_json::to_vec(&body).unwrap();
    let header = HouseholdHeader {
        cipher: String::new(),
        compression: "none".into(),
        device_id: "00000000-0000-4000-8000-000000000001".into(),
        format: household_store::HOUSEHOLD_FORMAT.into(),
        format_version: migrate::CURRENT.into(),
        generation: 1,
        household_id: "00000000-0000-4000-8000-000000000002".into(),
        key_id: "00000000-0000-4000-8000-000000000003".into(),
        nonce: String::new(),
        parent_revision: None,
    };
    let key = crypto::sha256(seed.as_bytes());
    std::fs::write(
        dir.join("household.lphf"),
        container::seal_household(header, &key, &plain),
    )
    .unwrap();
    std::fs::write(
        dir.join("body.json"),
        serde_json::to_string_pretty(&body).unwrap() + "\n",
    )
    .unwrap();
}
