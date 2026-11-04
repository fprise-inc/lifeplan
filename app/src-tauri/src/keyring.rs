//! 鍵の束（0117 の2・0110 の追記 2026-11-04）。配布元の設定（`config/distribution.toml`）の公開鍵を build.rs が写し、
//! 配布の部品（`distribution::keys`）の束にする。
//!
//! - 本番の鍵（`[keys]`）は、どのビルドにも入る（役割ごとに現用＋次期の2本まで）。
//! - 開発用の鍵（`[dev_keys]`。名前は `dev-` で始まる）は、開発用のビルド（debug）だけが足す。製品のビルドでは build.rs が空にし、ここでも足さない。
//!   これで、試しの鍵で発行した機能を有効にするコードや、試しの鍵で署名した取り下げの一覧は、製品のビルドでは受け付けない。
//! - 取り下げの一覧の `revoked.keys` に載った鍵は、使う側（revocations.rs）が [`distribution::keys::KeyRing::without`] で外す。

use std::sync::OnceLock;

use distribution::keys::{KeyConfig, KeyRing};

include!(concat!(env!("OUT_DIR"), "/dist_keys.rs"));

fn build() -> KeyRing {
    // build.rs が同じ部品で形を確かめているので、ここで誤りになることは無い（あれば鍵の無い束＝確かめられない、の側に倒す）
    let prod = KeyRing::from_config(&KeyConfig {
        app_update: KEYS_APP_UPDATE,
        data: KEYS_DATA,
        auto_delivery: KEYS_AUTO_DELIVERY,
        revocation: KEYS_REVOCATION,
        feature_code: KEYS_FEATURE_CODE,
        feature_code_revocation: KEYS_FEATURE_CODE_REVOCATION,
    })
    .unwrap_or_default();
    if !cfg!(debug_assertions) {
        return prod;
    }
    let dev = KeyConfig {
        app_update: &[],
        data: DEV_KEYS_DATA,
        auto_delivery: DEV_KEYS_AUTO_DELIVERY,
        revocation: DEV_KEYS_REVOCATION,
        feature_code: DEV_KEYS_FEATURE_CODE,
        feature_code_revocation: DEV_KEYS_FEATURE_CODE_REVOCATION,
    };
    match prod.with_dev(&dev) {
        Ok(r) => r,
        Err(_) => prod,
    }
}

/// このビルドが受け付ける鍵の束（取り下げた鍵を外す前）
pub fn ring() -> &'static KeyRing {
    static RING: OnceLock<KeyRing> = OnceLock::new();
    RING.get_or_init(build)
}

#[cfg(test)]
mod tests {
    use super::*;
    use distribution::keys::Role;

    #[test]
    fn embedded_keys_are_readable() {
        // 配布元の設定の公開鍵が、すべて鍵の束に入る（読めない鍵があると、その鍵のものが黙って使えなくなる）
        let r = ring();
        assert_eq!(
            r.for_role(Role::FeatureCode).count(),
            KEYS_FEATURE_CODE.len() + DEV_KEYS_FEATURE_CODE.len()
        );
        assert_eq!(
            r.for_role(Role::Revocation).count(),
            KEYS_REVOCATION.len() + DEV_KEYS_REVOCATION.len()
        );
        assert_eq!(
            r.for_role(Role::FeatureCodeRevocation).count(),
            KEYS_FEATURE_CODE_REVOCATION.len() + DEV_KEYS_FEATURE_CODE_REVOCATION.len()
        );
        // 本番の欄に開発用の鍵は無い
        for l in KEYS_FEATURE_CODE
            .iter()
            .chain(KEYS_REVOCATION)
            .chain(KEYS_FEATURE_CODE_REVOCATION)
        {
            assert!(!l.starts_with(distribution::keys::DEV_KID_PREFIX), "{l}");
        }
        // 開発用のビルドでは開発用の鍵が入っている（製品のビルドでは build.rs が空にし、束にも足さない）
        assert_eq!(
            r.has_dev_keys(),
            !DEV_KEYS_FEATURE_CODE.is_empty()
                || !DEV_KEYS_REVOCATION.is_empty()
                || !DEV_KEYS_FEATURE_CODE_REVOCATION.is_empty()
        );
    }
}
