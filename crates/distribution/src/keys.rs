//! 4種類の鍵の束（0017 の5）。
//!
//! - 役割は4つ: アプリ更新用（`app_update`）・データ用（`data`）・自動配信用（`auto_delivery`）・取り下げ用（`revocation`）。
//!   役割ごとに、現用と次期の2本まで持つ（どちらで署名されていても受け付ける）。
//! - 書き方は配布元の設定（`config/distribution.toml` の `[keys]`）と同じ:
//!   - `app_update`: Tauri が出す公開鍵の文字列（minisign の形。[`crate::minisig`]）。鍵の名前は中の鍵の番号から決まる
//!   - ほかの3つ: 「鍵の名前:公開鍵（32バイトの base64url）」（機能を有効にするコードの鍵〔0110〕と同じ書き方）
//! - 鍵の名前は束の中で重ならない。同じ公開鍵を2つの役割で使わない（役割を分ける意味が無くなるため）。
//! - 取り下げの一覧に載った鍵の名前は [`KeyRing::without`] で外す。取り下げ用の鍵は一覧では外せない
//!   （漏れた取り下げ用の鍵で、もう1本の取り下げ用の鍵を外して乗っ取るのを防ぐ。取り下げ用の鍵の入れ替えはアプリ本体の更新で行う）。

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine as _;
use ed25519_dalek::VerifyingKey;

use crate::minisig::MinisignPublicKey;

/// 1つの役割に持てる鍵の数（現用＋次期）
pub const MAX_PER_ROLE: usize = 2;

/// 鍵の役割
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// アプリ本体の更新（Tauri の updater の minisign の形）
    AppUpdate,
    /// 人が承認した制度データパック・マスタデータパック、お知らせ、自動配信の許可表
    Data,
    /// 決まった関門を通って自動で配る制度データの更新（受け付ける範囲は 0022 の3）
    AutoDelivery,
    /// 取り下げの一覧とアプリの最低版（オフラインで保管）
    Revocation,
}

impl Role {
    pub const ALL: [Role; 4] = [
        Role::AppUpdate,
        Role::Data,
        Role::AutoDelivery,
        Role::Revocation,
    ];

    /// 配布元の設定・目録での名前
    pub fn name(&self) -> &'static str {
        match self {
            Role::AppUpdate => "app_update",
            Role::Data => "data",
            Role::AutoDelivery => "auto_delivery",
            Role::Revocation => "revocation",
        }
    }

    pub fn from_name(s: &str) -> Option<Role> {
        Role::ALL.into_iter().find(|r| r.name() == s)
    }
}

/// 確かめるのに使う公開鍵
#[derive(Debug, Clone)]
pub enum KeyMaterial {
    /// Ed25519 の公開鍵（データ用・自動配信用・取り下げ用）
    Ed25519(VerifyingKey),
    /// minisign の公開鍵（アプリ更新用）
    Minisign(MinisignPublicKey),
}

/// 束に入った1本の鍵
#[derive(Debug, Clone)]
pub struct TrustedKey {
    pub kid: String,
    pub role: Role,
    pub material: KeyMaterial,
}

impl TrustedKey {
    fn key_bytes(&self) -> [u8; 32] {
        match &self.material {
            KeyMaterial::Ed25519(k) => k.to_bytes(),
            KeyMaterial::Minisign(k) => k.key_bytes(),
        }
    }
}

/// 配布元の設定の `[keys]` の4つの並び（書いたままの文字列）
#[derive(Debug, Default, Clone, Copy)]
pub struct KeyConfig<'a> {
    pub app_update: &'a [&'a str],
    pub data: &'a [&'a str],
    pub auto_delivery: &'a [&'a str],
    pub revocation: &'a [&'a str],
}

/// 4種類の鍵の束
#[derive(Debug, Clone, Default)]
pub struct KeyRing {
    keys: Vec<TrustedKey>,
}

/// 鍵の名前の形（英小文字・数字・「-」、1〜32文字、英小文字か数字で始まる）
pub fn valid_kid(kid: &str) -> bool {
    (1..=32).contains(&kid.len())
        && kid
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && !kid.starts_with('-')
}

impl KeyRing {
    /// 配布元の設定の書き方から作る。誤りは日本語の文で返す（ビルドのときに止めるため。鍵そのものは文に入れない）
    pub fn from_config(cfg: &KeyConfig) -> Result<KeyRing, String> {
        let mut keys = Vec::new();
        for (role, list) in [
            (Role::AppUpdate, cfg.app_update),
            (Role::Data, cfg.data),
            (Role::AutoDelivery, cfg.auto_delivery),
            (Role::Revocation, cfg.revocation),
        ] {
            if list.len() > MAX_PER_ROLE {
                return Err(format!(
                    "[keys] の {} は現用と次期の {MAX_PER_ROLE} 本までです",
                    role.name()
                ));
            }
            for (i, line) in list.iter().enumerate() {
                let key = if role == Role::AppUpdate {
                    let k = MinisignPublicKey::from_tauri(line).ok_or_else(|| {
                        format!(
                            "[keys] の app_update の {} 本目が Tauri の公開鍵の形ではありません",
                            i + 1
                        )
                    })?;
                    TrustedKey {
                        kid: k.kid(),
                        role,
                        material: KeyMaterial::Minisign(k),
                    }
                } else {
                    let bad = || {
                        format!(
                            "[keys] の {} の {} 本目は「鍵の名前:公開鍵（base64url の43文字）」の形にしてください",
                            role.name(),
                            i + 1
                        )
                    };
                    let (kid, b64) = line.trim().split_once(':').ok_or_else(bad)?;
                    if !valid_kid(kid) {
                        return Err(bad());
                    }
                    let bytes: [u8; 32] = B64URL
                        .decode(b64)
                        .map_err(|_| bad())?
                        .try_into()
                        .map_err(|_| bad())?;
                    TrustedKey {
                        kid: kid.to_owned(),
                        role,
                        material: KeyMaterial::Ed25519(
                            VerifyingKey::from_bytes(&bytes).map_err(|_| bad())?,
                        ),
                    }
                };
                if keys.iter().any(|k: &TrustedKey| k.kid == key.kid) {
                    return Err(format!("[keys] の鍵の名前「{}」が重なっています", key.kid));
                }
                if keys.iter().any(|k| k.key_bytes() == key.key_bytes()) {
                    return Err(format!(
                        "[keys] の {} の {} 本目と同じ公開鍵が、ほかの欄にもあります（役割ごとに別の鍵にする）",
                        role.name(),
                        i + 1
                    ));
                }
                keys.push(key);
            }
        }
        Ok(KeyRing { keys })
    }

    /// その役割の鍵（現用・次期）
    pub fn for_role(&self, role: Role) -> impl Iterator<Item = &TrustedKey> {
        self.keys.iter().filter(move |k| k.role == role)
    }

    /// 役割と鍵の名前で探す（役割が違えば見つからない）
    pub fn get(&self, role: Role, kid: &str) -> Option<&TrustedKey> {
        self.keys.iter().find(|k| k.role == role && k.kid == kid)
    }

    /// 束が空か（鍵を入れる前の、開発用の設定）
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// 取り下げの一覧に載った鍵の名前を外した束（取り下げ用の鍵は外さない）
    pub fn without(&self, revoked: &[String]) -> KeyRing {
        KeyRing {
            keys: self
                .keys
                .iter()
                .filter(|k| k.role == Role::Revocation || !revoked.contains(&k.kid))
                .cloned()
                .collect(),
        }
    }
}
