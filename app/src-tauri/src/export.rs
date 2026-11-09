//! 平文の書き出しの出口（0020 の5・6）。提案書の PDF・ヒアリングシート（.xlsx）・明細の確認シート（.xlsx。0034）・
//! 持ち帰り用のレポート（.html。0030）は、
//! すべてここを通してファイルに書く。
//!
//! - 画面（WebView）はファイルを書けない（0016 の1。ファイル・ダイアログのプラグインの権限は画面に与えない）。画面は
//!   「この PDF を保存する」「このシートを保存する」の用途ごとの命令を呼び、保存先は本体が OS の保存のダイアログで FP に選ばせる。
//!   画面からパスは受け取らない。
//! - 既定の保存先は、書類のフォルダの中の「ファイナンシア書き出し」。データフォルダ・カスタム層（SDK フォルダを含む）の中には
//!   保存しない。同期フォルダ（OS のクラウドのストレージの場所）の中なら、保存はして画面に知らせる。
//! - 書き出しの記録（種類・日時・ファイルの指紋・同期フォルダかどうか）を残す。保存先のパスそのものは持たない。
//!   世帯ファイル（0011）ができるまでは、アプリを開いている間だけの記録。
//! - 開発のときだけ（debug のビルド）: 環境変数 FINANCIA_DEV_SAVE_DIR があれば、ダイアログを出さずにそのフォルダへ書く
//!   （画面の確かめを自動で流すため。本番のビルドには入らない）。

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// 平文の書き出しの既定のフォルダの名前（書類のフォルダの中。0020 の6）
pub const EXPORT_DIR_NAME: &str = "ファイナンシア書き出し";
/// カスタム層の既定の場所（書類のフォルダの中。0016 の3）
pub const CUSTOM_DIR_NAME: &str = "lifeplan-custom";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportKind {
    Proposal,
    HearingSheet,
    /// 前回の値を記入したヒアリングシート（0018 の9。画面で毎回警告してから）
    HearingSheetPrefilled,
    /// 持ち帰り用のレポート（0030。パスワードを付けたときは中身が暗号化されている。記録にはその有無だけ）
    Takeaway,
    /// 明細の確認シート（0034 の9。迷う行の店の名前・金額が載る。画面で毎回警告してから）
    StatementSheet,
    /// Web のヒアリングで受け取った書類（0125。写真・PDF。世帯ファイルの外に平文で書く）
    HearingDocument,
}

impl ExportKind {
    fn filter(self) -> (&'static str, &'static [&'static str]) {
        match self {
            ExportKind::Proposal => ("PDF", &["pdf"]),
            ExportKind::Takeaway => ("ブラウザで開くファイル（.html）", &["html"]),
            ExportKind::HearingDocument => ("書類（写真・PDF）", &["jpg", "png", "heic", "pdf"]),
            _ => ("表計算のブック（.xlsx）", &["xlsx"]),
        }
    }
}

/// 書き出しの記録（保存先のパスは持たない。0020 の5）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecord {
    pub kind: ExportKind,
    /// 1970-01-01 からの秒（UTC）
    pub at: u64,
    pub digest: String,
    pub sync_folder: bool,
    /// 開くときのパスワードを付けたか（持ち帰り用のレポートだけ。パスワードそのものは持たない）
    pub password: bool,
}

#[derive(Default)]
pub struct ExportLog(pub Mutex<Vec<ExportRecord>>);

/// 画面に返す結果（保存しなかったときは saved: false）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub saved: bool,
    /// 保存したファイルの名前（フォルダは返さない）
    pub file_name: Option<String>,
    pub sync_folder: bool,
    pub digest: Option<String>,
}

impl SaveOutcome {
    fn cancelled() -> SaveOutcome {
        SaveOutcome {
            saved: false,
            file_name: None,
            sync_folder: false,
            digest: None,
        }
    }
}

/// 保存してはいけない場所（データフォルダ・カスタム層）
#[derive(Debug, Clone, Default)]
pub struct Forbidden {
    pub roots: Vec<PathBuf>,
}

/// パスを比べられる形にする（. と .. を解き、あれば実在のパスにする）
fn normalized(p: &Path) -> PathBuf {
    if let Ok(c) = p.canonicalize() {
        return c;
    }
    // まだ無いファイル: 親のフォルダを実在のパスにして、名前を足す
    if let (Some(parent), Some(name)) = (p.parent(), p.file_name()) {
        if let Ok(c) = parent.canonicalize() {
            return c.join(name);
        }
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

impl Forbidden {
    /// 保存してはいけない場所の中なら、その理由
    pub fn reason(&self, target: &Path) -> Option<&'static str> {
        let t = normalized(target);
        self.roots
            .iter()
            .any(|r| t.starts_with(normalized(r)))
            .then_some("E_EXPORT_FORBIDDEN_DIR")
    }
}

/// 同期フォルダの中か（0020 の6。止めずに知らせる）。いまは Mac の OS が同期のサービスに用意する場所
/// （~/Library/CloudStorage/ と ~/Library/Mobile Documents/）だけを見る。Windows での見分け方は 0020 の未確定のまま
pub fn is_sync_folder(p: &Path) -> bool {
    let s = p.to_string_lossy().replace('\\', "/");
    s.contains("/Library/Mobile Documents/") || s.contains("/Library/CloudStorage/")
}

/// 既定の名前に使える文字だけか（画面から来る顧客番号・日付を、パスとして解釈させない）
pub fn safe_name_part(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.chars().count() <= max
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

pub fn forbidden_of<R: Runtime>(app: &AppHandle<R>) -> Forbidden {
    let p = app.path();
    let mut roots: Vec<PathBuf> = [p.app_data_dir(), p.app_local_data_dir(), p.app_config_dir()]
        .into_iter()
        .flatten()
        .collect();
    if let Ok(docs) = p.document_dir() {
        roots.push(docs.join(CUSTOM_DIR_NAME));
    }
    // FP が選んだカスタム層の場所（0016 の追記 2026-11-02。既定の場所でなくても避ける）
    if let Some(c) = app.try_state::<crate::custom::CustomState>() {
        roots.push(c.current_dir());
    }
    Forbidden { roots }
}

fn default_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().document_dir().ok()?.join(EXPORT_DIR_NAME);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// 開発のときだけ: ダイアログの代わりに使う保存先のフォルダ
fn dev_save_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("FINANCIA_DEV_SAVE_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// 同じフォルダの一時ファイルに書いてから名前を変える（途中で止まっても、半端なファイルを残さない）。
/// 書く・名前を変えるのどちらかに失敗したら、一時ファイル（平文の書きかけ）を消す
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".part");
    let tmp = PathBuf::from(tmp);
    let r = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path));
    if r.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    r
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 保存先を決めて（OS の保存のダイアログ）、確かめて、書いて、記録する
pub async fn save<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    kind: ExportKind,
    default_name: &str,
    bytes: &[u8],
) -> Result<SaveOutcome, String> {
    save_with(app, window, kind, default_name, bytes, false).await
}

/// save と同じ。password は記録に残す「開くときのパスワードを付けたか」（持ち帰り用のレポート）
pub async fn save_with<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    kind: ExportKind,
    default_name: &str,
    bytes: &[u8],
    password: bool,
) -> Result<SaveOutcome, String> {
    let target = match dev_save_dir() {
        Some(dir) => dir.join(default_name),
        None => {
            let (label, ext) = kind.filter();
            let mut dialog = rfd::AsyncFileDialog::new()
                .set_title("保存する場所を選ぶ")
                .set_file_name(default_name)
                .add_filter(label, ext)
                .set_parent(window);
            if let Some(dir) = default_dir(app) {
                dialog = dialog.set_directory(dir);
            }
            match dialog.save_file().await {
                Some(h) => h.path().to_path_buf(),
                None => return Ok(SaveOutcome::cancelled()),
            }
        }
    };
    write_checked(app, kind, &target, bytes, password)
}

/// まとめて保存する先のフォルダ（FP が OS のダイアログで選んだもの。0191）。パスは画面に返さず、アプリを開いている間だけ覚える
#[derive(Default)]
pub struct ChosenFolder(pub Mutex<Option<PathBuf>>);

/// フォルダを選ぶ結果（パスは返さない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPick {
    pub picked: bool,
    pub sync_folder: bool,
}

/// まとめて保存するフォルダを、OS のフォルダのダイアログで FP に選ばせて覚える（保存してはいけない場所は断る）。
/// 開発のときだけ: 環境変数 FINANCIA_DEV_SAVE_DIR があれば、ダイアログを出さずにそのフォルダにする
pub async fn pick_folder<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    title: &str,
) -> Result<FolderPick, String> {
    let dir = match dev_save_dir() {
        Some(d) => d,
        None => {
            let mut dialog = rfd::AsyncFileDialog::new()
                .set_title(title)
                .set_parent(window);
            if let Some(d) = default_dir(app) {
                dialog = dialog.set_directory(d);
            }
            match dialog.pick_folder().await {
                Some(h) => h.path().to_path_buf(),
                None => {
                    return Ok(FolderPick {
                        picked: false,
                        sync_folder: false,
                    })
                }
            }
        }
    };
    if let Some(code) = forbidden_of(app).reason(&dir.join("x")) {
        return Err(code.to_owned());
    }
    let sync_folder = is_sync_folder(&dir);
    if let Some(c) = app.try_state::<ChosenFolder>() {
        if let Ok(mut g) = c.0.lock() {
            *g = Some(dir);
        }
    }
    Ok(FolderPick {
        picked: true,
        sync_folder,
    })
}

/// 選んだフォルダの中の、書いてよい名前（同じ名前で同じ中身のファイルがあれば Ok(None)〔書かない〕、中身が違えば番号を足す）
pub fn unique_target(dir: &Path, name: &str, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((a, e)) if !a.is_empty() => (a.to_owned(), format!(".{e}")),
        _ => (name.to_owned(), String::new()),
    };
    for n in 1..100 {
        let candidate = if n == 1 {
            name.to_owned()
        } else {
            format!("{stem}_{n}{ext}")
        };
        let path = dir.join(&candidate);
        match std::fs::read(&path) {
            Ok(existing) if existing == bytes => return Ok(None),
            Ok(_) => continue,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Some(path)),
            Err(_) => continue,
        }
    }
    Err("E_EXPORT_NAME".to_owned())
}

/// 選んだフォルダに1つ書く（pick_folder の後。上書きしない。同じ中身ならそのまま）
pub fn save_into<R: Runtime>(
    app: &AppHandle<R>,
    kind: ExportKind,
    name: &str,
    bytes: &[u8],
) -> Result<SaveOutcome, String> {
    let dir = app
        .try_state::<ChosenFolder>()
        .and_then(|c| c.0.lock().ok().and_then(|g| g.clone()))
        .ok_or_else(|| "E_EXPORT_NO_FOLDER".to_owned())?;
    match unique_target(&dir, name, bytes)? {
        Some(target) => write_checked(app, kind, &target, bytes, false),
        None => Ok(SaveOutcome {
            saved: true,
            file_name: Some(name.to_owned()),
            sync_folder: is_sync_folder(&dir),
            digest: Some(format!("sha256:{:x}", Sha256::digest(bytes))),
        }),
    }
}

fn write_checked<R: Runtime>(
    app: &AppHandle<R>,
    kind: ExportKind,
    target: &Path,
    bytes: &[u8],
    password: bool,
) -> Result<SaveOutcome, String> {
    if let Some(code) = forbidden_of(app).reason(target) {
        return Err(code.to_owned());
    }
    write_atomically(target, bytes).map_err(|_| "E_EXPORT_WRITE".to_owned())?;
    let digest = format!("sha256:{:x}", Sha256::digest(bytes));
    let sync_folder = is_sync_folder(target);
    if let Some(log) = app.try_state::<ExportLog>() {
        if let Ok(mut l) = log.0.lock() {
            l.push(ExportRecord {
                kind,
                at: now_secs(),
                digest: digest.clone(),
                sync_folder,
                password,
            });
        }
    }
    Ok(SaveOutcome {
        saved: true,
        file_name: target.file_name().map(|n| n.to_string_lossy().into_owned()),
        sync_folder,
        digest: Some(digest),
    })
}

/// 開く（ヒアリングシートの取り込み）: OS の開くダイアログで FP にファイルを選ばせ、中身を返す。大きすぎるものは読まない。
/// 開発のときだけ: 環境変数 FINANCIA_DEV_OPEN_FILE があれば、ダイアログを出さずにそのファイルを読む
pub async fn open_sheet<R: Runtime>(
    window: &WebviewWindow<R>,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    open_book(
        window,
        max_bytes,
        "記入済みのヒアリングシートを選ぶ",
        "FINANCIA_DEV_OPEN_FILE",
    )
    .await
}

/// 開く（明細の確認シートの取り込み。0034 の9）。開発のときだけ: 環境変数 FINANCIA_DEV_OPEN_STATEMENT_SHEET のファイルを読む
pub async fn open_statement_sheet<R: Runtime>(
    window: &WebviewWindow<R>,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    open_book(
        window,
        max_bytes,
        "お客さまが印を付けた確認シートを選ぶ",
        "FINANCIA_DEV_OPEN_STATEMENT_SHEET",
    )
    .await
}

/// 表計算のブックを選んで中身を返す（パス・ファイル名は返さない）
async fn open_book<R: Runtime>(
    window: &WebviewWindow<R>,
    max_bytes: u64,
    title: &str,
    dev_env: &str,
) -> Result<Option<Vec<u8>>, String> {
    let dev = if cfg!(debug_assertions) {
        std::env::var_os(dev_env)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    } else {
        None
    };
    let path = match dev {
        Some(p) => p,
        None => {
            // .xls・.ods なども選べるようにして、読む側で「.xlsx で保存し直してください」と案内する（0018 の6）
            let picked = rfd::AsyncFileDialog::new()
                .set_title(title)
                .add_filter(
                    "表計算のブック（.xlsx）",
                    &["xlsx", "xlsm", "xls", "ods", "numbers"],
                )
                .set_parent(window)
                .pick_file()
                .await;
            match picked {
                Some(h) => h.path().to_path_buf(),
                None => return Ok(None),
            }
        }
    };
    read_limited(&path, max_bytes).map(Some)
}

/// 明細のファイル（CSV・TSV・文字の入った PDF。0034）を選んで中身を返す。選ばなかったときは None。
/// パス・ファイル名は返さない。開発用のビルドだけ、環境変数 `FINANCIA_DEV_OPEN_STATEMENT` のファイルをダイアログの代わりに読む
pub async fn open_statement<R: Runtime>(
    window: &WebviewWindow<R>,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    let dev = if cfg!(debug_assertions) {
        std::env::var_os("FINANCIA_DEV_OPEN_STATEMENT")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    } else {
        None
    };
    let path = match dev {
        Some(p) => p,
        None => {
            let picked = rfd::AsyncFileDialog::new()
                .set_title("明細のファイルを選ぶ（CSV・PDF）")
                .add_filter("明細（CSV・TSV・PDF）", &["csv", "tsv", "txt", "pdf"])
                .set_parent(window)
                .pick_file()
                .await;
            match picked {
                Some(h) => h.path().to_path_buf(),
                None => return Ok(None),
            }
        }
    };
    read_limited(&path, max_bytes).map(Some)
}

/// 事務所のロゴの画像（PNG・JPEG。0121）を選んで中身を返す。選ばなかったときは None。パス・ファイル名は返さない。
/// 開発用のビルドだけ、環境変数 `FINANCIA_DEV_OPEN_LOGO` のファイルをダイアログの代わりに読む
pub async fn open_logo<R: Runtime>(
    window: &WebviewWindow<R>,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    let dev = if cfg!(debug_assertions) {
        std::env::var_os("FINANCIA_DEV_OPEN_LOGO")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    } else {
        None
    };
    let path = match dev {
        Some(p) => p,
        None => {
            let picked = rfd::AsyncFileDialog::new()
                .set_title("事務所のロゴの画像を選ぶ（PNG・JPEG）")
                .add_filter("画像（PNG・JPEG）", &["png", "jpg", "jpeg"])
                .set_parent(window)
                .pick_file()
                .await;
            match picked {
                Some(h) => h.path().to_path_buf(),
                None => return Ok(None),
            }
        }
    };
    read_limited(&path, max_bytes).map(Some)
}

fn read_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|_| "E_IMPORT_READ".to_owned())?;
    if !meta.is_file() {
        return Err("E_IMPORT_READ".to_owned());
    }
    if meta.len() > max_bytes {
        return Err("E_IMPORT_TOO_LARGE".to_owned());
    }
    std::fs::read(path).map_err(|_| "E_IMPORT_READ".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_into_a_folder_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("financia-export-into-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = "A0042_源泉徴収票_ご本人_20261108.jpg";
        // まだ無い名前はそのまま
        assert_eq!(
            unique_target(&dir, name, b"one").unwrap(),
            Some(dir.join(name))
        );
        std::fs::write(dir.join(name), b"one").unwrap();
        // 同じ中身ならもう書かない
        assert_eq!(unique_target(&dir, name, b"one").unwrap(), None);
        // 中身が違えば番号を足す（上書きしない）
        assert_eq!(
            unique_target(&dir, name, b"two").unwrap(),
            Some(dir.join("A0042_源泉徴収票_ご本人_20261108_2.jpg"))
        );
        std::fs::write(dir.join("A0042_源泉徴収票_ご本人_20261108_2.jpg"), b"two").unwrap();
        assert_eq!(unique_target(&dir, name, b"two").unwrap(), None);
        assert_eq!(
            unique_target(&dir, name, b"three").unwrap(),
            Some(dir.join("A0042_源泉徴収票_ご本人_20261108_3.jpg"))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forbidden_dirs_stop_the_export() {
        let base =
            std::env::temp_dir().join(format!("financia-export-test-{}", std::process::id()));
        let data = base.join("data");
        let custom = base.join("Documents").join(CUSTOM_DIR_NAME);
        std::fs::create_dir_all(data.join("sub")).unwrap();
        std::fs::create_dir_all(custom.join("sdk")).unwrap();
        let f = Forbidden {
            roots: vec![data.clone(), custom.clone()],
        };
        assert!(f.reason(&data.join("a.pdf")).is_some());
        assert!(f.reason(&data.join("sub").join("a.pdf")).is_some());
        assert!(
            f.reason(&custom.join("sdk").join("a.xlsx")).is_some(),
            "SDK フォルダはカスタム層の中"
        );
        assert!(
            f.reason(&custom.join("..").join(CUSTOM_DIR_NAME).join("b.pdf"))
                .is_some(),
            "..で回り込んでも止まる"
        );
        assert!(f
            .reason(&base.join("Documents").join(EXPORT_DIR_NAME).join("a.pdf"))
            .is_none());
        assert!(
            f.reason(&base.join("datafile.pdf")).is_none(),
            "名前が前方一致するだけのファイルは止めない"
        );
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn sync_folders_are_noticed() {
        assert!(is_sync_folder(Path::new(
            "/Users/a/Library/CloudStorage/Service-個人用/a.pdf"
        )));
        assert!(is_sync_folder(Path::new(
            "/Users/a/Library/Mobile Documents/com~apple~CloudDocs/a.pdf"
        )));
        assert!(!is_sync_folder(Path::new(
            "/Users/a/Documents/ファイナンシア書き出し/a.pdf"
        )));
        assert!(!is_sync_folder(Path::new(
            "/Users/a/Library/CloudStorageX/a.pdf"
        )));
    }

    #[test]
    fn name_parts_cannot_be_paths() {
        assert!(safe_name_part("A0042", 16));
        assert!(!safe_name_part("../x", 16));
        assert!(!safe_name_part("a/b", 16));
        assert!(!safe_name_part("", 16));
        assert!(
            !safe_name_part("山田", 16),
            "名前らしい文字は既定の名前に入れない"
        );
        assert!(is_date("2026-10-18"));
        assert!(!is_date("2026/10/18"));
        assert!(!is_date("2026-10-1x"));
    }

    #[test]
    fn writes_atomically_and_reads_with_a_limit() {
        let dir = std::env::temp_dir().join(format!("financia-write-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.xlsx");
        write_atomically(&p, b"PK\x03\x04abc").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"PK\x03\x04abc");
        assert!(!dir.join("a.xlsx.part").exists());
        assert_eq!(read_limited(&p, 100).unwrap().len(), 7);
        assert_eq!(read_limited(&p, 3).unwrap_err(), "E_IMPORT_TOO_LARGE");
        assert_eq!(read_limited(&dir, 100).unwrap_err(), "E_IMPORT_READ");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 差し替えに失敗したら、平文の書きかけ（`.part`）を保存先に残さない（0020「平文の出口は1つ」）
    #[test]
    fn a_failed_write_leaves_no_plaintext_part_file() {
        let dir = std::env::temp_dir().join(format!("financia-export-part-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 同じ名前のフォルダがあると名前の変更が失敗する（Windows では、ほかのアプリが開いているファイルへの上書きも同じ）
        let target = dir.join("A0042_全データ.json");
        std::fs::create_dir_all(&target).unwrap();
        let r = write_atomically(&target, b"{\"household\":\"plain\"}");
        let part = dir.join("A0042_全データ.json.part");
        let left = part.exists();
        std::fs::remove_dir_all(&dir).ok();
        assert!(r.is_err());
        assert!(!left, "平文の .part が残る");
    }
}
