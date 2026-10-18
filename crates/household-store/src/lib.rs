//! 世帯ファイルの保存と暗号化（0011・0013）。
//!
//! - 1世帯＝1ファイル。ファイルは「識別の印＋封筒の見出し（平文の JSON）＋暗号文」（0011 の1）。暗号は AES-256-GCM で、
//!   見出しを含む暗号文の前のバイト列すべてを改ざん検出の対象（付加データ）にする（0013 の1）。
//! - 鍵は3段（0013 の2）: OS の資格情報の保管庫の事務所の親鍵 → 鍵置き場（親鍵から導いた鍵で暗号化）の世帯ごとの鍵 → 世帯ファイル。
//!   保管庫は [`SecretStore`] で差し替えられる（テストはメモリの実装を使う）。
//! - 復元キーは親鍵そのものを書き写せる形にしたもの（0013 の3。[`recovery`]）。
//! - 保存は一時ファイルに書いてディスクへ同期してから差し替え、直前の世代を1つ残す（0011 の7。[`atomic`]）。
//! - 形式の版と一方向の移行（0011 の5。[`migrate`]）。
//! - 世帯の一覧・作成・開く・保存・顧客番号の変更・完全削除・自動バックアップは [`Store`]。
//!
//! この部品はファイルの道（パス）を外に返さない。呼ぶ側（アプリ本体）は世帯の内部IDだけでやりとりする（0016 の1）。
//! 世帯の値・鍵をログやエラーの文に入れない（0012 の4）。エラーは符号（`E_STORE_…`）だけ。

pub mod atomic;
pub mod container;
pub mod crypto;
pub mod migrate;
pub mod recovery;
pub mod secret;
mod store;
pub mod vault;

pub use secret::{MemorySecretStore, SecretStore};
pub use store::{
    Clock, CreateRequest, HouseholdEntry, Opened, RenameOutcome, Saved, Status, StatusState, Store,
    SystemClock,
};

#[cfg(feature = "os-keyring")]
pub use secret::OsSecretStore;

/// 世帯ファイルの形式名（0011 の1。製品名に依存しない名前）
pub const HOUSEHOLD_FORMAT: &str = "lifeplan.household";
/// 世帯ファイルの識別の印
pub const HOUSEHOLD_MAGIC: &[u8; 4] = b"LPHF";
/// 世帯ファイルの拡張子（0011 の未確定「ファイルの拡張子」。製品名に依存しない仮の名前）
pub const HOUSEHOLD_EXT: &str = "lphf";

/// 失敗の符号。画面にはこの符号だけを返す（世帯の値・パスを含めない）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreError(pub &'static str);

impl StoreError {
    pub fn code(&self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(_: std::io::Error) -> Self {
        StoreError::IO
    }
}

impl StoreError {
    /// ファイルの読み書きに失敗した
    pub const IO: StoreError = StoreError("E_STORE_IO");
    /// 開けない（改ざん・壊れ・別の鍵）。どれかは区別しない
    pub const CORRUPT: StoreError = StoreError("E_STORE_CORRUPT");
    /// 鍵置き場が、保管庫の親鍵と違う親鍵で暗号化されている（確かめ値で区別。0013 の2）
    pub const WRONG_MASTER: StoreError = StoreError("E_STORE_WRONG_MASTER");
    /// 鍵置き場にこの世帯の鍵が無い（完全削除した世帯など）
    pub const NO_KEY: StoreError = StoreError("E_STORE_NO_KEY");
    pub const UNKNOWN_HOUSEHOLD: StoreError = StoreError("E_STORE_UNKNOWN_HOUSEHOLD");
    /// MAJOR が新しい形式（0011 の5: 開かない。アプリの更新を案内する）
    pub const FORMAT_TOO_NEW: StoreError = StoreError("E_STORE_FORMAT_TOO_NEW");
    /// 知らない形式の版（変換の段が無い）
    pub const FORMAT_UNKNOWN: StoreError = StoreError("E_STORE_FORMAT_UNKNOWN");
    /// MINOR だけが新しい形式は閲覧だけ（0011 の5: 保存させない）
    pub const READ_ONLY: StoreError = StoreError("E_STORE_READ_ONLY");
    /// 開いた後に、別の保存が先にあった（0011 の7 の分岐の検出）。こちらの内容は別のファイルに残した
    pub const CONFLICT: StoreError = StoreError("E_STORE_CONFLICT");
    pub const NOT_OPEN: StoreError = StoreError("E_STORE_NOT_OPEN");
    /// 保管庫に親鍵が無い（または鍵置き場と合わない）。復元キーが要る
    pub const NEEDS_RECOVERY: StoreError = StoreError("E_STORE_NEEDS_RECOVERY");
    /// OS の資格情報の保管庫を使えなかった
    pub const KEYCHAIN: StoreError = StoreError("E_STORE_KEYCHAIN");
    /// 本文が JSON のオブジェクトでない・大きすぎる
    pub const BODY: StoreError = StoreError("E_STORE_BODY");
    /// 表示用の顧客番号の書式が違う
    pub const CUSTOMER_NO: StoreError = StoreError("E_STORE_CUSTOMER_NO");
    /// 完全削除の確認（顧客番号の入力）が合わない
    pub const CONFIRM: StoreError = StoreError("E_STORE_CONFIRM");
    /// 復元キーの打ち間違い（確かめ用の4バイトが合わない・文字数が違う・使えない文字）
    pub const RECOVERY_TYPO: StoreError = StoreError("E_RECOVERY_TYPO");
    /// 復元キーは正しい形だが、この事務所の鍵置き場を開けない
    pub const RECOVERY_MISMATCH: StoreError = StoreError("E_RECOVERY_MISMATCH");
}
