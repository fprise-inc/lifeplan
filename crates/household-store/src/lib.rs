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
//! - 顧客番号の区分と通し番号、見本の番号（0033）は [`numbering`]。
//! - 事務所での共有（0023。既定はオフ）: メンバーごとの X25519 の鍵の組で事務所の親鍵を包む名簿・世帯ごとの鍵の札と世帯の札・
//!   開いている印は [`office`]、鍵の組・親鍵の包み・指紋は [`member`]。共有フォルダの場所は [`Store`] が事務所データに持ち、外に返さない。
//! - 1人の FP が複数の PC で使う同期フォルダ（0024）: 事務所での共有と同じ仕組みに「メンバー＝PC」として乗せる（名簿の使い方の欄が
//!   `personal`）。保存先を同期フォルダにする・2台目の PC で復元キーで開く・この PC の中へ戻すは [`Store::sync_start`] など。
//!
//! この部品はファイルの道（パス）を外に返さない。呼ぶ側（アプリ本体）は世帯の内部IDだけでやりとりする（0016 の1）。
//! 世帯の値・鍵をログやエラーの文に入れない（0012 の4）。エラーは符号（`E_STORE_…`）だけ。

pub mod atomic;
pub mod container;
pub mod crypto;
pub mod member;
pub mod migrate;
pub mod numbering;
pub mod office;
pub mod recovery;
pub mod secret;
mod store;
pub mod vault;

pub use numbering::{Category, CategoryEdit, CategorySettings, Label, SampleInfo, SampleRequest};
pub use office::Author;
pub use secret::{MemorySecretStore, SecretStore};
pub use store::{
    Clock, CreateOptions, CreateRequest, ForkChoice, ForkInfo, HouseholdEntry, MemberView,
    NoticeView, OfficeStatus, Opened, PresenceView, RemovedView, RenameOutcome, RequestView, Saved,
    Status, StatusState, StorageNotice, Store, SystemClock,
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
    /// 区分の記号・名前の書式が違う、知らない区分（0033）
    pub const CATEGORY: StoreError = StoreError("E_STORE_CATEGORY");
    /// 世帯が使っている区分は消せない（0033）
    pub const CATEGORY_IN_USE: StoreError = StoreError("E_STORE_CATEGORY_IN_USE");
    /// 見本の指定が違う・見本にはできない操作・見本の番号の空きが無い（0033）
    pub const SAMPLE: StoreError = StoreError("E_STORE_SAMPLE");
    /// 完全削除の確認（顧客番号の入力）が合わない
    pub const CONFIRM: StoreError = StoreError("E_STORE_CONFIRM");
    /// 復元キーの打ち間違い（確かめ用の4バイトが合わない・文字数が違う・使えない文字）
    pub const RECOVERY_TYPO: StoreError = StoreError("E_RECOVERY_TYPO");
    /// 復元キーは正しい形だが、この事務所の鍵置き場を開けない
    pub const RECOVERY_MISMATCH: StoreError = StoreError("E_RECOVERY_MISMATCH");
    // ---- 事務所での共有（0023） ----
    /// 公開鍵が使えない（壊れた・小さい位数の点）
    pub const OFFICE_BAD_KEY: StoreError = StoreError("E_OFFICE_BAD_KEY");
    /// 入力した指紋が、申請の公開鍵の指紋と合わない
    pub const OFFICE_FINGERPRINT: StoreError = StoreError("E_OFFICE_FINGERPRINT");
    /// 名簿にこの PC の包みが無い（承認待ち）
    pub const OFFICE_NOT_MEMBER: StoreError = StoreError("E_OFFICE_NOT_MEMBER");
    /// この事務所の共有から外された
    pub const OFFICE_REMOVED: StoreError = StoreError("E_OFFICE_REMOVED");
    /// 名簿が、手元の親鍵から続くものでない（偽物の疑い）
    pub const OFFICE_FORGED: StoreError = StoreError("E_OFFICE_FORGED");
    /// 選んだフォルダに既に事務所がある（始めるのではなく参加する）
    pub const OFFICE_EXISTS: StoreError = StoreError("E_OFFICE_EXISTS");
    /// 選んだフォルダに事務所が無い（参加できない）
    pub const OFFICE_NOT_FOUND: StoreError = StoreError("E_OFFICE_NOT_FOUND");
    /// 選べない場所（データフォルダ・カスタム層・SDK・AIの作業フォルダの中、またはそれらを含む）
    pub const OFFICE_FOLDER: StoreError = StoreError("E_OFFICE_FOLDER");
    /// 共有フォルダが見つからない（外付けのドライブ・同期の停止など）
    pub const OFFICE_UNAVAILABLE: StoreError = StoreError("E_OFFICE_UNAVAILABLE");
    /// 表示名の形が違う（1〜20文字、制御文字なし）
    pub const OFFICE_NAME: StoreError = StoreError("E_OFFICE_NAME");
    /// 今の状態ではできない操作
    pub const OFFICE_STATE: StoreError = StoreError("E_OFFICE_STATE");
    /// 名簿がほかの PC で先に書き換えられた（もう一度）
    pub const OFFICE_BUSY: StoreError = StoreError("E_OFFICE_BUSY");
    /// 自分自身・最後の1人は外せない
    pub const OFFICE_SELF: StoreError = StoreError("E_OFFICE_SELF");
    /// 外す人の確認（表示名の入力）が合わない
    pub const OFFICE_CONFIRM: StoreError = StoreError("E_OFFICE_CONFIRM");
    /// この PC のメンバーの秘密鍵が保管庫に無い（参加し直す）
    pub const OFFICE_KEY_MISSING: StoreError = StoreError("E_OFFICE_KEY_MISSING");
    /// 事務所の復元キーがまだ保管されていない（保管するまで、承認・外すを止める。0023 の5）
    pub const OFFICE_RECOVERY_REQUIRED: StoreError = StoreError("E_OFFICE_RECOVERY_REQUIRED");
    /// この事務所の共有は終わっている（共有をやめた事務所には加われない）
    pub const OFFICE_CLOSED: StoreError = StoreError("E_OFFICE_CLOSED");
    /// ほかのメンバーがいる間は、共有をやめられない（先に外す。0023 の10）
    pub const OFFICE_OTHERS_REMAIN: StoreError = StoreError("E_OFFICE_OTHERS_REMAIN");
    /// 世帯の鍵の札がまだ同期されていない
    pub const OFFICE_WAITING_SYNC: StoreError = StoreError("E_OFFICE_WAITING_SYNC");
    /// 選ぶ分岐が無い
    pub const NO_FORK: StoreError = StoreError("E_STORE_NO_FORK");
    // ---- 1人の FP が複数の PC で使う同期フォルダ（0024） ----
    /// 保存先を同期フォルダにする前に、復元キーを保管する（2台目の PC で開くときに要る。0013 の3）
    pub const SYNC_RECOVERY_REQUIRED: StoreError = StoreError("E_SYNC_RECOVERY_REQUIRED");
    /// 選んだフォルダは事務所での共有（複数の FP）に使われている（「すでに使っている同期フォルダを開く」では開かない）
    pub const SYNC_IS_OFFICE: StoreError = StoreError("E_SYNC_IS_OFFICE");
    /// 1人で使う同期フォルダでは、参加の申請を承認しない
    pub const SYNC_PERSONAL: StoreError = StoreError("E_SYNC_PERSONAL");
    /// もう1台の PC で世帯を開いている間は、保存先をこの PC の中へ戻さない
    pub const SYNC_OTHER_PC_OPEN: StoreError = StoreError("E_SYNC_OTHER_PC_OPEN");
}
