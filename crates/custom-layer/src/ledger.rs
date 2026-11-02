//! 承認の台帳と、承認した中身の保存庫（0016 の3・6）。どちらもカスタム層の外（データフォルダの中の `custom/`）に置く。
//!
//! ```text
//! custom/ledger.json            承認の台帳: { "body": "<中身の JSON の文字列>", "mac": "<HMAC-SHA256 の16進>" }
//! custom/approved/<種類>-<16進>.json  承認した中身（名前は中身の SHA-256。読むときに指紋を確かめる。古い版も消さない）
//! ```
//!
//! - 台帳の改ざん検出は、事務所の親鍵から導いた鍵（`lifeplan/custom-ledger/v1`。household-store）による HMAC-SHA256。
//!   本文の文字列のバイト列そのものに付ける（読み直した形ではなく、書いたバイト列で比べる）。
//! - 合わない（書き換えられた・別の鍵）・読めないときは、台帳を無いものとして読み（承認は全部無効）、そのことを返す。
//!   事務所の鍵を入れ替えたとき（0024）も合わなくなるので、承認し直してもらう。

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::{fingerprint, hex, Kind};

pub const LEDGER_FILE: &str = "ledger.json";
pub const APPROVED_DIR: &str = "approved";
const LEDGER_FORMAT: &str = "lifeplan.custom-ledger";
const LEDGER_VERSION: &str = "1.0";

/// 1種類の設定の承認
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    /// 承認した中身の指紋（`sha256:…`）
    pub fingerprint: String,
    /// 承認した時（1970-01-01 からの秒。UTC）
    pub approved_at: i64,
    /// 承認したときの公式の文（行の `basedOn` が今の一覧と合った行だけ。更新の確かめの画面で「前の公式の文」に出す）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub official: BTreeMap<String, String>,
}

/// 台帳の中身
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerBody {
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub format_version: String,
    /// FP が選んだカスタム層の場所（無ければ既定の場所）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_dir: Option<String>,
    /// 説明の文の設定（`settings/texts.json`）の承認
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texts: Option<Approval>,
    /// 承認しないと決めた説明の文の設定の指紋（同じ中身のあいだは承認待ちに出さない）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texts_declined: Option<String>,
    /// 名前の差し替えの設定（`settings/terms.json`）の承認
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<Approval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms_declined: Option<String>,
    /// 欄の隠す・並べ替えの設定（`settings/fields.json`）の承認
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Approval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields_declined: Option<String>,
}

impl LedgerBody {
    /// その種類の承認
    pub fn approval(&self, k: Kind) -> Option<&Approval> {
        match k {
            Kind::Texts => self.texts.as_ref(),
            Kind::Terms => self.terms.as_ref(),
            Kind::Fields => self.fields.as_ref(),
        }
    }

    pub fn approval_mut(&mut self, k: Kind) -> &mut Option<Approval> {
        match k {
            Kind::Texts => &mut self.texts,
            Kind::Terms => &mut self.terms,
            Kind::Fields => &mut self.fields,
        }
    }

    /// その種類の、承認しないと決めた中身の指紋
    pub fn declined(&self, k: Kind) -> Option<&str> {
        match k {
            Kind::Texts => self.texts_declined.as_deref(),
            Kind::Terms => self.terms_declined.as_deref(),
            Kind::Fields => self.fields_declined.as_deref(),
        }
    }

    pub fn declined_mut(&mut self, k: Kind) -> &mut Option<String> {
        match k {
            Kind::Texts => &mut self.texts_declined,
            Kind::Terms => &mut self.terms_declined,
            Kind::Fields => &mut self.fields_declined,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct LedgerFile {
    body: String,
    mac: String,
}

/// 読んだ台帳
#[derive(Debug, Clone, Default)]
pub struct Loaded {
    pub body: LedgerBody,
    /// 台帳があったのに確かめられなかった（書き換えられた・別の鍵・壊れた）。承認は全部無効として読んだ
    pub reset: bool,
}

type HmacSha256 = Hmac<Sha256>;

fn mac_of(key: &[u8; 32], body: &[u8]) -> String {
    let mut m = HmacSha256::new_from_slice(key).expect("HMAC の鍵");
    m.update(b"lifeplan.custom-ledger\0");
    m.update(body);
    hex(&m.finalize().into_bytes())
}

fn mac_ok(key: &[u8; 32], body: &[u8], mac_hex: &str) -> bool {
    let Some(tag) = crate::unhex(mac_hex) else {
        return false;
    };
    let mut m = HmacSha256::new_from_slice(key).expect("HMAC の鍵");
    m.update(b"lifeplan.custom-ledger\0");
    m.update(body);
    m.verify_slice(&tag).is_ok()
}

/// 台帳と保存庫の置き場所（データフォルダの中の `custom/`）
#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Store {
        Store { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn ledger_path(&self) -> PathBuf {
        self.dir.join(LEDGER_FILE)
    }

    /// 台帳を読む（無ければ空。確かめられなければ空として読み、reset を立てる）
    pub fn load(&self, key: &[u8; 32]) -> Loaded {
        let Ok(bytes) = fs::read(self.ledger_path()) else {
            return Loaded::default();
        };
        let parsed: Option<LedgerBody> = serde_json::from_slice::<LedgerFile>(&bytes)
            .ok()
            .filter(|f| mac_ok(key, f.body.as_bytes(), &f.mac))
            .and_then(|f| serde_json::from_str(&f.body).ok())
            .filter(|b: &LedgerBody| b.format == LEDGER_FORMAT);
        match parsed {
            Some(body) => Loaded { body, reset: false },
            None => Loaded {
                body: LedgerBody::default(),
                reset: true,
            },
        }
    }

    /// 台帳を書く（同じフォルダの一時ファイルに書いてから名前を変える）
    pub fn save(&self, key: &[u8; 32], body: &LedgerBody) -> io::Result<()> {
        let mut b = body.clone();
        b.format = LEDGER_FORMAT.into();
        b.format_version = LEDGER_VERSION.into();
        let text = serde_json::to_string(&b).expect("台帳の書き出し");
        let file = LedgerFile {
            mac: mac_of(key, text.as_bytes()),
            body: text,
        };
        fs::create_dir_all(&self.dir)?;
        write_atomically(
            &self.ledger_path(),
            &serde_json::to_vec_pretty(&file).expect("台帳の書き出し"),
        )
    }

    fn approved_path(&self, kind: &str, fp: &str) -> Option<PathBuf> {
        let h = fp.strip_prefix("sha256:")?;
        (h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| self.dir.join(APPROVED_DIR).join(format!("{kind}-{h}.json")))
    }

    /// 承認した中身を保存庫に置く（同じ指紋の物が既にあれば書かない）
    pub fn put_approved(&self, kind: &str, bytes: &[u8]) -> io::Result<String> {
        let fp = fingerprint(bytes);
        let p = self.approved_path(kind, &fp).expect("指紋の形");
        if self.get_approved(kind, &fp).is_some() {
            return Ok(fp);
        }
        fs::create_dir_all(p.parent().expect("保存庫のフォルダ"))?;
        write_atomically(&p, bytes)?;
        Ok(fp)
    }

    /// 承認した中身を保存庫から読む（指紋が合わなければ無し）
    pub fn get_approved(&self, kind: &str, fp: &str) -> Option<Vec<u8>> {
        let p = self.approved_path(kind, fp)?;
        let b = fs::read(p).ok()?;
        (fingerprint(&b) == fp).then_some(b)
    }
}

/// 同じフォルダの一時ファイルに書いてから名前を変える（途中で止まっても、半端なファイルを残さない）
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".part");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}
