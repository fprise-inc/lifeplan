// 凍結した読み替えの見本（0035 の12）: 本体の読み替えが、画面（app/src/workspace/store/readings.ts）と同じ当て先・合成の対策を返すこと。
// 見本は app/test/readings.test.ts の作る手順が作り、消さない（tests/fixtures/readings/0.16/）
use std::path::PathBuf;

use household_store::readings;
use serde_json::Value;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

fn input_of(name: &str) -> Value {
    let path = match name.strip_prefix("format-") {
        Some(v) => fixtures()
            .join("household-format")
            .join(v)
            .join("body.json"),
        None => fixtures()
            .join("readings")
            .join("0.16")
            .join("households")
            .join(format!("{name}.json")),
    };
    let v: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    match name.starts_with("format-") {
        true => v["household"]["request"]["input"].clone(),
        false => v["input"].clone(),
    }
}

#[test]
fn frozen_records_resolve_the_same_as_the_screen() {
    let records: Vec<Value> = serde_json::from_slice(
        &std::fs::read(
            fixtures()
                .join("readings")
                .join("0.16")
                .join("records.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(records.len() > 100);
    let mut used = std::collections::BTreeSet::new();
    for r in &records {
        let household = r["household"].as_str().unwrap();
        let key = r["key"].as_str().unwrap();
        let input = input_of(household);
        let got = match key.strip_prefix("assumed:") {
            Some(k) => readings::resolve_assumed_key(k, &input),
            None => readings::resolve_key(key, &input),
        };
        assert_eq!(got.as_ref(), Some(&r["reading"]), "{household} {key}");
        if r["reading"]["kind"] == "address" {
            let now = readings::read_at(&input, &r["reading"]["address"]);
            let unboxed = now.map(|v| match (v.get("state"), v.get("origin")) {
                (Some(s), Some(o)) if s.is_string() && o.is_object() => {
                    if s == "unknown" {
                        v["substitute"]["value"].clone()
                    } else {
                        v.get("value").cloned().unwrap_or(Value::Null)
                    }
                }
                _ => v.clone(),
            });
            assert_eq!(
                unboxed.unwrap_or(Value::Null),
                r["value"],
                "{household} {key} の値"
            );
        }
        used.insert(key.to_owned());
    }
    assert_eq!(readings::entry_count(), readings::entry_froms().len());
}

#[test]
fn migration_ids_match_the_screen() {
    // 画面のテスト（app/test/readings.test.ts）と同じ場所から同じ ID になる。値は node:crypto の SHA-256 から作ったもの
    let place = "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/0";
    let digest =
        household_store::crypto::sha256(format!("lifeplan.migrate.0.17:{place}").as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let want: String = b.iter().map(|x| format!("{x:02x}")).collect();
    assert_eq!(readings::migration_id(place).replace('-', ""), want);
    // 画面のテストと同じ固定の値
    assert_eq!(
        readings::migration_id(place),
        "7c511b6c-4f38-4475-ac92-7c43676cfba5"
    );
}
