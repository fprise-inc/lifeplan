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
    body["meta"] = serde_json::json!({
        "format": household_store::HOUSEHOLD_FORMAT,
        "formatVersion": migrate::CURRENT,
        "savedAt": "2026-10-18T00:00:00Z",
        "appVersion": "0.1.0",
        "customerNo": "A0001"
    });
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
