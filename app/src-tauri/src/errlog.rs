//! エラーの記録（0234）。この PC のアプリのデータ（`errors/log.json`。開発用のビルドは `errors-dev/`）にだけ置き、どこにも送らない。
//!
//! - 残すのは、日時・アプリの版・OS・どの画面（タブ）のどの操作で・エラーの種類と文だけ。**世帯の中身（名前・金額・生年月日・メモ）・
//!   ファイルの場所（PC のユーザー名）・世帯を識別する値は残さない**。文は書く前にこの1か所（[`clean_message`]）で削る:
//!   日本語など ASCII の外の文字・引用符の中（短い英字の名前のほか）・ファイルの場所・メールの形・数字を含む語を伏せる
//! - 画面からは決まった種類（[`KINDS`]）と、画面・操作の決まった言葉と、エラーの文だけを受け取る。言葉も同じ決まりで削る
//! - 同じ画面・操作・種類・文・版のエラーは1件にまとめ、回数と最後の日時を進める（同じエラーが続いても件数を食わない）。
//!   件数の上限は [`MAX_ENTRIES`]。超えたら最後に起きたのが古いものから忘れる
//! - 本体が想定外に止まったとき（panic）も、ここに残す（[`install_panic_hook`]）。止まった所はファイルの名前と行だけ
//! - AI接続がオンでアプリが起動しているときだけ、AI接続の get_error_log が読める（ai.rs が台帳に読む所を入れる。読むだけ）。
//!   世帯の中身ではないので「AIに渡した記録」には残さず、AI が読んだ回数と最後の日時をこの記録の中に残して、画面に出す
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ai_share::clock::{iso8601, Clock, SystemClock};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

/// 形式の名前と版（この PC の中だけのファイル。世帯ファイル・事務所データの形式とは別）
const FORMAT: &str = "financia-error-log";
const FORMAT_VERSION: &str = "1.0";
/// 残すエラーの件数の上限（まとめた1件で1つ）
pub const MAX_ENTRIES: usize = 100;
/// エラーの文の長さの上限（削った後。超えたら切って … を付ける）
pub const MAX_MESSAGE_CHARS: usize = 300;
/// 画面・操作の言葉の長さの上限
const MAX_LABEL_CHARS: usize = 40;
/// 受け取る文の長さの上限（削る前に切る）
const MAX_INPUT_CHARS: usize = 4000;
/// 記録のファイルの大きさの上限（超えた・壊れたファイルは読まずに空から始める）
const MAX_FILE_BYTES: u64 = 512 * 1024;

/// エラーの種類（画面が送れるのは panic のほか）と、画面と AI に見せる名前
pub const KINDS: &[(&str, &str)] = &[
    ("screen", "画面のエラー"),
    ("command", "本体の命令の失敗"),
    ("calc", "計算できなかった"),
    ("panic", "本体の想定外の停止"),
];

pub fn kind_label(kind: &str) -> &'static str {
    KINDS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or("そのほか", |(_, l)| l)
}

/// 1件（同じエラーはまとめる）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// 最初に起きた日時（1970 年からのミリ秒）
    pub first_ms: u64,
    /// 最後に起きた日時
    pub last_ms: u64,
    /// 起きた回数
    pub count: u32,
    pub app_version: String,
    pub os: String,
    pub kind: String,
    /// 画面（タブの名前。本体は「本体」）
    pub place: String,
    /// 操作（命令の名前など）
    pub action: String,
    pub message: String,
    /// 本体が止まった所（panic だけ。ファイルの名前と行。例 ai.rs:120）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// AI接続が読んだ回数と最後の日時
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReads {
    pub count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_ms: Option<u64>,
}

/// 記録のファイルの中身
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    pub format: String,
    pub format_version: String,
    /// 最後に起きたのが新しい順
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub ai_reads: AiReads,
    /// 画面が最後に知らせた時差（分。UTC より進んでいれば正）。写す文と AI に渡す文の日時をこの PC の時刻にする
    #[serde(default)]
    pub utc_offset_minutes: i32,
}

impl Default for Log {
    fn default() -> Self {
        Log {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION.into(),
            entries: Vec::new(),
            ai_reads: AiReads::default(),
            utc_offset_minutes: 0,
        }
    }
}

/// 画面から届く1件（種類・画面・操作・文だけ。日時・版・OS は本体が入れる）
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewEntry {
    pub kind: String,
    pub place: String,
    pub action: String,
    pub message: String,
}

// ------------------------------------------------------------------ 文を削る

/// 伏せた印（作業の途中だけ。制御文字は先に空白にするので、元の文とぶつからない）
const S_PLACE: char = '\u{1}';
const S_MAIL: char = '\u{2}';
const S_HIDDEN: char = '\u{3}';
const S_NUMBER: char = '\u{4}';

/// 引用符の組（開き → 閉じ）
const QUOTES: &[(char, char)] = &[
    ('\'', '\''),
    ('"', '"'),
    ('`', '`'),
    ('“', '”'),
    ('‘', '’'),
    ('「', '」'),
    ('『', '』'),
];

/// 引用符の中で残してよい形（英字か _ $ で始まる、英数字・_ $ . の40文字まで。プロパティの名前など）
fn identifier_like(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
        && s.chars().count() <= 40
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '.')
}

/// ファイルの場所・URL の形の語（PC のユーザー名が入りうる）
fn path_like(tok: &str) -> bool {
    tok.contains('/') || tok.contains('\\') || tok.contains("://") || tok.starts_with("file:")
}

/// エラーの文を削る（0234 の2）。ここを通った文だけを記録に残す
pub fn clean_message(raw: &str) -> String {
    // 1. 長さを切り、制御文字（改行を含む）を空白に
    let s: String = raw
        .chars()
        .take(MAX_INPUT_CHARS)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    // 2. 引用符の中: 短い英字の名前のほかは伏せる。閉じていなければ、そこから後ろを伏せる
    let mut quoted = String::new();
    let mut it = s.chars().collect::<Vec<_>>().into_iter().peekable();
    while let Some(c) = it.next() {
        let Some(&(_, close)) = QUOTES.iter().find(|(o, _)| *o == c) else {
            quoted.push(c);
            continue;
        };
        // 閉じは「いちばん後ろの閉じ」まで取る（JSON の切れ端のように引用符が入れ子になっていても、間の言葉を残さない）
        let rest: Vec<char> = it.by_ref().collect();
        let last = rest.iter().rposition(|d| *d == close);
        let closed = last.is_some();
        let inner: String = rest[..last.unwrap_or(rest.len())].iter().collect();
        let after: String = last.map_or_else(String::new, |i| rest[i + 1..].iter().collect());
        it = after.chars().collect::<Vec<_>>().into_iter().peekable();
        quoted.push(c);
        if closed && identifier_like(&inner) {
            quoted.push_str(&inner);
        } else {
            quoted.push(S_HIDDEN);
        }
        if closed {
            quoted.push(close);
        }
    }
    // 3. 語ごと: ファイルの場所・メールの形を伏せ、ASCII の外の文字の並びを伏せ、数字を含む語を伏せる（エラーの符号 E_… は残す）
    let mut words = Vec::new();
    for tok in quoted.split_whitespace() {
        if path_like(tok) {
            words.push(S_PLACE.to_string());
            continue;
        }
        if tok.contains('@') {
            words.push(S_MAIL.to_string());
            continue;
        }
        let mut w = String::new();
        let mut run = String::new();
        let flush = |run: &mut String, w: &mut String| {
            if run.is_empty() {
                return;
            }
            let code = run.starts_with("E_")
                && run
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
            if !code && run.chars().any(|c| c.is_ascii_digit()) {
                w.push(S_NUMBER);
            } else {
                w.push_str(run);
            }
            run.clear();
        };
        for c in tok.chars() {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ',' {
                run.push(c);
            } else {
                flush(&mut run, &mut w);
                if c.is_ascii() || (S_PLACE..=S_NUMBER).contains(&c) {
                    w.push(c);
                } else if !w.ends_with(S_HIDDEN) {
                    w.push(S_HIDDEN);
                }
            }
        }
        flush(&mut run, &mut w);
        words.push(w);
    }
    // 4. 印を言葉に戻し、続いた … をまとめて、長さを切る
    let mut out = String::new();
    for c in words.join(" ").chars() {
        let r = match c {
            S_PLACE => "<場所>",
            S_MAIL => "<メール>",
            S_HIDDEN => "…",
            S_NUMBER => "#",
            _ => {
                out.push(c);
                continue;
            }
        };
        if !(r == "…" && out.ends_with('…')) {
            out.push_str(r);
        }
    }
    let out = out.trim();
    if out.is_empty() {
        return "（文なし）".into();
    }
    cut(out, MAX_MESSAGE_CHARS)
}

/// 画面・操作の言葉を削る（コードの決まった言葉だけが来る前提で、念のため: ひらがな・カタカナ・漢字・英字と _ ・ （ ）だけを残す。
/// 数字・引用符・ファイルの場所は残らない）
pub fn clean_label(raw: &str) -> String {
    if raw.contains('/') || raw.contains('\\') || raw.contains('@') {
        return "—".into();
    }
    let s: String = raw
        .chars()
        .take(MAX_INPUT_CHARS)
        .filter(|c| {
            c.is_ascii_alphabetic()
                || matches!(c, '_' | ' ' | '・' | '（' | '）' | 'ー' | '々')
                || ('\u{3041}'..='\u{30FA}').contains(c)
                || ('\u{4E00}'..='\u{9FFF}').contains(c)
        })
        .collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        return "—".into();
    }
    cut(&s, MAX_LABEL_CHARS)
}

/// アプリの版（英数字と . + - の20文字まで。本体の版を入れるだけ）
fn clean_version(v: &str) -> String {
    v.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
        .take(20)
        .collect()
}

fn cut(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_owned();
    }
    let mut t: String = s.chars().take(max - 1).collect();
    t.push('…');
    t
}

// ------------------------------------------------------------------ 足す・読む

/// まとめる鍵（同じ版・種類・画面・操作・文）
fn same(a: &Entry, b: &Entry) -> bool {
    a.app_version == b.app_version
        && a.kind == b.kind
        && a.place == b.place
        && a.action == b.action
        && a.message == b.message
        && a.source == b.source
}

impl Log {
    /// 1件足す（同じエラーがあれば回数を進めて先頭へ。上限を超えたら古いものから忘れる）
    pub fn push(&mut self, e: Entry) {
        if let Some(i) = self.entries.iter().position(|x| same(x, &e)) {
            let mut old = self.entries.remove(i);
            old.count = old.count.saturating_add(1);
            old.last_ms = e.last_ms.max(old.last_ms);
            self.entries.insert(0, old);
        } else {
            self.entries.insert(0, e);
        }
        self.entries.truncate(MAX_ENTRIES);
    }

    /// 画面から届いた1件を足す（種類が知らない物なら断る。panic は画面からは足せない）
    pub fn add(
        &mut self,
        n: &NewEntry,
        now_ms: u64,
        version: &str,
        os: &str,
    ) -> Result<(), String> {
        if n.kind == "panic" || !KINDS.iter().any(|(k, _)| *k == n.kind) {
            return Err("E_ERROR_LOG_SHAPE".into());
        }
        self.push(Entry {
            first_ms: now_ms,
            last_ms: now_ms,
            count: 1,
            app_version: clean_version(version),
            os: os.to_owned(),
            kind: n.kind.clone(),
            place: clean_label(&n.place),
            action: clean_label(&n.action),
            message: clean_message(&n.message),
            source: None,
        });
        Ok(())
    }

    fn local(&self, ms: u64) -> String {
        let shifted = ms as i64 + i64::from(self.utc_offset_minutes) * 60_000;
        let iso = iso8601(shifted.max(0) as u64);
        format!("{} {}", &iso[..10], &iso[11..16])
    }

    /// 1件の1行（写す文と AI に渡す文で同じ）
    pub fn line(&self, e: &Entry) -> String {
        let mut s = format!(
            "{}・版 {}・{}・{}・{}・{}: {}",
            self.local(e.last_ms),
            e.app_version,
            e.os,
            e.place,
            e.action,
            kind_label(&e.kind),
            e.message
        );
        if let Some(src) = &e.source {
            s.push_str(&format!("（止まった所 {src}）"));
        }
        if e.count > 1 {
            s.push_str(&format!(
                "（{}回。最初は {}）",
                e.count,
                self.local(e.first_ms)
            ));
        }
        s
    }

    /// FP が報告に貼る文（新しい順）
    pub fn text(&self) -> String {
        if self.entries.is_empty() {
            return "ファイナンシアのエラーの記録: ありません（この PC では、まだエラーを残していません）".into();
        }
        let mut s = format!(
            "ファイナンシアのエラーの記録（この PC・新しい順に {}件）\nお客さまの名前・金額・生年月日・メモ・ファイルの場所は入れていません。\n",
            self.entries.len()
        );
        for e in &self.entries {
            s.push_str("- ");
            s.push_str(&self.line(e));
            s.push('\n');
        }
        s
    }

    /// 画面に渡す形（日時は ISO の UTC。画面がこの PC の時刻で出す）
    pub fn view(&self) -> Value {
        json!({
            "entries": self.entries.iter().map(|e| self.entry_json(e)).collect::<Vec<_>>(),
            "max": MAX_ENTRIES,
            "aiReads": { "count": self.ai_reads.count, "lastAt": self.ai_reads.last_ms.map(iso8601) },
            "text": self.text(),
        })
    }

    fn entry_json(&self, e: &Entry) -> Value {
        let mut v = json!({
            "firstAt": iso8601(e.first_ms),
            "lastAt": iso8601(e.last_ms),
            "count": e.count,
            "appVersion": e.app_version,
            "os": e.os,
            "kind": e.kind,
            "kindLabel": kind_label(&e.kind),
            "place": e.place,
            "action": e.action,
            "message": e.message,
            "line": self.line(e),
        });
        if let Some(s) = &e.source {
            v["source"] = json!(s);
        }
        v
    }

    /// AI接続に渡す形（読むだけ。AI が読んだ回数は渡さない）
    pub fn for_ai(&self) -> Value {
        json!({
            "entries": self.entries.iter().map(|e| self.entry_json(e)).collect::<Vec<_>>(),
            "max": MAX_ENTRIES,
            "utcOffsetMinutes": self.utc_offset_minutes,
            "text": self.text(),
        })
    }
}

// ------------------------------------------------------------------ ファイル

/// 読み書きを1つずつにする（panic のときは待たない。try_lock）
static FILE_LOCK: Mutex<()> = Mutex::new(());

pub fn read(path: &Path) -> Log {
    let ok = std::fs::metadata(path).is_ok_and(|m| m.len() <= MAX_FILE_BYTES);
    if !ok {
        return Log::default();
    }
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Log>(&b).ok())
        .filter(|l| l.format == FORMAT && l.format_version.starts_with("1."))
        .map(|mut l| {
            l.entries.truncate(MAX_ENTRIES);
            l
        })
        .unwrap_or_default()
}

pub fn write(path: &Path, log: &Log) -> Result<(), String> {
    let bytes = serde_json::to_vec(log).map_err(|_| "E_ERROR_LOG_WRITE")?;
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|_| "E_ERROR_LOG_WRITE")?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|_| "E_ERROR_LOG_WRITE")?;
    std::fs::rename(&tmp, path).map_err(|_| "E_ERROR_LOG_WRITE")?;
    Ok(())
}

/// 読んで、変えて、書く（ほかの読み書きと重ならない）
fn update<T>(path: &Path, f: impl FnOnce(&mut Log) -> T) -> Result<T, String> {
    let _g = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut log = read(path);
    let out = f(&mut log);
    write(path, &log)?;
    Ok(out)
}

/// 記録のファイルの場所（notices と同じ置き方。開発用のビルドは別の場所）
pub fn path_of<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let base = app.path().app_data_dir().ok()?;
    let mut dir = base.join(if cfg!(debug_assertions) {
        "errors-dev"
    } else {
        "errors"
    });
    // 開発のときだけ（debug のビルド）: 試験用のデータフォルダの中に置く（store.rs・notices.rs と同じ変数）
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("FINANCIA_DEV_STORE_DIR").filter(|v| !v.is_empty()) {
            dir = PathBuf::from(d).join("errors");
        }
    }
    Some(dir.join("log.json"))
}

fn utc_offset_ok(m: i32) -> bool {
    (-14 * 60..=14 * 60).contains(&m)
}

/// AI接続が読む（読んだ回数と最後の日時を記録の中に残す）。ai.rs が台帳に入れる
pub fn read_for_ai(path: &Path, now_ms: u64) -> Option<Value> {
    update(path, |log| {
        log.ai_reads.count = log.ai_reads.count.saturating_add(1);
        log.ai_reads.last_ms = Some(now_ms);
        log.for_ai()
    })
    .ok()
}

/// 本体が想定外に止まったときに残す（文は同じ決まりで削る。止まった所はファイルの名前と行だけ）
pub fn install_panic_hook(path: PathBuf, version: String) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let source = info
            .location()
            .and_then(|l| panic_source(l.file(), l.line()));
        // 記録の読み書きの途中で止まったときは待たない（重ねて止まらないように）
        if let Ok(_g) = FILE_LOCK.try_lock() {
            let mut log = read(&path);
            let now = SystemClock.now_ms();
            log.push(panic_entry(&payload, source, now, &version));
            let _ = write(&path, &log);
        }
        prev(info);
    }));
}

/// 止まった所（ファイルの名前と行だけ。フォルダの場所は残さない）
pub fn panic_source(file: &str, line: u32) -> Option<String> {
    let name = file.rsplit(['/', '\\']).next()?;
    let ok = !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    ok.then(|| format!("{name}:{line}"))
}

pub fn panic_entry(payload: &str, source: Option<String>, now_ms: u64, version: &str) -> Entry {
    Entry {
        first_ms: now_ms,
        last_ms: now_ms,
        count: 1,
        app_version: clean_version(version),
        os: crate::notices::os_name().to_owned(),
        kind: "panic".into(),
        place: "本体".into(),
        action: "本体の処理".into(),
        message: clean_message(payload),
        source,
    }
}

// ------------------------------------------------------------------ 画面からの命令

fn path_or_err<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    path_of(app).ok_or_else(|| "E_ERROR_LOG_DIR".to_owned())
}

/// 1件足す（画面の try/catch・本体の命令の失敗・計算できなかったとき。文は本体が削ってから残す）
#[tauri::command]
pub fn error_log_add(app: AppHandle, entry: NewEntry) -> Result<(), String> {
    let path = path_or_err(&app)?;
    let version = app.package_info().version.to_string();
    let now = SystemClock.now_ms();
    update(&path, |log| {
        log.add(&entry, now, &version, crate::notices::os_name())
    })?
}

/// 画面に出す記録（`utc_offset_minutes` はこの PC の時差。写す文の日時に使い、記録に覚える）
#[tauri::command]
pub fn error_log_get(app: AppHandle, utc_offset_minutes: i32) -> Result<Value, String> {
    let path = path_or_err(&app)?;
    update(&path, |log| {
        if utc_offset_ok(utc_offset_minutes) {
            log.utc_offset_minutes = utc_offset_minutes;
        }
        log.view()
    })
}

/// 記録をすべて消す（AI が読んだ回数も消す）
#[tauri::command]
pub fn error_log_clear(app: AppHandle) -> Result<Value, String> {
    let path = path_or_err(&app)?;
    update(&path, |log| {
        let offset = log.utc_offset_minutes;
        *log = Log {
            utc_offset_minutes: offset,
            ..Log::default()
        };
        log.view()
    })
}

/// 報告に貼る文を写す（文は本体が記録から作る。画面からは文を受け取らない）。写せたら true
#[tauri::command]
pub fn error_log_copy(app: AppHandle) -> Result<bool, String> {
    let path = path_or_err(&app)?;
    let text = {
        let _g = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        read(&path).text()
    };
    Ok(crate::ai::copy_to_clipboard(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(kind: &str, message: &str) -> NewEntry {
        NewEntry {
            kind: kind.into(),
            place: "結果".into(),
            action: "世帯の保存（store_save）".into(),
            message: message.into(),
        }
    }

    #[test]
    fn household_contents_and_user_names_do_not_stay() {
        let cases = [
            // ファイルの場所（PC のユーザー名）
            ("failed to open /Users/yamada.taro/Library/Application Support/x.json", "yamada"),
            (r"cannot read C:\Users\Sato Hanako\AppData\Roaming\financia\h.fpx", "Sato"),
            (r"cannot read C:\Users\Sato Hanako\AppData\Roaming\financia\h.fpx", "Hanako"),
            ("load failed: file:///home/suzuki/app.js", "suzuki"),
            // 名前（日本語）・金額・生年月日・メモ
            ("世帯「山田太郎」の保存に失敗", "山田"),
            ("山田太郎さんの年収 6,500,000 円", "山田"),
            ("山田太郎さんの年収 6,500,000 円", "6,500,000"),
            ("birthDate 1985-04-12 is out of range", "1985"),
            ("Unexpected token 'x', \"{\"name\":\"Yamada\",\"memo\":\"secret\"}\" is not valid JSON", "Yamada"),
            ("Unexpected token 'x', \"{\"name\":\"Yamada\",\"memo\":\"secret\"}\" is not valid JSON", "secret"),
            ("value 12000000 is too large", "12000000"),
            // 世帯を識別する値（内部 ID・共有の ID・顧客番号）・メール
            ("household h-3fa85f64-5717-4562 not found", "3fa85f64"),
            ("share s-9f8e7d6c5b4a39281706f5e4d3c2b1a0 expired", "9f8e7d6c"),
            ("customer C-0042 locked", "0042"),
            ("sent to taro@example.com", "taro"),
            // 閉じていない引用符の後ろ
            ("bad name 'Taro Yamada", "Taro"),
        ];
        for (raw, banned) in cases {
            let c = clean_message(raw);
            assert!(!c.contains(banned), "{raw} → {c}");
            assert!(c.chars().count() <= MAX_MESSAGE_CHARS);
        }
        // 調べるのに要る所は残る
        assert_eq!(
            clean_message("TypeError: Cannot read properties of undefined (reading 'income')"),
            "TypeError: Cannot read properties of undefined (reading 'income')"
        );
        assert_eq!(clean_message("E_STORE_CONFLICT"), "E_STORE_CONFLICT");
        assert_eq!(
            clean_message("E_PARAM_NO_VALUE tax.basic"),
            "E_PARAM_NO_VALUE tax.basic"
        );
        assert_eq!(
            clean_message("failed to open /Users/yamada/x.json"),
            "failed to open <場所>"
        );
        assert_eq!(
            clean_message("value 1,234 at position 56"),
            "value # at position #"
        );
        assert_eq!(clean_message("世帯「山田」の保存"), "…");
        assert_eq!(clean_message("   "), "（文なし）");
        assert_eq!(clean_message("a\nb\tc"), "a b c");
    }

    #[test]
    fn labels_keep_only_fixed_words() {
        assert_eq!(clean_label("資産と負債"), "資産と負債");
        assert_eq!(
            clean_label("世帯の保存（store_save）"),
            "世帯の保存（store_save）"
        );
        assert_eq!(clean_label("/Users/yamada"), "—");
        assert_eq!(clean_label(r"C:\Users\yamada"), "—");
        assert!(!clean_label("年収 650万円").contains("650"));
        assert_eq!(clean_label(""), "—");
        assert!(clean_label(&"あ".repeat(100)).chars().count() <= MAX_LABEL_CHARS);
    }

    #[test]
    fn long_messages_are_cut() {
        let long = "x ".repeat(5000);
        let c = clean_message(&long);
        assert_eq!(c.chars().count(), MAX_MESSAGE_CHARS);
        assert!(c.ends_with('…'));
    }

    #[test]
    fn same_errors_are_merged_and_the_oldest_are_forgotten() {
        let mut log = Log::default();
        // 0件
        assert!(log.text().contains("ありません"));
        assert_eq!(log.view()["entries"], json!([]));
        // 同じエラーが続く: 1件にまとめ、回数と最後の日時を進める
        for i in 0..5 {
            log.add(
                &new("command", "E_STORE_CONFLICT"),
                1_000 + i,
                "0.1.0",
                "macOS",
            )
            .unwrap();
        }
        assert_eq!(log.entries.len(), 1);
        assert_eq!(log.entries[0].count, 5);
        assert_eq!(log.entries[0].first_ms, 1_000);
        assert_eq!(log.entries[0].last_ms, 1_004);
        // 数字だけ違う文は同じエラーとしてまとまる（数字は # に伏せるため）
        log.add(&new("screen", "position 12"), 2_000, "0.1.0", "macOS")
            .unwrap();
        log.add(&new("screen", "position 99"), 2_001, "0.1.0", "macOS")
            .unwrap();
        assert_eq!(log.entries.len(), 2);
        assert_eq!(log.entries[0].count, 2);
        // 前にあったエラーがまた起きたら先頭へ
        log.add(&new("command", "E_STORE_CONFLICT"), 3_000, "0.1.0", "macOS")
            .unwrap();
        assert_eq!(log.entries[0].message, "E_STORE_CONFLICT");
        assert_eq!(log.entries[0].count, 6);
        // 上限: 最後に起きたのが古いものから忘れる
        // 数字を使わずに違う文を作る（a・b・…・aa・ab・…）
        let word = |mut i: u64| {
            let mut w = String::new();
            loop {
                w.insert(0, char::from(b'a' + (i % 26) as u8));
                if i < 26 {
                    break w;
                }
                i = i / 26 - 1;
            }
        };
        for i in 0..(MAX_ENTRIES as u64 + 20) {
            let m = format!("error {}", word(i));
            log.add(&new("screen", &m), 10_000 + i, "0.1.0", "macOS")
                .unwrap();
        }
        assert_eq!(log.entries.len(), MAX_ENTRIES);
        assert!(log.entries.iter().all(|e| e.message != "E_STORE_CONFLICT"));
        assert!(log.entries.windows(2).all(|w| w[0].last_ms >= w[1].last_ms));
    }

    #[test]
    fn the_screen_can_send_only_known_kinds() {
        let mut log = Log::default();
        assert!(log.add(&new("panic", "x"), 1, "0.1.0", "macOS").is_err());
        assert!(log.add(&new("other", "x"), 1, "0.1.0", "macOS").is_err());
        assert!(log.entries.is_empty());
        for (k, _) in KINDS.iter().filter(|(k, _)| *k != "panic") {
            assert!(log.add(&new(k, "x"), 1, "0.1.0", "macOS").is_ok());
        }
        // 届く欄は4つだけ（日時・版・OS は本体が入れる）
        assert!(serde_json::from_value::<NewEntry>(
            json!({ "kind": "screen", "place": "結果", "action": "a", "message": "m", "household": "x" })
        )
        .is_err());
    }

    #[test]
    fn text_and_view_use_the_pc_time() {
        let mut log = Log {
            utc_offset_minutes: 9 * 60,
            ..Log::default()
        };
        // 2026-11-20T01:02:00Z → この PC（+9時間）の 10:02
        let t = 1_795_136_520_000;
        log.add(&new("command", "E_STORE_CONFLICT"), t, "0.1.0", "macOS")
            .unwrap();
        log.add(
            &new("command", "E_STORE_CONFLICT"),
            t + 60_000,
            "0.1.0",
            "macOS",
        )
        .unwrap();
        let text = log.text();
        assert!(text.contains("新しい順に 1件"), "{text}");
        assert!(
            text.contains("2026-11-20 10:03・版 0.1.0・macOS・結果・世帯の保存（store_save）・本体の命令の失敗: E_STORE_CONFLICT（2回。最初は 2026-11-20 10:02）"),
            "{text}"
        );
        let v = log.view();
        assert_eq!(v["entries"][0]["lastAt"], "2026-11-20T01:03:00Z");
        assert_eq!(v["entries"][0]["kindLabel"], "本体の命令の失敗");
        assert_eq!(v["max"], MAX_ENTRIES);
        let ai = log.for_ai();
        assert!(ai.get("aiReads").is_none());
        assert_eq!(ai["entries"][0]["count"], 2);
    }

    #[test]
    fn the_file_is_read_safely_and_ai_reads_are_counted() {
        let dir = std::env::temp_dir().join(format!("financia-errlog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("errors").join("log.json");
        // 無い・壊れた・違う形式は空から
        assert!(read(&path).entries.is_empty());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{oops").unwrap();
        assert!(read(&path).entries.is_empty());
        std::fs::write(
            &path,
            br#"{"format":"other","formatVersion":"1.0","entries":[]}"#,
        )
        .unwrap();
        assert!(read(&path).entries.is_empty());
        update(&path, |l| {
            l.add(&new("calc", "E_HOST_MEMORY"), 5, "0.1.0", "Windows")
        })
        .unwrap()
        .unwrap();
        let v = read_for_ai(&path, 99).unwrap();
        assert_eq!(v["entries"][0]["message"], "E_HOST_MEMORY");
        read_for_ai(&path, 120).unwrap();
        let back = read(&path);
        assert_eq!(
            back.ai_reads,
            AiReads {
                count: 2,
                last_ms: Some(120)
            }
        );
        assert_eq!(back.view()["aiReads"]["count"], 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn panics_keep_only_the_file_name_and_line() {
        assert_eq!(
            panic_source("/Users/runner/work/lifeplan/app/src-tauri/src/ai.rs", 120).as_deref(),
            Some("ai.rs:120")
        );
        assert_eq!(
            panic_source(r"C:\Users\Sato\.cargo\registry\src\x\lib.rs", 7).as_deref(),
            Some("lib.rs:7")
        );
        let e = panic_entry(
            "called `Result::unwrap()` on an `Err` value: Os { path: \"/Users/yamada/x\" }",
            panic_source("src/store.rs", 3),
            1,
            "0.1.0",
        );
        assert_eq!(e.kind, "panic");
        assert!(!e.message.contains("yamada"), "{}", e.message);
        let mut log = Log::default();
        log.push(e);
        assert!(
            log.text().contains("（止まった所 store.rs:3）"),
            "{}",
            log.text()
        );
    }
}
