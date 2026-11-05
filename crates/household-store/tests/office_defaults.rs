// 事務所の既定値（0073）: 事務所データに暗号化して持つ・開き直しても残る・形の合わない値は受けない。
// PC を「データフォルダ＋メモリの保管庫」で模す。OS の保管庫には触れない。
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use household_store::{crypto, Clock, MemorySecretStore, Store, StoreError};

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);

impl Clock for TestClock {
    fn now_unix(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn defaults_are_kept_encrypted_and_reopen() {
    let dir = Dir(std::env::temp_dir().join(format!("hs-defaults-{}", crypto::new_uuid())));
    let root = dir.0.join("data");
    let secrets = Arc::new(MemorySecretStore::default());
    let clock = TestClock(Arc::new(AtomicI64::new(1_792_368_000)));
    let s = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s.status().unwrap();
    assert_eq!(s.office_defaults().unwrap(), serde_json::json!({}));
    let v = serde_json::json!({"version": 1, "care": {"selfAndSpouse": "fill"}, "assumptions": {"inflation": "0.015"}, "changedOn": "2026-10-27"});
    s.set_office_defaults(v.clone()).unwrap();
    assert_eq!(s.office_defaults().unwrap(), v);
    // 事務所データは暗号化して保存する（平文の値がファイルに無い）
    for e in std::fs::read_dir(&root).unwrap() {
        let p = e.unwrap().path();
        if p.is_file() {
            let bytes = std::fs::read(&p).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains("selfAndSpouse"),
                "{}",
                p.display()
            );
        }
    }
    // 開き直しても残る
    drop(s);
    let s2 = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s2.status().unwrap();
    assert_eq!(s2.office_defaults().unwrap(), v);
    // オブジェクトでない・大きすぎる値は受けず、前の値のまま
    assert_eq!(
        s2.set_office_defaults(serde_json::json!([1, 2]))
            .unwrap_err(),
        StoreError::OFFICE_DEFAULTS
    );
    // 上限は 256KB（0073・0111）
    let big = serde_json::json!({"memo": "x".repeat(300 * 1024)});
    assert_eq!(
        s2.set_office_defaults(big).unwrap_err(),
        StoreError::OFFICE_DEFAULTS
    );
    assert_eq!(s2.office_defaults().unwrap(), v);
    // 空のオブジェクトで外す
    s2.set_office_defaults(serde_json::json!({})).unwrap();
    assert_eq!(s2.office_defaults().unwrap(), serde_json::json!({}));
}

#[test]
fn feature_codes_are_kept_encrypted_and_reopen() {
    // 機能を有効にするコード（0110）: 事務所データに暗号化して持つ。確かめるのはアプリ本体（ここは文字列の数と形だけ）
    let dir = Dir(std::env::temp_dir().join(format!("hs-feature-codes-{}", crypto::new_uuid())));
    let root = dir.0.join("data");
    let secrets = Arc::new(MemorySecretStore::default());
    let clock = TestClock(Arc::new(AtomicI64::new(1_792_368_000)));
    let s = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s.status().unwrap();
    assert!(s.feature_codes().unwrap().is_empty());
    let codes = vec!["LPFC1-eyJzYW1wbGUiOjF9.c2lnbmF0dXJl".to_owned()];
    s.set_feature_codes(codes.clone()).unwrap();
    s.set_office_defaults(serde_json::json!({"version": 1}))
        .unwrap();
    for e in std::fs::read_dir(&root).unwrap() {
        let p = e.unwrap().path();
        if p.is_file() {
            assert!(
                !String::from_utf8_lossy(&std::fs::read(&p).unwrap()).contains("LPFC1-"),
                "{}",
                p.display()
            );
        }
    }
    drop(s);
    let s2 = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s2.status().unwrap();
    assert_eq!(s2.feature_codes().unwrap(), codes);
    // 事務所の既定値を置き換えても消えない
    s2.set_office_defaults(serde_json::json!({})).unwrap();
    assert_eq!(s2.feature_codes().unwrap(), codes);
    // 空白・改行を含む・多すぎる・長すぎるものは受けない
    for bad in [
        vec!["a b".to_owned()],
        vec![String::new()],
        vec!["x".repeat(3000)],
        vec!["c".to_owned(); 17],
    ] {
        assert_eq!(
            s2.set_feature_codes(bad).unwrap_err(),
            StoreError::FEATURE_CODES
        );
    }
    assert_eq!(s2.feature_codes().unwrap(), codes);
    s2.set_feature_codes(vec![]).unwrap();
    assert!(s2.feature_codes().unwrap().is_empty());
}

#[test]
fn custom_ledger_key_is_stable_and_per_office() {
    // カスタム層の承認の台帳の鍵（0016 の3・6）: 同じ事務所なら開き直しても同じ。別の事務所・ほかの用途の鍵とは違う
    let dir = Dir(std::env::temp_dir().join(format!("hs-custom-key-{}", crypto::new_uuid())));
    let clock = TestClock(Arc::new(AtomicI64::new(1_792_368_000)));
    let secrets = Arc::new(MemorySecretStore::default());
    let s = Store::new(
        dir.0.join("a"),
        secrets.clone(),
        clock.clone(),
        "0.1.0-test",
    );
    s.status().unwrap();
    let k1 = s.custom_ledger_key().unwrap();
    drop(s);
    let s = Store::new(
        dir.0.join("a"),
        secrets.clone(),
        clock.clone(),
        "0.1.0-test",
    );
    s.status().unwrap();
    assert_eq!(*s.custom_ledger_key().unwrap(), *k1);
    let other = Store::new(
        dir.0.join("b"),
        Arc::new(MemorySecretStore::default()),
        clock,
        "0.1.0-test",
    );
    other.status().unwrap();
    assert_ne!(*other.custom_ledger_key().unwrap(), *k1);
}

// 事務所の見た目（0121）: 暗号化して持つ・開き直しても残る・SVG と大きすぎる画像は受けない・全部空で欄を外す
#[test]
fn branding_is_kept_encrypted_and_reopens() {
    use household_store::branding::{Branding, Logo};
    let dir = Dir(std::env::temp_dir().join(format!("hs-branding-{}", crypto::new_uuid())));
    let root = dir.0.join("data");
    let secrets = Arc::new(MemorySecretStore::default());
    let clock = TestClock(Arc::new(AtomicI64::new(1_792_368_000)));
    let s = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s.status().unwrap();
    assert_eq!(s.office_branding().unwrap(), Branding::default());
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&120u32.to_be_bytes());
    png.extend_from_slice(&40u32.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    let b = s
        .set_office_branding(Branding {
            name: Some("みどりFP事務所".into()),
            color: Some("#2F6B4F".into()),
            appearance: Some("dark".into()),
            logo: Some(Logo {
                mime: String::new(),
                width: 0,
                height: 0,
                data: png.clone(),
            }),
        })
        .unwrap();
    assert_eq!(b.color.as_deref(), Some("#2f6b4f"));
    assert_eq!(
        b.logo.as_ref().map(|l| (l.width, l.height)),
        Some((120, 40))
    );
    for e in std::fs::read_dir(&root).unwrap() {
        let p = e.unwrap().path();
        if p.is_file() {
            let bytes = std::fs::read(&p).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains("みどり"),
                "{}",
                p.display()
            );
        }
    }
    drop(s);
    let s2 = Store::new(root.clone(), secrets.clone(), clock.clone(), "0.1.0-test");
    s2.status().unwrap();
    assert_eq!(s2.office_branding().unwrap(), b);
    // SVG は受けず、前の値のまま
    let svg = Branding {
        logo: Some(Logo {
            mime: "image/svg+xml".into(),
            width: 10,
            height: 10,
            data: b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
        }),
        ..Default::default()
    };
    assert_eq!(s2.set_office_branding(svg).unwrap_err(), StoreError::LOGO);
    assert_eq!(s2.office_branding().unwrap(), b);
    // 全部空にすると欄を外す（既定の見た目）
    s2.set_office_branding(Branding::default()).unwrap();
    assert_eq!(s2.office_branding().unwrap(), Branding::default());
}
