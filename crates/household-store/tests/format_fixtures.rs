// 過去のすべての形式の版の見本（0011 の5）: `tests/fixtures/household-format/<版>/` に、暗号化した世帯ファイル（household.lphf）・
// 試験用の鍵の作り方（key.txt）・暗号を外した本文（body.json）を置き、消さない。毎回すべての版を開いて今の版へ変換する。
//
// 試験用の鍵は秘密ではない（key.txt に書いた文字列の SHA-256）。架空の世帯（モデル世帯の写し）だけを入れる。
use std::path::PathBuf;

use household_store::container::{self, HouseholdHeader};
use household_store::{crypto, migrate};
use serde_json::Value;

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
        if *v == "0.40" {
            // 0.40 から: 教育の目標の留学（0088）
            let goals = now["household"]["request"]["input"]["household"]["goals"]
                .as_array()
                .unwrap();
            let abroad: Vec<&serde_json::Value> = goals
                .iter()
                .filter_map(|g| g["education"]["abroad"].as_array())
                .flatten()
                .collect();
            assert!(abroad
                .iter()
                .any(|a| a["kind"] == "leave" && a["onContingency"]["mode"] == "stop"));
            assert!(abroad
                .iter()
                .any(|a| a["kind"] == "credit" && a["amount"].is_number()));
        }
        if *v == "0.39" {
            // 0.39 から: 教育の段の給食費の選び方・部活動などの費用・保育料とは別にかかるお金（0062・0029 の追記 2026-10-30）
            let goals = now["household"]["request"]["input"]["household"]["goals"]
                .as_array()
                .unwrap();
            let stages: Vec<&serde_json::Value> = goals
                .iter()
                .filter_map(|g| g["education"]["stages"].as_array())
                .flatten()
                .collect();
            assert!(stages.iter().any(|s| s["schoolLunch"] == "free"));
            assert!(stages.iter().any(|s| s["clubAnnual"].is_number()));
            assert!(stages
                .iter()
                .any(|s| s["stage"] == "nursery" && s["extraAnnual"].is_number()));
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
        // 0.17 から（0035・0036）: 贈与者は世帯の外の家族の構成員に、親・祖父母は世帯の外の家族の印を持ち、差分は当て先の形で、
        // 関係などの並びの要素は ID を持つ（古い版の見本は変換の段で）
        let hh = &now["household"]["request"]["input"]["household"];
        assert!(
            hh.get("donors").is_none(),
            "{v}: 贈与者は世帯の外の家族の構成員にする"
        );
        for m in hh["members"].as_array().unwrap() {
            if matches!(m["kind"].as_str(), Some("parent" | "grandparent")) {
                assert!(m["outside"].is_object(), "{v}: 親・祖父母は世帯の外の家族");
            }
        }
        for r in hh["relations"].as_array().unwrap() {
            assert!(r["id"].is_string(), "{v}: 関係は ID を持つ");
        }
        for p in now["proposals"].as_array().unwrap() {
            for d in p["diffs"].as_array().into_iter().flatten() {
                assert!(
                    d.get("key").is_none(),
                    "{v}: 差分に動かす項目のキーを書かない"
                );
                assert!(matches!(d["op"].as_str(), Some("set" | "add" | "remove")));
            }
        }
        // 0035 の12 の検査: valueStates の鍵の入力項目ID が登録簿にあり、同じ値を値の箱と行の両方に書かず、値の無い場所に行を書かない
        let problems =
            household_store::readings::value_state_problems(&now["household"]["request"]["input"]);
        assert!(problems.is_empty(), "{v}: {problems:?}");
        assert!(
            !now["workspace"]["shownItems"]
                .as_array()
                .unwrap()
                .iter()
                .any(Value::is_string),
            "{v}: 対策に足した項目は当て先で持つ"
        );
        if *v == "0.17" {
            // 0.17 の見本は、画面の中の形では作れない形も持つ（0035 の12）
            let spouses = hh["relations"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["type"] == "spouse")
                .count();
            assert_eq!(spouses, 2, "期間を分けた2本の配偶者の関係");
            assert!(hh["members"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["kind"] == "sibling" && m["outside"]["periods"][0]["living"] == true));
            assert!(hh["members"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["outside"].is_object() && m.get("birth").is_none()));
            assert_eq!(
                hh["debts"][0]["valueStates"]["debt.principal"]["state"],
                "unknown"
            );
            assert_eq!(now["household"]["notices"][0]["kind"], "outsideFamily");
            let ops: Vec<&str> = now["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|p| p["diffs"].as_array().unwrap().iter())
                .filter_map(|d| d["op"].as_str())
                .collect();
            assert!(ops.contains(&"add") && ops.contains(&"remove"));
            // 0.16 の鍵から読み替えた前提の差分（legacy つきで当て先に読めたもの）
            assert!(now["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|p| p["diffs"].as_array().unwrap().iter())
                .any(|d| d["target"]["plan"] == "assumptions"
                    && d["legacy"].is_object()
                    && d.get("unresolved").is_none()));
        }
        if migrate::parse(v).unwrap() >= (0, 18) {
            // 0.18 から（0040）: 段階・例外の年・器の利回りの段階・資産配分の段階・期間ごとの伸び（要素は ID を持つ）
            let pe = &hh["periodicExpenses"][0];
            assert!(
                pe["stages"][0]["id"].is_string() && pe["stages"][0]["rampYears"].is_u64(),
                "{v}: 周期的な支出の段階"
            );
            assert!(pe["exceptions"][0]["year"].is_u64(), "{v}: 例外の年");
            assert!(
                hh["residences"][0]["maintenance"]["stages"].is_array(),
                "{v}: 修繕費の段階"
            );
            assert!(
                hh["accounts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a["returnStages"].is_array() && a["returnExceptions"].is_array()),
                "{v}: 器の利回りの段階と例外の年"
            );
            assert!(
                now["household"]["request"]["input"]["assumptions"]["investment"]["allocation"]
                    ["stages"]
                    .is_array(),
                "{v}: 資産配分の段階"
            );
            assert!(
                hh["employmentPeriods"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["salary"]["growth"]["rate"].is_string()),
                "{v}: 給与の伸びの率"
            );
        }
        // 0.19 から（0042）: 世帯の外の家族のお金（任意）。見本は親の預金・生活費・年金・一時の入金と、預金を変えるプランの差分を持つ
        let wallets: Vec<&Value> = hh["members"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m.get("wallet"))
            .collect();
        if migrate::parse(v).unwrap() >= (0, 19) {
            let w = wallets
                .first()
                .expect("0.19 の見本には世帯の外の家族のお金がある");
            assert!(w["balance"].is_object() && w["living"].is_object());
            assert!(w["lumpSums"][0]["id"].is_string());
            assert!(now["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|p| p["diffs"].as_array().unwrap().iter())
                .any(|d| d["item"] == "member.wallet" && d["at"][0] == "balance"));
        } else {
            assert!(
                wallets.is_empty(),
                "{v}: 0.19 より前の版に世帯の外の家族のお金は無い"
            );
        }
        // 0.20 から（0044）: お金の行（入るお金の行・出るお金の行に足した欄・口座の間の移し替え・受け継ぐ借金の欄。どれも任意）
        if migrate::parse(v).unwrap() >= (0, 20) {
            let incomes = hh["incomeFlows"]
                .as_array()
                .expect("0.20 の見本には入るお金の行がある");
            assert!(
                incomes
                    .iter()
                    .any(|f| f["likelihood"] == "uncertain" && f["kind"] == "inheritance"),
                "{v}: 不確かな相続"
            );
            assert!(
                incomes
                    .iter()
                    .any(|f| f["stages"][0]["id"].is_string() && f["cost"].is_object()),
                "{v}: 段階と必要経費"
            );
            assert!(
                hh["periodicExpenses"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["gift"]["purpose"] == "general" && p["payer"].is_string()),
                "{v}: あげる贈与"
            );
            assert!(
                hh["transfers"][0]["how"]["kind"] == "amount",
                "{v}: 口座の間の移し替え"
            );
            assert!(
                hh["debts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|d| d["inheritedFrom"].is_string()),
                "{v}: 受け継ぐ借金"
            );
            assert!(now["proposals"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|p| p["diffs"].as_array().unwrap().iter())
                .any(|d| d["item"] == "incomeFlow.includeInBase"));
        } else {
            assert!(
                hh.get("incomeFlows").is_none() && hh.get("transfers").is_none(),
                "{v}: 0.20 より前の版にお金の行は無い"
            );
        }
        // 0.21 から（0052・0053）: 住まいの建て方・譲渡所得の税の額・負債の名前と種類の細目・ローンの入れ方の区分（どれも任意）
        if migrate::parse(v).unwrap() >= (0, 21) {
            let homes = hh["residences"]
                .as_array()
                .expect("0.21 の見本には住まいがある");
            assert!(
                homes
                    .iter()
                    .any(|r| r["style"] == "condo" && r["sale"]["tax"]["value"].is_number()),
                "{v}: 建て方と譲渡所得の税の額"
            );
            assert!(
                hh["debts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|d| d["subtype"] == "cardLoan" && d["label"].is_string()),
                "{v}: ローンの名前と種類の細目"
            );
            assert!(
                now["household"]["loanEntry"].is_object(),
                "{v}: ローンの入れ方の区分"
            );
        } else {
            assert!(
                hh["residences"]
                    .as_array()
                    .map(|rs| rs.iter().all(|r| r.get("style").is_none()))
                    .unwrap_or(true),
                "{v}: 0.21 より前の版に建て方は無い"
            );
        }
        // 0.22 から（0057）: 退職給付の名前と学歴（どれも任意。計算には使わない）
        if migrate::parse(v).unwrap() >= (0, 22) {
            let list = hh["retirementBenefits"]
                .as_array()
                .expect("0.22 の見本には退職給付がある");
            assert!(
                list.iter()
                    .any(|b| b["kind"] == "db" && b["label"].is_string()),
                "{v}: 退職給付の名前"
            );
            assert!(
                list.iter().any(|b| b["education"] == "highSchoolOffice"),
                "{v}: 退職給付の学歴"
            );
        } else {
            assert!(
                hh["retirementBenefits"]
                    .as_array()
                    .map(|bs| bs.iter().all(|b| b.get("education").is_none()))
                    .unwrap_or(true),
                "{v}: 0.22 より前の版に学歴は無い"
            );
        }
        // 0.23 から（0063）: 教育の目標の学校外の費用の入れ方と、塾・習い事の行の種類（どれも任意）
        let goals = hh["goals"].as_array().cloned().unwrap_or_default();
        let rows_mode = goals
            .iter()
            .any(|g| g["education"]["outOfSchoolMode"] == "rows");
        let kinds = goals.iter().any(|g| {
            g["education"]["lessons"]
                .as_array()
                .map(|ls| ls.iter().any(|l| l["kind"] == "cram"))
                .unwrap_or(false)
        });
        if migrate::parse(v).unwrap() >= (0, 23) {
            assert!(rows_mode && kinds, "{v}: 学校外の費用の入れ方と行の種類");
        } else {
            assert!(
                !rows_mode && !kinds,
                "{v}: 0.23 より前の版に学校外の費用の入れ方は無い"
            );
        }
        // 0.24 から（0060・0061）: 計算の要求の入力の、相続税の目安の設定と遺したい額（どれも任意）
        let input = &now["household"]["request"]["input"];
        if migrate::parse(v).unwrap() >= (0, 24) {
            assert!(
                input["inheritanceTax"]["realEstateRatio"].is_string()
                    && input["inheritanceTax"].get("points").is_none(),
                "{v}: 相続税の目安の設定（時点は入れない）"
            );
            assert!(
                input["legacy"]["amount"]["value"].is_number(),
                "{v}: 遺したい額"
            );
        } else {
            assert!(
                input.get("legacy").is_none(),
                "{v}: 0.24 より前の版に遺したい額は無い"
            );
        }
        // 0.25 から（0054・0055）: 保険の種類の細目と名前・保障の行の被保険者と限度日数・円の目安の形・病気の想定（どれも任意）
        let contracts = hh["insuranceContracts"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if migrate::parse(v).unwrap() >= (0, 25) {
            assert!(
                contracts.iter().any(|c| c["subtype"] == "medical"
                    && c["label"].is_string()
                    && c["coverages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|x| x["insured"].is_string())
                    && c["coverages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|x| x["maxDays"].is_number())),
                "{v}: 種類の細目・名前・保障の行の被保険者と限度日数"
            );
            assert!(
                contracts.iter().any(|c| c["simple"]["estimate"] == true),
                "{v}: 円の目安の形"
            );
            assert!(
                now["household"]["contingency"]["illness"]["disease"].is_string(),
                "{v}: 病気の想定"
            );
        } else {
            assert!(
                contracts.iter().all(|c| c.get("subtype").is_none()),
                "{v}: 0.25 より前の版に保険の種類の細目は無い"
            );
        }
        // 0.26 から（0069）: 車の維持費の入れ方と内訳の名前つきの行（どれも任意）
        let cars = now["household"]["request"]["input"]["household"]["cars"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if migrate::parse(v).unwrap() >= (0, 26) {
            assert!(
                cars.iter().any(|c| c["upkeepMode"] == "detail"
                    && c["upkeep"]["annual"].is_number()
                    && c["upkeepOther"].as_array().is_some_and(|o| o
                        .iter()
                        .all(|x| x["id"].is_string() && x["annual"].is_number()))),
                "{v}: 内訳で入れる車（合計の値も残す）と名前つきの行"
            );
            assert!(
                cars.iter().any(|c| c["upkeepMode"] == "total"),
                "{v}: 合計で入れる車"
            );
        } else {
            assert!(
                cars.iter()
                    .all(|c| c.get("upkeepMode").is_none() && c.get("upkeepOther").is_none()),
                "{v}: 0.26 より前の版に維持費の入れ方は無い"
            );
        }
        // 0.27 から（0070・0071）: 万一の前提の任意の欄・確かめた記録・万一の前提を上書きするプランの差分（どれも任意）
        let cg = &now["household"]["contingency"];
        if migrate::parse(v).unwrap() >= (0, 27) {
            assert!(
                cg["protection"]["method"] == "reverse"
                    && cg["incomeDrop"]["member"].is_string()
                    && cg["market"]["classes"].is_array()
                    && cg["stackMarket"] == true,
                "{v}: 万一の前提の任意の欄"
            );
            assert!(
                now["household"]["agreed"]["current"].is_object(),
                "{v}: 前提と推定の一覧の確かめた記録"
            );
            assert!(
                now["proposals"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .flat_map(|p| p["diffs"].as_array().cloned().unwrap_or_default())
                    .any(|d| d["target"]["plan"] == "contingency"
                        && d["item"] == "contingencyPremise.survivor"),
                "{v}: 万一の前提を上書きする差分"
            );
        } else {
            assert!(
                cg.get("incomeDrop").is_none() && now["household"].get("agreed").is_none(),
                "{v}: 0.27 より前の版に収入が減る場面の前提・確かめた記録は無い"
            );
        }
        // 0.28 から（0066・0067）: 受給中の遺族年金・障害年金の種類と、残した年金の記録（どれも任意）
        let flows = now["household"]["request"]["input"]["household"]["incomeFlows"].as_array();
        let typed = flows.is_some_and(|l| l.iter().any(|f| f["pensionType"].is_string()));
        if migrate::parse(v).unwrap() >= (0, 28) {
            assert!(typed, "{v}: 受給中の遺族年金・障害年金の種類");
            assert!(
                now["household"]["pensionKept"].is_object(),
                "{v}: 残した年金の記録"
            );
        } else {
            assert!(!typed, "{v}: 0.28 より前の版に受給中の年金の種類は無い");
        }
        // 0.29 から（0072）: 確かめの一覧の「次回確かめる」の印（任意）
        let marks = now["household"]["recheck"].as_array();
        if migrate::parse(v).unwrap() >= (0, 29) {
            assert!(
                marks.is_some_and(|l| !l.is_empty()
                    && l.iter().all(|m| m["id"].is_string() && m["on"].is_string())),
                "{v}: 次回確かめるの印"
            );
        } else {
            assert!(
                marks.is_none(),
                "{v}: 0.29 より前の版に次回確かめるの印は無い"
            );
        }
        // 0.30 から（0078）: 年金の記録が無い人（推計の区分）の受け取り開始（任意）
        let claimed = now["household"]["request"]["input"]["household"]["members"]
            .as_array()
            .is_some_and(|l| l.iter().any(|m| m["pensionClaim"]["basic"].is_object()));
        if migrate::parse(v).unwrap() >= (0, 30) {
            assert!(claimed, "{v}: 推計の区分の受け取り開始");
        } else {
            assert!(
                !claimed,
                "{v}: 0.30 より前の版に推計の区分の受け取り開始は無い"
            );
        }
        // 0.31 から（0079）: 収益不動産の物件を見分ける欄（任意。表示用）
        let named = now["household"]["request"]["input"]["household"]["accounts"]
            .as_array()
            .is_some_and(|l| {
                l.iter()
                    .any(|a| a["property"]["name"].is_string() && a["property"]["kind"].is_string())
            });
        if migrate::parse(v).unwrap() >= (0, 31) {
            assert!(named, "{v}: 収益不動産の物件名と種類");
        } else {
            assert!(!named, "{v}: 0.31 より前の版に物件名と種類は無い");
        }
        // 0.32 から（0080）: 収益不動産のお金の欄（取得の内訳・経費の費目・大きな修繕・民泊・宿。任意）
        let money = now["household"]["request"]["input"]["household"]["accounts"]
            .as_array()
            .is_some_and(|l| {
                l.iter().any(|a| {
                    a["property"]["acquisition"]["parts"].is_object()
                        && a["property"]["expenses"]["items"].is_object()
                        && a["property"]["repairs"].is_array()
                }) && l.iter().any(|a| a["property"]["lodging"].is_object())
            });
        if migrate::parse(v).unwrap() >= (0, 32) {
            assert!(money, "{v}: 収益不動産のお金の欄");
        } else {
            assert!(!money, "{v}: 0.32 より前の版に収益不動産のお金の欄は無い");
        }
        // 0.33 から（0081）: 税と出口の欄（売ったときにローンを返すか・民泊・宿の所得の区分・申告の仕方。任意）
        let exit = now["household"]["request"]["input"]["household"]["accounts"]
            .as_array()
            .is_some_and(|l| {
                l.iter()
                    .any(|a| a["property"]["sale"]["repayLoan"].is_boolean())
                    && l.iter()
                        .any(|a| a["property"]["lodging"]["incomeKind"].is_string())
            })
            && now["household"]["request"]["input"]["household"]["members"]
                .as_array()
                .is_some_and(|l| l.iter().any(|m| m["taxReturn"]["method"].is_string()));
        if migrate::parse(v).unwrap() >= (0, 33) {
            assert!(exit, "{v}: 収益不動産の税と出口の欄");
        } else {
            assert!(!exit, "{v}: 0.33 より前の版に税と出口の欄は無い");
        }
        // 0.34 から（0083）: 入力項目の選び方（任意）
        let choice = now["household"]["itemChoice"]["hidden"]
            .as_array()
            .is_some_and(|l| !l.is_empty() && l.iter().all(Value::is_string))
            && now["household"]["itemChoice"]["levels"].is_object();
        if migrate::parse(v).unwrap() >= (0, 34) {
            assert!(choice, "{v}: 入力項目の選び方");
        } else {
            assert!(
                now["household"]["itemChoice"].is_null(),
                "{v}: 0.34 より前の版に入力項目の選び方は無い"
            );
        }
        // 0.35 から（0041・0055）: 確かめの注意の「確認した」の印（任意）
        let acks = now["household"]["noticeAcks"].as_array().is_some_and(|l| {
            !l.is_empty()
                && l.iter().all(|a| {
                    a["id"].is_string()
                        && a["on"].is_string()
                        && a["of"]
                            .as_array()
                            .is_some_and(|o| !o.is_empty() && o.iter().all(Value::is_string))
                })
        });
        if migrate::parse(v).unwrap() >= (0, 35) {
            assert!(acks, "{v}: 確かめの注意の「確認した」の印");
        } else {
            assert!(
                now["household"]["noticeAcks"].is_null(),
                "{v}: 0.35 より前の版に「確認した」の印は無い"
            );
        }
        // 0.36 から（0085）: 就業不能・収入が減るの場面の配偶者の働き方（任意）
        let partner = now["household"]["contingency"]["partnerWork"]
            .as_object()
            .is_some_and(|scenes| {
                !scenes.is_empty()
                    && scenes.iter().all(|(k, v)| {
                        (k == "disability" || k == "income")
                            && v.as_object()
                                .is_some_and(|m| m.values().all(|w| w["type"].is_string()))
                    })
            });
        if migrate::parse(v).unwrap() >= (0, 36) {
            assert!(partner, "{v}: 就業不能・収入が減るの場面の配偶者の働き方");
        } else {
            assert!(
                now["household"]["contingency"]["partnerWork"].is_null(),
                "{v}: 0.36 より前の版に就業不能・収入が減るの配偶者の働き方は無い"
            );
        }
        // 0.37 から（0086）: 入るお金の行の表の行「雑所得」と、事業所得として扱う副業の行
        let rows: Vec<(String, String)> = now["household"]["request"]["input"]["household"]
            ["incomeFlows"]
            .as_array()
            .map(|l| {
                l.iter()
                    .filter(|f| f["kind"] == "sideJob")
                    .map(|f| {
                        (
                            f["row"].as_str().unwrap_or("").to_string(),
                            f["taxTreatment"].as_str().unwrap_or("").to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let misc_row = rows
            .iter()
            .any(|(r, _)| r == "cf.income.other.miscellaneous");
        if migrate::parse(v).unwrap() >= (0, 37) {
            assert!(misc_row, "{v}: 表の行「雑所得」の副業の行");
            assert!(
                rows.iter()
                    .any(|(r, t)| r == "cf.income.business" && t == "business"),
                "{v}: 事業所得として扱う副業の行"
            );
        } else {
            assert!(!misc_row, "{v}: 0.37 より前の版に表の行「雑所得」は無い");
        }
        // 0.38 から（0047 の追記 2026-10-29 の2）: 給与からの推定のままの標準報酬月額は書かない（どの版も変換の後には無い）。
        // 0.38 の見本は、配偶者の働き方の期間を空欄（給与から毎年決め直す）にしている
        let periods = now["household"]["request"]["input"]["household"]["employmentPeriods"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let not_entered = |b: &serde_json::Value| {
            b.is_null()
                || (b["state"] == "estimated" && b["origin"]["kind"] == "auto")
                || (b["state"] == "unknown"
                    && b["substitute"]["origin"]["kind"] == "auto"
                    && b["substitute"]["estimate"]["method"] == "derived")
        };
        for p in &periods {
            let smr = &p["standardMonthlyRemuneration"];
            assert!(
                smr.is_null() || !(not_entered(&smr["health"]) && not_entered(&smr["pension"])),
                "{v}: 推定のままの標準報酬月額が残っている（{}）",
                p["id"]
            );
        }
        if migrate::parse(v).unwrap() >= (0, 38) {
            assert!(
                periods
                    .iter()
                    .any(|p| p.get("salary").is_some()
                        && p.get("standardMonthlyRemuneration").is_none()),
                "{v}: 標準報酬月額が空欄の給与の期間"
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
