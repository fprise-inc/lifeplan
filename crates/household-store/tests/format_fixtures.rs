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
        if *v == "0.7" || *v == "0.8" {
            // 0.7 から: 資産と負債のタブの並べる時点（既定の時点と、この世帯で選んだ時点。候補の鍵と決まった年）。
            // 0.8 から: 表示の設定はタブごとの区画（0.7 の見本は変換で区画へ移る）
            let d = &now["display"]["balance"];
            assert!(d["points"]
                .as_array()
                .is_some_and(|a| (2..=4).contains(&a.len())));
            let cols = d["columns"]
                .as_array()
                .expect("0.7 からの見本にはこの世帯で選んだ時点がある");
            assert!(cols.iter().any(|c| c.get("point").is_some()));
            assert!(cols.iter().any(|c| c["year"].is_u64()));
            assert!(d["guide"].is_object(), "{v}: 家計の体力の目安の幅");
        }
        // 0.8 から: 表示の設定はタブごとの区画。なくした「操作中はグラフを上に表示」（dock）は持たない
        if now
            .get("display")
            .is_some_and(|d| !d.as_object().unwrap().is_empty())
        {
            let d = &now["display"];
            assert!(d["result"].is_object(), "{v}: display.result");
            assert!(d["balance"].is_object(), "{v}: display.balance");
            assert!(d.get("dock").is_none(), "{v}: display.dock は持たない");
            assert!(d.get("metrics").is_none(), "{v}: 結果のタブの値は区画の中");
        }
        if *v == "0.9" {
            // 0.9 から: 教育の目標の保育所の段の保育の時間・自治体の水準の割合（月額は空）と、給食費の選び方（0029）
            let goals = now["household"]["request"]["input"]["household"]["goals"]
                .as_array()
                .unwrap();
            let stages: Vec<&serde_json::Value> = goals
                .iter()
                .filter_map(|g| g["education"]["stages"].as_array())
                .flatten()
                .collect();
            let nursery = stages
                .iter()
                .find(|s| s["stage"] == "nursery")
                .expect("0.9 の見本には保育所の段がある");
            assert_eq!(nursery["hours"], "short");
            assert!(nursery["feeRatio"].is_string());
            assert!(
                nursery.get("monthly").is_none(),
                "月額は空（収入から自動で計算）"
            );
            assert!(
                goals
                    .iter()
                    .any(|g| g["education"]["schoolLunch"] == "free"),
                "0.9 の見本には給食費の選び方がある"
            );
        }
        if *v == "0.10" {
            // 0.10 から: 持ち帰り用のレポートの書き出しの記録（きっかけ takeaway。パスワードの有無だけ。0030）
            let tk = now["snapshots"]
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["trigger"] == "takeaway")
                .expect("0.10 の見本には持ち帰り用のレポートの控えがある");
            assert_eq!(tk["takeaway"]["password"], true);
            assert!(tk["takeaway"].get("addressee").is_none());
        }
        if *v == "0.11" || *v == "0.12" {
            // 0.11 から: 黒字のうち貯まる割合（期間で変える組つき）（0031）
            let a = &now["household"]["request"]["input"]["assumptions"];
            assert_eq!(a["surplusSaving"]["ratio"], "0.6");
            assert!(a["surplusSaving"]["changes"]
                .as_array()
                .is_some_and(|c| !c.is_empty()));
            // 0.12 から: 生活防衛資金は持たない（0.11 の見本の値は変換の段で捨てる。0031 の追記）
            if *v == "0.11" {
                assert_eq!(
                    expected["household"]["request"]["input"]["assumptions"]["emergencyReserve"]
                        ["months"],
                    6
                );
            }
            assert!(
                a.get("emergencyReserve").is_none(),
                "{v}: 生活防衛資金は捨てる"
            );
        }
        if migrate::parse(v).unwrap() >= (0, 13) {
            // 0.13 から: 資産と負債のタブの表示の設定に、お金の3つの分け方（何か月分・何年先まで・呼び方。0032）
            let m = &now["display"]["balance"]["moneyThree"];
            assert_eq!(m["months"], 3);
            assert_eq!(m["years"], 15);
            assert_eq!(m["wording"], "time");
        } else {
            assert!(
                now["display"]["balance"].get("moneyThree").is_none(),
                "{v}: お金の3つの分け方の設定は 0.13 から（変換の段では足さない）"
            );
        }
        if *v == "0.3" {
            assert!(now.get("snapshots").is_some(), "0.3 の見本には控えがある");
        }
        // 0.14 から: 明細の取り込みの記録（任意。0034）。中身は変換で変えない。元のファイルは持たない（指紋と大きさだけ）
        if let Some(st) = now.get("statements") {
            assert!(
                migrate::parse(v).unwrap() >= (0, 14),
                "{v}: 0.14 より前の版に明細の取り込みの記録は無い"
            );
            assert_eq!(
                st, &expected["statements"],
                "{v}: 明細の取り込みの記録の中身は変えない"
            );
            let imp = &st["imports"][0];
            assert!(imp["file"]["sha256"]
                .as_str()
                .unwrap()
                .starts_with("sha256:"));
            assert!(imp["file"].get("bytes").is_some());
            assert_eq!(
                imp["file"].as_object().unwrap().len(),
                2,
                "{v}: 元のファイルの中身は持たない"
            );
            // 0.15 から: 確認シートの依頼の記録（任意。0034 の9）。シートの番号 → 行の対応と、ファイルの指紋と大きさだけ
            if let Some(reqs) = st.get("requests") {
                assert!(
                    migrate::parse(v).unwrap() >= (0, 15),
                    "{v}: 0.15 より前の版に確認シートの依頼の記録は無い"
                );
                let r = &reqs[0];
                assert!(r["id"].as_str().unwrap().starts_with("M-"));
                assert_eq!(r["file"].as_object().unwrap().len(), 2);
                assert!(r["rows"][0]["no"].is_u64());
                // 0.16 から: 店ごとにまとめたシートの1行は、同じ番号に複数の行（見本は 0.16 から持つ）
                let grouped = reqs.as_array().unwrap().iter().any(|q| {
                    let nos: Vec<u64> = q["rows"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|x| x["no"].as_u64().unwrap())
                        .collect();
                    let mut uniq = nos.clone();
                    uniq.sort_unstable();
                    uniq.dedup();
                    uniq.len() < nos.len()
                });
                assert_eq!(
                    grouped,
                    migrate::parse(v).unwrap() >= (0, 16),
                    "{v}: 店ごとにまとめた行の依頼の記録は 0.16 の見本から"
                );
            } else {
                assert!(
                    migrate::parse(v).unwrap() < (0, 15),
                    "{v}: 0.15 の見本には確認シートの依頼の記録がある"
                );
            }
        } else {
            assert!(
                migrate::parse(v).unwrap() < (0, 14),
                "{v}: 0.14 の見本には明細の取り込みの記録がある"
            );
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
