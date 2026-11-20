//! AI のアプリへの登録（0015 の10・0228）。FP が事務所の設定の「AI のアプリに登録する」で押したときだけ、AI のアプリの設定に
//! AI接続口（`lifeplan mcp`）を足す・場所を直す・外す。
//!
//! 画面の行は「Claude」と「Codex」の2つ（0228 の追記 2026-11-20）。Claude の行は、書く先が2つある（1回押すと両方に登録する）:
//!
//! - **Claude のアプリ（チャット）**: `claude_desktop_config.json` の `mcpServers` に足す。起動中に書くと、アプリが終了するときに
//!   書き直して消えるので（0015 の追記 2026-10-08）、起動しているあいだは書かない（Claude Code の側だけ登録し、終了を頼む）。
//!   拡張（MCPB）は今回は作らない（0228 の2）
//! - **Claude Code**: ファイルを直接書かず、`claude mcp add --scope user` を呼ぶ（0015 の10）。状態は `~/.claude.json` を読むだけ
//!
//! - **Codex**: `~/.codex/config.toml`（`CODEX_HOME`）の `[mcp_servers.<名前>]` だけを足す（コメント・ほかの行は toml_edit で残す）
//!
//! Gemini CLI は一覧に出していない（Gemini のアプリが、パソコンの中の接続の道具に対応したら足す。0228 の追記 2026-11-20）。
//!
//! 設定のファイルを書くときの決まり: ほかのサーバーの設定・ほかの欄は1文字も変えない（JSON は元の文をそのまま写し、足す・直すのは
//! 自分の名前の所だけ）。書く前の元のファイルはアプリのデータの場所（`ai-app-backups/`）に控える。登録済みなら場所だけ直す。
//! 読めない形（コメントの入った JSON・`mcpServers` が表でない など）なら書かずに止め、画面は「文面をコピー」の手順に戻す。
//! 画面には、接続口の本物の場所を渡さない（書く中身は場所を伏せた文面。書く場所はホームを `~` にした表示。0016 の1）。

use std::path::{Path, PathBuf};

use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::value::RawValue;
use tauri::{AppHandle, Manager};

use crate::ai::{connector_path, setup_text, AiState};

/// 画面に見せる中身で、接続口の場所を伏せる印（画面の文には「接続口」と書かない）
const EXE_PLACEHOLDER: &str = "<AI と接続する道具の場所>";
const RUNTIME_PLACEHOLDER: &str = "<開発用の作業フォルダ>";
/// 控えを置くフォルダ（アプリのデータの場所の下）
const BACKUP_DIR: &str = "ai-app-backups";

/// 登録の名前（0015 の10）。開発用のビルドは製品の登録を上書きしないよう別の名前にする
pub fn server_name() -> &'static str {
    if cfg!(debug_assertions) {
        "fprise-lifeplan-dev"
    } else {
        "fprise-lifeplan"
    }
}

/// 書く先（設定のファイルか、AI のアプリのコマンド）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Client {
    ClaudeDesktop,
    ClaudeCode,
    Codex,
}

impl Client {
    /// 控えのファイルの名前にも使う（変えない）
    pub fn id(self) -> &'static str {
        match self {
            Client::ClaudeDesktop => "claudeDesktop",
            Client::ClaudeCode => "claudeCode",
            Client::Codex => "codex",
        }
    }
    /// 行の中での呼び名（Claude の行は、この2つの状態を並べて出す）
    fn label(self) -> &'static str {
        match self {
            Client::ClaudeDesktop => "チャット（アプリ）",
            Client::ClaudeCode => "Claude Code",
            Client::Codex => "Codex",
        }
    }
}

/// 画面の行（0228 の追記 2026-11-20）。Claude の行は、チャットのアプリと Claude Code の2つの書く先をまとめる
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Row {
    Claude,
    Codex,
}

pub const ROWS: [Row; 2] = [Row::Claude, Row::Codex];

impl Row {
    pub fn id(self) -> &'static str {
        match self {
            Row::Claude => "claude",
            Row::Codex => "codex",
        }
    }
    fn title(self) -> &'static str {
        match self {
            Row::Claude => "Claude",
            Row::Codex => "Codex",
        }
    }
    fn parts(self) -> &'static [Client] {
        match self {
            Row::Claude => &[Client::ClaudeDesktop, Client::ClaudeCode],
            Row::Codex => &[Client::Codex],
        }
    }
    fn from_id(s: &str) -> Option<Row> {
        ROWS.into_iter().find(|r| r.id() == s)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

/// 設定のファイルの場所を決める元（テストでは一時フォルダを入れる）
#[derive(Clone, Debug)]
pub struct Ctx {
    pub os: Os,
    pub home: PathBuf,
    /// Windows の %APPDATA%（Roaming）
    pub appdata: Option<PathBuf>,
    /// Windows の %LOCALAPPDATA%
    pub local_appdata: Option<PathBuf>,
    /// Codex の設定のフォルダ（`CODEX_HOME`。無ければ ~/.codex）
    pub codex_home: PathBuf,
    /// `claude` を探すフォルダ（PATH と、よく入る場所）
    pub path_dirs: Vec<PathBuf>,
    /// Mac で Claude のアプリ（Claude.app）を探すフォルダ
    pub mac_app_dirs: Vec<PathBuf>,
}

impl Ctx {
    pub fn from_env() -> Option<Ctx> {
        let os = if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        };
        let home = std::env::var_os(if os == Os::Windows {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)?;
        let var = |n: &str| {
            std::env::var_os(n)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        let codex_home = var("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
        let mut path_dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        // GUI のアプリの PATH は短い（Mac は /usr/bin:/bin:/usr/sbin:/sbin）ので、claude がよく入る場所も探す
        path_dirs.extend([
            home.join(".local/bin"),
            home.join(".claude/local"),
            home.join(".npm-global/bin"),
            home.join(".bun/bin"),
            home.join(".volta/bin"),
        ]);
        if os == Os::Windows {
            if let Some(a) = var("APPDATA") {
                path_dirs.push(a.join("npm"));
            }
        } else {
            path_dirs.extend([
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
            ]);
        }
        Some(Ctx {
            os,
            appdata: var("APPDATA"),
            local_appdata: var("LOCALAPPDATA"),
            codex_home,
            mac_app_dirs: vec![PathBuf::from("/Applications"), home.join("Applications")],
            home,
            path_dirs,
        })
    }

    /// 設定のファイル（Claude Code は状態を読むだけのファイル）
    fn config_path(&self, c: Client) -> Option<PathBuf> {
        Some(match c {
            Client::ClaudeDesktop => match self.os {
                Os::Mac => self
                    .home
                    .join("Library/Application Support/Claude/claude_desktop_config.json"),
                Os::Windows => self
                    .appdata
                    .as_ref()?
                    .join("Claude")
                    .join("claude_desktop_config.json"),
                // Claude のアプリの Linux 版は無い
                Os::Linux => return None,
            },
            Client::ClaudeCode => self.home.join(".claude.json"),
            Client::Codex => self.codex_home.join("config.toml"),
        })
    }

    /// その AI のアプリがこの PC にあるか（設定のフォルダかアプリ・コマンドがあるか）
    fn installed(&self, c: Client) -> bool {
        match c {
            Client::ClaudeDesktop => {
                let dir = self
                    .config_path(c)
                    .and_then(|p| p.parent().map(Path::to_path_buf));
                dir.is_some_and(|d| d.is_dir())
                    || match self.os {
                        Os::Mac => self
                            .mac_app_dirs
                            .iter()
                            .any(|d| d.join("Claude.app").is_dir()),
                        Os::Windows => self
                            .local_appdata
                            .as_ref()
                            .is_some_and(|l| l.join("AnthropicClaude").is_dir()),
                        Os::Linux => false,
                    }
            }
            Client::ClaudeCode => {
                self.find_claude().is_some() || self.home.join(".claude.json").is_file()
            }
            Client::Codex => self.codex_home.is_dir(),
        }
    }

    /// `claude` コマンド
    fn find_claude(&self) -> Option<PathBuf> {
        let names: &[&str] = if self.os == Os::Windows {
            &["claude.exe", "claude.cmd"]
        } else {
            &["claude"]
        };
        self.path_dirs
            .iter()
            .flat_map(|d| names.iter().map(move |n| d.join(n)))
            .find(|p| p.is_file())
    }

    /// 画面に見せる場所（ホームを ~ にする）
    fn shown(&self, p: &Path) -> String {
        match p.strip_prefix(&self.home) {
            Ok(rest) => {
                let sep = if self.os == Os::Windows { "\\" } else { "/" };
                format!("~{sep}{}", rest.to_string_lossy())
            }
            Err(_) => p.to_string_lossy().into_owned(),
        }
    }
}

// ------------------------------------------------------------------ JSON（元の文をそのまま写し、自分の名前の所だけ変える）

/// 順番を保った JSON のオブジェクト（値は元の文のまま）
struct Ordered(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Ordered;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON のオブジェクト")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Ordered, A::Error> {
                let mut v = Vec::new();
                while let Some((k, val)) = m.next_entry::<String, Box<RawValue>>()? {
                    v.push((k, val));
                }
                Ok(Ordered(v))
            }
        }
        d.deserialize_map(V)
    }
}

/// 読めない形（書かずに止める）
pub const E_UNREADABLE: &str = "E_AI_APP_UNREADABLE";

fn parse_ordered(text: &str) -> Result<Ordered, &'static str> {
    serde_json::from_str::<Ordered>(text).map_err(|_| E_UNREADABLE)
}

fn key(k: &str) -> String {
    serde_json::to_string(k).unwrap_or_default()
}

/// 1段のオブジェクトを書く。値は渡した文のまま（元のファイルの文は、元の深さの字下げを持っている）
fn write_object(entries: &[(String, String)], indent: usize) -> String {
    if entries.is_empty() {
        return "{}".into();
    }
    let pad = " ".repeat(indent + 2);
    let body: Vec<String> = entries
        .iter()
        .map(|(k, v)| format!("{pad}{}: {v}", key(k)))
        .collect();
    format!("{{\n{}\n{}}}", body.join(",\n"), " ".repeat(indent))
}

/// 新しく書く値を、その深さの字下げにする
fn pretty_at(v: &serde_json::Value, indent: usize) -> String {
    let s = serde_json::to_string_pretty(v).unwrap_or_default();
    let pad = " ".repeat(indent);
    s.lines()
        .enumerate()
        .map(|(i, l)| {
            if i == 0 {
                l.to_owned()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 元のファイルの頭の BOM と改行の形（書き戻すときにそろえる）
struct Style {
    bom: bool,
    crlf: bool,
}

fn split_style(text: &str) -> (Style, &str) {
    let bom = text.starts_with('\u{feff}');
    let body = text.trim_start_matches('\u{feff}');
    (
        Style {
            bom,
            crlf: body.contains("\r\n"),
        },
        body,
    )
}

fn join_style(s: &Style, text: String) -> String {
    let t = if s.crlf {
        text.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        text
    };
    if s.bom {
        format!("\u{feff}{t}")
    } else {
        t
    }
}

/// 登録の状態
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Found {
    /// 自分の名前の登録が無い
    None,
    /// 登録がある（起動する場所。command が文字でなければ空）
    Points(String),
}

/// JSON の設定の `mcpServers.<name>` の状態
pub fn json_found(text: &str, name: &str) -> Result<Found, &'static str> {
    let (_, body) = split_style(text);
    if body.trim().is_empty() {
        return Ok(Found::None);
    }
    let top = parse_ordered(body)?;
    let Some((_, servers)) = top.0.iter().rev().find(|(k, _)| k == "mcpServers") else {
        return Ok(Found::None);
    };
    let servers = parse_ordered(servers.get())?;
    Ok(match servers.0.iter().rev().find(|(k, _)| k == name) {
        None => Found::None,
        Some((_, v)) => {
            let v: serde_json::Value = serde_json::from_str(v.get()).map_err(|_| E_UNREADABLE)?;
            Found::Points(
                v.get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_owned(),
            )
        }
    })
}

/// JSON の設定に自分の登録を足す・場所を直す（ほかの欄・ほかのサーバーは元の文のまま。自分の登録のほかの欄〔FP が足した env など〕も残す）
pub fn json_set(
    text: &str,
    name: &str,
    exe: &str,
    runtime: Option<&str>,
) -> Result<String, &'static str> {
    let (style, body) = split_style(text);
    let top = if body.trim().is_empty() {
        Ordered(Vec::new())
    } else {
        parse_ordered(body)?
    };
    let servers = match top.0.iter().rev().find(|(k, _)| k == "mcpServers") {
        Some((_, raw)) => parse_ordered(raw.get())?,
        None => Ordered(Vec::new()),
    };
    // 自分の登録（あれば元の欄を残して command・args だけ直す）
    let mut mine = match servers.0.iter().rev().find(|(k, _)| k == name) {
        Some((_, raw)) => match serde_json::from_str::<serde_json::Value>(raw.get()) {
            Ok(serde_json::Value::Object(m)) => serde_json::Value::Object(m),
            _ => return Err(E_UNREADABLE),
        },
        None => serde_json::json!({}),
    };
    mine["command"] = serde_json::Value::String(exe.to_owned());
    mine["args"] = serde_json::json!(["mcp"]);
    if let Some(r) = runtime {
        if !mine.get("env").is_some_and(|e| e.is_object()) {
            mine["env"] = serde_json::json!({});
        }
        mine["env"][ai_ipc::discovery::RUNTIME_DIR_ENV] = serde_json::Value::String(r.to_owned());
    }
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut placed = false;
    for (k, v) in &servers.0 {
        if k == name {
            if !placed {
                entries.push((k.clone(), pretty_at(&mine, 4)));
                placed = true;
            }
        } else {
            entries.push((k.clone(), v.get().to_owned()));
        }
    }
    if !placed {
        entries.push((name.to_owned(), pretty_at(&mine, 4)));
    }
    let servers_text = write_object(&entries, 2);
    Ok(join_style(&style, put_servers(&top, servers_text) + "\n"))
}

/// JSON の設定から自分の登録を外す（無ければ None）
pub fn json_remove(text: &str, name: &str) -> Result<Option<String>, &'static str> {
    let (style, body) = split_style(text);
    if body.trim().is_empty() {
        return Ok(None);
    }
    let top = parse_ordered(body)?;
    let Some((_, raw)) = top.0.iter().rev().find(|(k, _)| k == "mcpServers") else {
        return Ok(None);
    };
    let servers = parse_ordered(raw.get())?;
    if !servers.0.iter().any(|(k, _)| k == name) {
        return Ok(None);
    }
    let entries: Vec<(String, String)> = servers
        .0
        .iter()
        .filter(|(k, _)| k != name)
        .map(|(k, v)| (k.clone(), v.get().to_owned()))
        .collect();
    Ok(Some(join_style(
        &style,
        put_servers(&top, write_object(&entries, 2)) + "\n",
    )))
}

/// 一番上のオブジェクトの mcpServers を差し替える（無ければ最後に足す。ほかの欄は元の文のまま）
fn put_servers(top: &Ordered, servers_text: String) -> String {
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut placed = false;
    for (k, v) in &top.0 {
        if k == "mcpServers" {
            if !placed {
                entries.push((k.clone(), servers_text.clone()));
                placed = true;
            }
        } else {
            entries.push((k.clone(), v.get().to_owned()));
        }
    }
    if !placed {
        entries.push(("mcpServers".into(), servers_text));
    }
    write_object(&entries, 0)
}

// ------------------------------------------------------------------ TOML（Codex。toml_edit でコメント・ほかの行を残す）

pub fn toml_found(text: &str, name: &str) -> Result<Found, &'static str> {
    let doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| E_UNREADABLE)?;
    let Some(servers) = doc.get("mcp_servers") else {
        return Ok(Found::None);
    };
    let servers = servers.as_table_like().ok_or(E_UNREADABLE)?;
    Ok(match servers.get(name) {
        None => Found::None,
        Some(s) => {
            let s = s.as_table_like().ok_or(E_UNREADABLE)?;
            Found::Points(
                s.get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_owned(),
            )
        }
    })
}

pub fn toml_set(
    text: &str,
    name: &str,
    exe: &str,
    runtime: Option<&str>,
) -> Result<String, &'static str> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| E_UNREADABLE)?;
    if doc.get("mcp_servers").is_none() {
        let mut t = toml_edit::Table::new();
        t.set_implicit(true);
        doc.insert("mcp_servers", toml_edit::Item::Table(t));
    }
    let servers = doc
        .get_mut("mcp_servers")
        .and_then(|i| i.as_table_like_mut())
        .ok_or(E_UNREADABLE)?;
    if servers.get(name).is_none() {
        servers.insert(name, toml_edit::Item::Table(toml_edit::Table::new()));
    }
    let mine = servers
        .get_mut(name)
        .and_then(|i| i.as_table_like_mut())
        .ok_or(E_UNREADABLE)?;
    mine.insert("command", toml_edit::value(exe));
    let mut args = toml_edit::Array::new();
    args.push("mcp");
    mine.insert("args", toml_edit::value(args));
    if let Some(r) = runtime {
        if mine.get("env").is_none() {
            mine.insert("env", toml_edit::Item::Table(toml_edit::Table::new()));
        }
        let env = mine
            .get_mut("env")
            .and_then(|i| i.as_table_like_mut())
            .ok_or(E_UNREADABLE)?;
        env.insert(ai_ipc::discovery::RUNTIME_DIR_ENV, toml_edit::value(r));
    }
    Ok(doc.to_string())
}

pub fn toml_remove(text: &str, name: &str) -> Result<Option<String>, &'static str> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| E_UNREADABLE)?;
    let Some(servers) = doc.get_mut("mcp_servers") else {
        return Ok(None);
    };
    let servers = servers.as_table_like_mut().ok_or(E_UNREADABLE)?;
    if servers.remove(name).is_none() {
        return Ok(None);
    }
    Ok(Some(doc.to_string()))
}

// ------------------------------------------------------------------ 状態・登録・外す

/// 1つの書く先の状態
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiAppPart {
    id: &'static str,
    /// 行の中での呼び名（「チャット（アプリ）」「Claude Code」「Codex」）
    label: &'static str,
    /// registered（登録済み）・unregistered（未登録）・stale（場所が古い）・unreadable（設定のファイルを読めない）・
    /// missing（この PC に見つからない）・unsupported（この OS では使えない）
    state: &'static str,
    /// 書く場所（ホームを ~ にした表示。Claude Code はコマンドで登録する）
    target: String,
    /// 書く中身（接続口の場所を伏せた文面）
    preview: String,
    /// file（設定のファイルを書く）か command（AI のアプリのコマンドを呼ぶ）
    how: &'static str,
    /// 今は書けない理由（E_AI_APP_RUNNING: Claude のアプリが起動中・E_AI_APP_NO_COMMAND: claude が無い など）
    blocked: Option<&'static str>,
}

/// 画面の1行（Claude は書く先が2つ、Codex は1つ）
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiAppView {
    client: &'static str,
    title: &'static str,
    /// 書く先をまとめた状態。1つの書く先の状態に加えて、partial（片方だけ登録済み）がある
    state: &'static str,
    parts: Vec<AiAppPart>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiAppsStatus {
    apps: Vec<AiAppView>,
    /// 登録の名前（開発用のビルドは別の名前）
    server_name: &'static str,
    /// 接続口の場所の問題（見つからない・Mac で一時的な場所から開いている）。あればどれも登録できない
    location_problem: Option<&'static str>,
}

/// 接続口の場所が登録に使えるか（Mac で dmg から直接開いた・ダウンロードのまま開いた〔App Translocation〕ときは、閉じると消える場所になる）
pub fn location_problem(exe: Option<&Path>) -> Option<&'static str> {
    let exe = exe?;
    let s = exe.to_string_lossy();
    if s.contains("/AppTranslocation/") || s.starts_with("/Volumes/") {
        return Some("E_AI_APP_LOCATION");
    }
    None
}

fn same_place(registered: &str, exe: &Path) -> bool {
    if registered.is_empty() {
        return false;
    }
    let r = Path::new(registered);
    if r == exe {
        return true;
    }
    match (r.canonicalize(), exe.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn read_text(p: &Path) -> Result<Option<String>, &'static str> {
    match std::fs::read(p) {
        Ok(b) => String::from_utf8(b).map(Some).map_err(|_| E_UNREADABLE),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(E_UNREADABLE),
    }
}

fn found_in(c: Client, text: &str, name: &str) -> Result<Found, &'static str> {
    match c {
        Client::Codex => toml_found(text, name),
        _ => json_found(text, name),
    }
}

/// Claude のアプリが起動しているか（確かめられなければ false）。Mac はプロセスの名前（`pgrep -x Claude`）、
/// Windows は claude.exe の実行ファイルの場所で見る
fn claude_desktop_running(os: Os) -> bool {
    use std::process::{Command, Stdio};
    match os {
        Os::Mac => Command::new("/usr/bin/pgrep")
            .args(["-x", "Claude"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false),
        Os::Windows => {
            // Claude Code の claude.exe と見分けるため、実行ファイルの場所で見る（Claude のアプリは AnthropicClaude の下か、ストア版の Claude_ の下）
            let out = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { $_.ExecutablePath }",
                ])
                .stderr(Stdio::null())
                .output();
            out.map(|o| {
                String::from_utf8_lossy(&o.stdout).lines().any(|l| {
                    l.contains("\\AnthropicClaude\\") || l.contains("\\WindowsApps\\Claude_")
                })
            })
            .unwrap_or(false)
        }
        Os::Linux => false,
    }
}

/// 1つの書く先の状態（画面に返す形）
pub fn view(
    ctx: &Ctx,
    c: Client,
    exe: Option<&Path>,
    dev: bool,
    running: impl Fn() -> bool,
) -> AiAppPart {
    let name = server_name();
    let runtime = dev.then_some(RUNTIME_PLACEHOLDER);
    let (how, preview) = match c {
        Client::ClaudeCode => ("command", setup_text_named("command", name, runtime)),
        Client::Codex => ("file", setup_text_named("toml", name, runtime)),
        _ => ("file", setup_text_named("json", name, runtime)),
    };
    let path = ctx.config_path(c);
    let mut v = AiAppPart {
        id: c.id(),
        label: c.label(),
        state: "unregistered",
        target: match (c, &path) {
            (Client::ClaudeCode, _) => "claude mcp add --scope user".into(),
            (_, Some(p)) => ctx.shown(p),
            (_, None) => String::new(),
        },
        preview,
        how,
        blocked: None,
    };
    let Some(path) = path else {
        v.state = "unsupported";
        return v;
    };
    if !ctx.installed(c) {
        v.state = "missing";
        return v;
    }
    v.state = match read_text(&path).and_then(|t| found_in(c, t.as_deref().unwrap_or(""), name)) {
        Err(_) => "unreadable",
        Ok(Found::None) => "unregistered",
        Ok(Found::Points(p)) => match exe {
            Some(e) if same_place(&p, e) => "registered",
            _ => "stale",
        },
    };
    v.blocked = match c {
        _ if v.state == "unreadable" => Some(E_UNREADABLE),
        Client::ClaudeDesktop if running() => Some("E_AI_APP_RUNNING"),
        Client::ClaudeCode if ctx.find_claude().is_none() => Some("E_AI_APP_NO_COMMAND"),
        _ => None,
    };
    v
}

/// 書く先をまとめた行の状態。見つからない・この OS で使えない書く先は数えない
fn row_state(parts: &[AiAppPart]) -> &'static str {
    let usable: Vec<&str> = parts
        .iter()
        .map(|p| p.state)
        .filter(|s| !matches!(*s, "missing" | "unsupported"))
        .collect();
    if usable.is_empty() {
        return if parts.iter().all(|p| p.state == "unsupported") {
            "unsupported"
        } else {
            "missing"
        };
    }
    if usable.contains(&"stale") {
        "stale"
    } else if usable.iter().all(|s| *s == "registered") {
        "registered"
    } else if usable.contains(&"registered") {
        "partial"
    } else if usable.contains(&"unregistered") {
        "unregistered"
    } else {
        "unreadable"
    }
}

/// 画面の1行の状態
pub fn row_view(
    ctx: &Ctx,
    row: Row,
    exe: Option<&Path>,
    dev: bool,
    running: impl Fn() -> bool,
) -> AiAppView {
    let parts: Vec<AiAppPart> = row
        .parts()
        .iter()
        .map(|c| view(ctx, *c, exe, dev, &running))
        .collect();
    AiAppView {
        client: row.id(),
        title: row.title(),
        state: row_state(&parts),
        parts,
    }
}

/// 名前を差し替えた接続の設定の文面（ai.rs の setup_text は製品の名前で作るので、開発用のビルドの名前に置き換える）
fn setup_text_named(kind: &str, name: &str, runtime: Option<&str>) -> String {
    setup_text(kind, EXE_PLACEHOLDER, runtime)
        .unwrap_or_default()
        .replace("fprise-lifeplan", name)
}

/// 書く前に元のファイルを控え、同じフォルダの一時ファイルに書いてから置き換える（元のファイルの権限を写す）
pub fn write_with_backup(
    path: &Path,
    original: Option<&str>,
    new_text: &str,
    backups: &Path,
    c: Client,
    stamp: &str,
) -> Result<(), &'static str> {
    if let Some(orig) = original {
        std::fs::create_dir_all(backups).map_err(|_| "E_AI_APP_BACKUP")?;
        let file = path
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        let b = backups.join(format!("{}-{stamp}-{file}", c.id()));
        std::fs::write(&b, orig).map_err(|_| "E_AI_APP_BACKUP")?;
    }
    let dir = path.parent().ok_or("E_AI_APP_WRITE")?;
    std::fs::create_dir_all(dir).map_err(|_| "E_AI_APP_WRITE")?;
    let tmp = dir.join(format!(
        ".{}.fprise-tmp",
        path.file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default()
    ));
    std::fs::write(&tmp, new_text).map_err(|_| "E_AI_APP_WRITE")?;
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, path).map_err(|_| {
        let _ = std::fs::remove_file(&tmp);
        "E_AI_APP_WRITE"
    })
}

/// 1つの書く先に登録する（すでにあれば場所だけ直す）。Claude のアプリは、書く必要があるのに起動中なら書かずに止める
/// （登録済みで直す所が無ければ、起動中でも止めない）
pub fn register(
    ctx: &Ctx,
    c: Client,
    exe: &Path,
    runtime: Option<&str>,
    backups: &Path,
    stamp: &str,
    running: impl Fn() -> bool,
) -> Result<(), &'static str> {
    if let Some(p) = location_problem(Some(exe)) {
        return Err(p);
    }
    let name = server_name();
    let exe_s = exe.to_string_lossy().into_owned();
    if !ctx.installed(c) {
        return Err("E_AI_APP_MISSING");
    }
    match c {
        Client::ClaudeCode => claude_code_register(ctx, name, exe, runtime),
        _ => {
            let path = ctx.config_path(c).ok_or("E_AI_APP_MISSING")?;
            let original = read_text(&path)?;
            let text = original.as_deref().unwrap_or("");
            let new_text = match c {
                Client::Codex => toml_set(text, name, &exe_s, runtime)?,
                _ => json_set(text, name, &exe_s, runtime)?,
            };
            if original.as_deref() == Some(new_text.as_str()) {
                return Ok(());
            }
            if c == Client::ClaudeDesktop && running() {
                return Err("E_AI_APP_RUNNING");
            }
            write_with_backup(&path, original.as_deref(), &new_text, backups, c, stamp)
        }
    }
}

/// 片方の書く先だけ登録できないときに、行の登録を止めない理由（見つからない・起動中・コマンドが無い・設定を読めない）。
/// これ以外（書き込めない・コマンドが失敗した など）は失敗として返す
fn can_skip(e: &str) -> bool {
    matches!(
        e,
        "E_AI_APP_MISSING" | "E_AI_APP_RUNNING" | "E_AI_APP_NO_COMMAND" | E_UNREADABLE
    )
}

/// 飛ばした理由のうち、画面に出す1つ（直せる順: 起動中 → 読めない → コマンドが無い → 見つからない）
fn first_reason(skipped: &[&'static str]) -> Option<&'static str> {
    [
        "E_AI_APP_RUNNING",
        E_UNREADABLE,
        "E_AI_APP_NO_COMMAND",
        "E_AI_APP_MISSING",
    ]
    .into_iter()
    .find(|r| skipped.contains(r))
}

/// 行の登録（0228 の追記 2026-11-20）。Claude の行は、チャットのアプリと Claude Code の両方に登録する。
/// 片方だけ登録できないとき（アプリが起動中・claude コマンドが無い・片方がこの PC に無い）は、できる側だけ登録して Ok を返す
/// （画面は、返した状態から「片方だけ登録した」ことを出す）。どちらも登録できなければ、その理由を返す
pub fn register_row(
    ctx: &Ctx,
    row: Row,
    exe: &Path,
    runtime: Option<&str>,
    backups: &Path,
    stamp: &str,
    running: impl Fn() -> bool,
) -> Result<(), &'static str> {
    let mut done = false;
    let mut failed = None;
    let mut skipped = Vec::new();
    for c in row.parts() {
        match register(ctx, *c, exe, runtime, backups, stamp, &running) {
            Ok(()) => done = true,
            Err(e) if can_skip(e) => skipped.push(e),
            Err(e) => failed = failed.or(Some(e)),
        }
    }
    match (failed, done) {
        (Some(e), _) => Err(e),
        (None, true) => Ok(()),
        (None, false) => Err(first_reason(&skipped).unwrap_or("E_AI_APP_MISSING")),
    }
}

/// 行の登録を外す。Claude の行は両方から外す。片方を外せなくても（アプリが起動中 など）もう片方は外し、外せなかった理由を返す
pub fn unregister_row(
    ctx: &Ctx,
    row: Row,
    backups: &Path,
    stamp: &str,
    running: impl Fn() -> bool,
) -> Result<(), &'static str> {
    let mut failed = None;
    let mut held = Vec::new();
    for c in row.parts() {
        match unregister(ctx, *c, backups, stamp, &running) {
            Ok(()) => {}
            Err(e) if can_skip(e) => held.push(e),
            Err(e) => failed = failed.or(Some(e)),
        }
    }
    match failed.or_else(|| first_reason(&held)) {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// 1つの書く先から登録を外す（自分の名前の所だけ。無ければ何もしない）
pub fn unregister(
    ctx: &Ctx,
    c: Client,
    backups: &Path,
    stamp: &str,
    running: impl Fn() -> bool,
) -> Result<(), &'static str> {
    let name = server_name();
    match c {
        Client::ClaudeCode => claude_code_remove(ctx, name),
        _ => {
            // この OS に無い書く先（Linux の Claude のアプリ）には、外す物が無い
            let Some(path) = ctx.config_path(c) else {
                return Ok(());
            };
            let Some(original) = read_text(&path)? else {
                return Ok(());
            };
            let removed = match c {
                Client::Codex => toml_remove(&original, name)?,
                _ => json_remove(&original, name)?,
            };
            match removed {
                None => Ok(()),
                Some(_) if c == Client::ClaudeDesktop && running() => Err("E_AI_APP_RUNNING"),
                Some(t) => write_with_backup(&path, Some(&original), &t, backups, c, stamp),
            }
        }
    }
}

/// `claude mcp add` の引数（呼ぶ前に画面に見せる文面と同じ形）
pub fn claude_add_args(name: &str, exe: &str, runtime: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["mcp", "add", "--transport", "stdio", "--scope", "user"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some(r) = runtime {
        a.push("-e".into());
        a.push(format!("{}={r}", ai_ipc::discovery::RUNTIME_DIR_ENV));
    }
    a.extend([name.to_owned(), "--".into(), exe.to_owned(), "mcp".into()]);
    a
}

fn run_claude(ctx: &Ctx, args: &[String]) -> Result<bool, &'static str> {
    let claude = ctx.find_claude().ok_or("E_AI_APP_NO_COMMAND")?;
    // npm で入れた claude は node を探すので、claude の場所とよく使う場所を PATH の前に足す
    let mut dirs: Vec<PathBuf> = claude
        .parent()
        .map(|p| vec![p.to_path_buf()])
        .unwrap_or_default();
    dirs.extend(ctx.path_dirs.iter().cloned());
    let path = std::env::join_paths(dirs).ok();
    let mut cmd = std::process::Command::new(&claude);
    cmd.args(args)
        .current_dir(&ctx.home)
        .env(
            if ctx.os == Os::Windows {
                "USERPROFILE"
            } else {
                "HOME"
            },
            &ctx.home,
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
    cmd.status()
        .map(|s| s.success())
        .map_err(|_| "E_AI_APP_COMMAND")
}

fn claude_code_found(ctx: &Ctx, name: &str) -> Found {
    read_text(&ctx.home.join(".claude.json"))
        .ok()
        .flatten()
        .and_then(|t| json_found(&t, name).ok())
        .unwrap_or(Found::None)
}

fn claude_code_register(
    ctx: &Ctx,
    name: &str,
    exe: &Path,
    runtime: Option<&str>,
) -> Result<(), &'static str> {
    match claude_code_found(ctx, name) {
        Found::None => {}
        // 登録済みで場所も同じなら呼ばない（Claude の行は、片方だけ登録するときにも両方を通る）
        Found::Points(p) if same_place(&p, exe) => return Ok(()),
        // 場所が古い登録は、外してから足す（claude mcp add は同じ名前があると断る）
        Found::Points(_) => {
            run_claude(
                ctx,
                &["mcp", "remove", "--scope", "user", name].map(String::from),
            )?;
        }
    }
    if !run_claude(ctx, &claude_add_args(name, &exe.to_string_lossy(), runtime))? {
        return Err("E_AI_APP_COMMAND");
    }
    Ok(())
}

fn claude_code_remove(ctx: &Ctx, name: &str) -> Result<(), &'static str> {
    if claude_code_found(ctx, name) == Found::None {
        return Ok(());
    }
    if !run_claude(
        ctx,
        &["mcp", "remove", "--scope", "user", name].map(String::from),
    )? {
        return Err("E_AI_APP_COMMAND");
    }
    Ok(())
}

// ------------------------------------------------------------------ 命令（パスを受け取らない・返さない）

fn status_of(ctx: &Ctx, exe: Option<&Path>) -> AiAppsStatus {
    let dev = cfg!(debug_assertions);
    let problem = match exe {
        None => Some("E_AI_CONNECTOR_MISSING"),
        Some(e) => location_problem(Some(e)),
    };
    let os = ctx.os;
    let running = std::sync::OnceLock::new();
    AiAppsStatus {
        apps: ROWS
            .iter()
            .map(|r| {
                row_view(ctx, *r, exe, dev, || {
                    *running.get_or_init(|| claude_desktop_running(os))
                })
            })
            .collect(),
        server_name: server_name(),
        location_problem: problem,
    }
}

fn stamp() -> String {
    use ai_share::clock::Clock as _;
    ai_share::clock::iso8601(ai_share::clock::SystemClock.now_ms()).replace([':', '.'], "-")
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, &Ctx) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Ctx::from_env().ok_or("E_AI_APP_HOME")?;
        f(&app, &ctx)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "E_AI_APP_BACKUP")?
        .join(BACKUP_DIR))
}

fn runtime_of(app: &AppHandle) -> Option<String> {
    cfg!(debug_assertions).then(|| {
        app.state::<AiState>()
            .runtime_dir()
            .to_string_lossy()
            .into_owned()
    })
}

/// 行（Claude・Codex）ごとの登録の状態
#[tauri::command]
pub async fn ai_apps_status(app: AppHandle) -> Result<AiAppsStatus, String> {
    blocking(app, |_, ctx| {
        Ok(status_of(ctx, connector_path().as_deref()))
    })
    .await
}

/// 行の AI のアプリに登録する（すでにあれば場所だけ直す。Claude の行は両方に）。FP が「登録する」「場所を直す」を押したときだけ呼ぶ
#[tauri::command]
pub async fn ai_app_register(app: AppHandle, client: String) -> Result<AiAppsStatus, String> {
    blocking(app, move |app, ctx| {
        let row = Row::from_id(&client).ok_or("E_AI_CLIENT")?;
        let exe = connector_path().ok_or("E_AI_CONNECTOR_MISSING")?;
        let backups = backups_dir(app)?;
        let os = ctx.os;
        register_row(
            ctx,
            row,
            &exe,
            runtime_of(app).as_deref(),
            &backups,
            &stamp(),
            || claude_desktop_running(os),
        )?;
        Ok(status_of(ctx, Some(&exe)))
    })
    .await
}

/// 行の AI のアプリの登録を外す（自分の名前の所だけ。Claude の行は両方から）
#[tauri::command]
pub async fn ai_app_unregister(app: AppHandle, client: String) -> Result<AiAppsStatus, String> {
    blocking(app, move |app, ctx| {
        let row = Row::from_id(&client).ok_or("E_AI_CLIENT")?;
        let backups = backups_dir(app)?;
        let os = ctx.os;
        unregister_row(ctx, row, &backups, &stamp(), || claude_desktop_running(os))?;
        Ok(status_of(ctx, connector_path().as_deref()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("financia-ai-apps-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ctx(home: &Path, os: Os) -> Ctx {
        Ctx {
            os,
            home: home.to_path_buf(),
            appdata: Some(home.join("AppData/Roaming")),
            local_appdata: Some(home.join("AppData/Local")),
            codex_home: home.join(".codex"),
            path_dirs: vec![home.join("bin")],
            // 本物の /Applications は見ない（Claude のアプリが入っている PC でも同じ答えになるように）
            mac_app_dirs: vec![home.join("Applications")],
        }
    }

    const NAME: &str = "fprise-lifeplan";

    const DESKTOP: &str = r#"{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {"Z": "1", "A": "2"}
    }
  },
  "preferences": {"zeta": true, "alpha": 1},
  "globalShortcut": ""
}
"#;

    #[test]
    fn json_keeps_other_servers_and_fields_verbatim() {
        let out = json_set(
            DESKTOP,
            NAME,
            "/Applications/Financia.app/Contents/MacOS/lifeplan",
            None,
        )
        .unwrap();
        // ほかのサーバーの文は元のまま（キーの順番・書き方も）
        assert!(
            out.contains(r#""args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],"#),
            "{out}"
        );
        assert!(out.contains(r#""env": {"Z": "1", "A": "2"}"#), "{out}");
        assert!(
            out.contains(r#""preferences": {"zeta": true, "alpha": 1}"#),
            "{out}"
        );
        assert!(out.find("\"mcpServers\"").unwrap() < out.find("\"preferences\"").unwrap());
        assert!(out.find("\"filesystem\"").unwrap() < out.find("\"fprise-lifeplan\"").unwrap());
        assert_eq!(
            json_found(&out, NAME).unwrap(),
            Found::Points("/Applications/Financia.app/Contents/MacOS/lifeplan".into())
        );
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"][NAME]["args"], serde_json::json!(["mcp"]));
        assert_eq!(v["mcpServers"]["filesystem"]["command"], "npx");
        assert_eq!(v["globalShortcut"], "");
        // 外すと、元と同じ中身に戻る（ほかの設定は残る）
        let back = json_remove(&out, NAME).unwrap().unwrap();
        let a: serde_json::Value = serde_json::from_str(&back).unwrap();
        let b: serde_json::Value = serde_json::from_str(DESKTOP).unwrap();
        assert_eq!(a, b);
        assert_eq!(json_remove(&back, NAME).unwrap(), None);
    }

    #[test]
    fn json_fixes_only_the_place_and_keeps_own_extra_fields() {
        let with_env = r#"{"other": 1, "mcpServers": {"a": {"command": "a"}, "fprise-lifeplan": {"command": "/old/lifeplan", "env": {"FOO": "bar"}}, "z": {}}}"#;
        let fixed = json_set(with_env, NAME, "/new/lifeplan", None).unwrap();
        // 並びは元のまま（自分の登録も元の場所）
        assert!(fixed.find("\"a\"").unwrap() < fixed.find("\"fprise-lifeplan\"").unwrap());
        assert!(fixed.find("\"fprise-lifeplan\"").unwrap() < fixed.find("\"z\"").unwrap());
        let v: serde_json::Value = serde_json::from_str(&fixed).unwrap();
        assert_eq!(v["mcpServers"][NAME]["command"], "/new/lifeplan");
        assert_eq!(v["mcpServers"][NAME]["env"]["FOO"], "bar");
        // 名前は1つだけ
        assert_eq!(fixed.matches("\"fprise-lifeplan\"").count(), 1);
        // 2回書いても同じ
        assert_eq!(
            json_set(&fixed, NAME, "/new/lifeplan", None).unwrap(),
            fixed
        );
    }

    #[test]
    fn json_new_and_empty_files_and_style() {
        for t in ["", "{}", "\n"] {
            let out = json_set(t, NAME, "/x/lifeplan", None).unwrap();
            let v: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(v["mcpServers"][NAME]["command"], "/x/lifeplan");
        }
        // Windows の改行と BOM は残す
        let crlf = "\u{feff}{\r\n  \"a\": 1\r\n}\r\n";
        let out = json_set(
            crlf,
            NAME,
            "C:\\Users\\u\\AppData\\Local\\Financia\\lifeplan.exe",
            None,
        )
        .unwrap();
        assert!(out.starts_with('\u{feff}'));
        assert!(!out.replace("\r\n", "").contains('\n'));
        assert_eq!(
            json_found(&out, NAME).unwrap(),
            Found::Points("C:\\Users\\u\\AppData\\Local\\Financia\\lifeplan.exe".into())
        );
        // 開発用のビルドの作業フォルダ
        let dev = json_set("{}", NAME, "/x/lifeplan", Some("/r")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&dev).unwrap();
        assert_eq!(v["mcpServers"][NAME]["env"]["LIFEPLAN_RUNTIME_DIR"], "/r");
    }

    #[test]
    fn json_refuses_what_it_cannot_read() {
        for t in [
            "// コメント\n{}",
            "[1]",
            "{\"mcpServers\": []}",
            "{\"mcpServers\": {\"fprise-lifeplan\": 1}}",
            "{",
        ] {
            assert_eq!(json_set(t, NAME, "/x", None), Err(E_UNREADABLE), "{t}");
        }
    }

    const CODEX: &str = r#"# 自分のメモ
model = "gpt-5"

[mcp_servers.other]
command = "other"   # 右のコメント
args = ["a"]

[profiles.x]
model = "o3"
"#;

    #[test]
    fn toml_keeps_comments_and_other_tables() {
        let out = toml_set(
            CODEX,
            NAME,
            "/Applications/Financia.app/Contents/MacOS/lifeplan",
            None,
        )
        .unwrap();
        assert!(out.contains("# 自分のメモ"));
        assert!(out.contains("command = \"other\"   # 右のコメント"));
        assert!(out.contains("[profiles.x]"));
        assert!(out.contains("[mcp_servers.fprise-lifeplan]"), "{out}");
        assert_eq!(
            toml_found(&out, NAME).unwrap(),
            Found::Points("/Applications/Financia.app/Contents/MacOS/lifeplan".into())
        );
        let fixed = toml_set(&out, NAME, "/new/lifeplan", None).unwrap();
        assert_eq!(
            toml_found(&fixed, NAME).unwrap(),
            Found::Points("/new/lifeplan".into())
        );
        assert_eq!(fixed.matches("fprise-lifeplan").count(), 1);
        let back = toml_remove(&fixed, NAME).unwrap().unwrap();
        assert!(back.contains("[mcp_servers.other]") && back.contains("# 自分のメモ"));
        assert_eq!(toml_found(&back, NAME).unwrap(), Found::None);
        assert_eq!(toml_remove(&back, NAME).unwrap(), None);
        // 新しいファイル（空の [mcp_servers] の見出しは書かない）
        let new = toml_set("", NAME, "/x", Some("/r")).unwrap();
        assert!(!new.contains("[mcp_servers]\n"), "{new}");
        assert!(new.contains("LIFEPLAN_RUNTIME_DIR = \"/r\""), "{new}");
        assert_eq!(
            toml_set("mcp_servers = 1", NAME, "/x", None),
            Err(E_UNREADABLE)
        );
        assert_eq!(toml_set("[[[", NAME, "/x", None), Err(E_UNREADABLE));
    }

    fn files(home: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(home)
            .map(|r| {
                r.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }

    #[test]
    fn register_backs_up_fixes_and_removes_on_disk() {
        let home = tmp("disk");
        let backups = home.join("backups");
        let c = ctx(&home, Os::Mac);
        let exe = home.join("Financia.app/Contents/MacOS/lifeplan");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, "").unwrap();
        let not_running = || false;

        // 見つからない AI のアプリには書かない
        assert_eq!(
            view(&c, Client::Codex, Some(&exe), false, not_running).state,
            "missing"
        );
        assert_eq!(
            register(&c, Client::Codex, &exe, None, &backups, "s0", not_running),
            Err("E_AI_APP_MISSING")
        );
        assert!(!home.join(".codex").exists());

        // Claude Desktop: 元のファイルを控えて足す
        let cfg = home.join("Library/Application Support/Claude/claude_desktop_config.json");
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, DESKTOP).unwrap();
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&exe), false, not_running).state,
            "unregistered"
        );
        // 起動中は書かない
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&exe), false, || true).blocked,
            Some("E_AI_APP_RUNNING")
        );
        assert_eq!(
            register(
                &c,
                Client::ClaudeDesktop,
                &exe,
                None,
                &backups,
                "s1",
                || true
            ),
            Err("E_AI_APP_RUNNING")
        );
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), DESKTOP);
        register(
            &c,
            Client::ClaudeDesktop,
            &exe,
            None,
            &backups,
            "s1",
            not_running,
        )
        .unwrap();
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&exe), false, not_running).state,
            "registered"
        );
        assert_eq!(
            std::fs::read_to_string(backups.join("claudeDesktop-s1-claude_desktop_config.json"))
                .unwrap(),
            DESKTOP
        );
        // 一時ファイルは残らない
        assert_eq!(
            files(cfg.parent().unwrap()),
            vec!["claude_desktop_config.json".to_owned()]
        );

        // アプリを動かした: 場所が古い → 場所を直す
        let moved = home.join("Moved/Financia.app/Contents/MacOS/lifeplan");
        std::fs::create_dir_all(moved.parent().unwrap()).unwrap();
        std::fs::write(&moved, "").unwrap();
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&moved), false, not_running).state,
            "stale"
        );
        register(
            &c,
            Client::ClaudeDesktop,
            &moved,
            None,
            &backups,
            "s2",
            not_running,
        )
        .unwrap();
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&moved), false, not_running).state,
            "registered"
        );
        // 同じ中身なら書かない（控えも増えない）
        register(
            &c,
            Client::ClaudeDesktop,
            &moved,
            None,
            &backups,
            "s3",
            not_running,
        )
        .unwrap();
        assert!(!backups
            .join("claudeDesktop-s3-claude_desktop_config.json")
            .exists());

        // 外す: ほかのサーバーは残る
        unregister(&c, Client::ClaudeDesktop, &backups, "s4", not_running).unwrap();
        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            after,
            serde_json::from_str::<serde_json::Value>(DESKTOP).unwrap()
        );
        assert_eq!(
            view(&c, Client::ClaudeDesktop, Some(&moved), false, not_running).state,
            "unregistered"
        );

        // 読めない設定は書かない
        std::fs::write(&cfg, "// note\n{}").unwrap();
        let v = view(&c, Client::ClaudeDesktop, Some(&moved), false, not_running);
        assert_eq!((v.state, v.blocked), ("unreadable", Some(E_UNREADABLE)));
        assert_eq!(
            register(
                &c,
                Client::ClaudeDesktop,
                &moved,
                None,
                &backups,
                "s5",
                not_running
            ),
            Err(E_UNREADABLE)
        );
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "// note\n{}");

        // Codex（設定のファイルがまだ無い: 控えは作らずに新しく書く。行の登録は Codex の1つだけ）
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        register_row(&c, Row::Codex, &moved, None, &backups, "s6", not_running).unwrap();
        let row = row_view(&c, Row::Codex, Some(&moved), false, not_running);
        assert_eq!(
            (row.client, row.title, row.state),
            ("codex", "Codex", "registered")
        );
        assert_eq!(row.parts.len(), 1);
        assert!(!backups.join("codex-s6-config.toml").exists());
        unregister_row(&c, Row::Codex, &backups, "s7", not_running).unwrap();
        assert!(backups.join("codex-s7-config.toml").exists());
        assert_eq!(
            toml_found(
                &std::fs::read_to_string(home.join(".codex/config.toml")).unwrap(),
                server_name()
            )
            .unwrap(),
            Found::None
        );
        register_row(&c, Row::Codex, &moved, None, &backups, "s8", not_running).unwrap();

        // 画面に見せる場所はホームを ~ にする。中身は接続口の場所を伏せる
        let v = view(&c, Client::Codex, Some(&moved), false, not_running);
        assert_eq!(v.target, "~/.codex/config.toml");
        assert!(
            v.preview.contains(EXE_PLACEHOLDER) && !v.preview.contains(&*home.to_string_lossy())
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn location_and_platform() {
        assert_eq!(location_problem(Some(Path::new("/private/var/folders/x/T/AppTranslocation/ABC/d/Financia.app/Contents/MacOS/lifeplan"))), Some("E_AI_APP_LOCATION"));
        assert_eq!(
            location_problem(Some(Path::new(
                "/Volumes/Financia/Financia.app/Contents/MacOS/lifeplan"
            ))),
            Some("E_AI_APP_LOCATION")
        );
        assert_eq!(
            location_problem(Some(Path::new(
                "/Applications/Financia.app/Contents/MacOS/lifeplan"
            ))),
            None
        );
        let home = tmp("os");
        let lin = ctx(&home, Os::Linux);
        assert_eq!(
            view(&lin, Client::ClaudeDesktop, None, false, || false).state,
            "unsupported"
        );
        let win = ctx(&home, Os::Windows);
        assert_eq!(
            win.config_path(Client::ClaudeDesktop).unwrap(),
            home.join("AppData/Roaming")
                .join("Claude")
                .join("claude_desktop_config.json")
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn claude_code_args() {
        assert_eq!(
            claude_add_args(NAME, "/A B/lifeplan", None),
            [
                "mcp",
                "add",
                "--transport",
                "stdio",
                "--scope",
                "user",
                NAME,
                "--",
                "/A B/lifeplan",
                "mcp"
            ]
        );
        assert_eq!(
            claude_add_args(NAME, "/x", Some("/r"))[6..8],
            ["-e".to_owned(), "LIFEPLAN_RUNTIME_DIR=/r".to_owned()]
        );
    }

    /// 本物の代わりの claude（受け取った引数を、一時フォルダのホームの .claude.json に写すだけ）を一時フォルダの bin に置く。
    /// 呼ばれた引数を1行ずつ書くファイルの場所を返す
    #[cfg(unix)]
    fn fake_claude(home: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let name = server_name();
        std::fs::create_dir_all(home.join("bin")).unwrap();
        let fake = home.join("bin/claude");
        let log = home.join("calls.txt");
        std::fs::write(
            &fake,
            format!(
                "#!/bin/sh\necho \"$@\" >> '{log}'\nif [ \"$2\" = add ]; then shift 7; printf '{{\"mcpServers\":{{\"{name}\":{{\"command\":\"%s\"}}}}}}' \"$2\" > \"$HOME/.claude.json\"; fi\nif [ \"$2\" = remove ]; then printf '{{}}' > \"$HOME/.claude.json\"; fi\n",
                log = log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        log
    }

    /// Claude のアプリの設定のファイルを、一時フォルダのホームに置く（ほかのサーバーの設定が入っている）
    fn desktop_config(home: &Path) -> PathBuf {
        let cfg = home.join("Library/Application Support/Claude/claude_desktop_config.json");
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, DESKTOP).unwrap();
        cfg
    }

    fn connector(home: &Path) -> PathBuf {
        let exe = home.join("Financia.app/Contents/MacOS/lifeplan");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, "").unwrap();
        exe
    }

    fn states(v: &AiAppView) -> Vec<(&'static str, &'static str, Option<&'static str>)> {
        v.parts.iter().map(|p| (p.id, p.state, p.blocked)).collect()
    }

    #[cfg(unix)]
    fn lines(log: &Path) -> Vec<String> {
        std::fs::read_to_string(log)
            .map(|t| t.lines().map(str::to_owned).collect())
            .unwrap_or_default()
    }

    /// Claude の行・両方あり: 1回で、チャットのアプリの設定のファイルと Claude Code の両方に登録し、外すのも1回で両方
    #[cfg(unix)]
    #[test]
    fn claude_row_registers_both() {
        let name = server_name();
        let home = tmp("row-both");
        let c = ctx(&home, Os::Mac);
        let exe = connector(&home);
        let backups = home.join("backups");
        let cfg = desktop_config(&home);
        let log = fake_claude(&home);
        let v = row_view(&c, Row::Claude, Some(&exe), false, || false);
        assert_eq!(
            (v.client, v.title, v.state),
            ("claude", "Claude", "unregistered")
        );
        assert_eq!(
            v.parts.iter().map(|p| p.label).collect::<Vec<_>>(),
            ["チャット（アプリ）", "Claude Code"]
        );
        assert_eq!(
            states(&v),
            [
                ("claudeDesktop", "unregistered", None),
                ("claudeCode", "unregistered", None)
            ]
        );
        register_row(&c, Row::Claude, &exe, None, &backups, "s1", || false).unwrap();
        let v = row_view(&c, Row::Claude, Some(&exe), false, || false);
        assert_eq!(v.state, "registered");
        assert_eq!(
            json_found(&std::fs::read_to_string(&cfg).unwrap(), name).unwrap(),
            Found::Points(exe.to_string_lossy().into_owned())
        );
        assert_eq!(
            json_found(
                &std::fs::read_to_string(home.join(".claude.json")).unwrap(),
                name
            )
            .unwrap(),
            Found::Points(exe.to_string_lossy().into_owned())
        );
        assert_eq!(
            std::fs::read_to_string(backups.join("claudeDesktop-s1-claude_desktop_config.json"))
                .unwrap(),
            DESKTOP
        );
        // もう一度押しても、書かない・呼ばない
        register_row(&c, Row::Claude, &exe, None, &backups, "s2", || false).unwrap();
        assert!(!backups
            .join("claudeDesktop-s2-claude_desktop_config.json")
            .exists());
        assert_eq!(lines(&log).len(), 1);
        // アプリを動かした: どちらも「場所が古い」→ 1回で両方を直す
        let moved = home.join("Moved/lifeplan");
        std::fs::create_dir_all(moved.parent().unwrap()).unwrap();
        std::fs::write(&moved, "").unwrap();
        assert_eq!(
            row_view(&c, Row::Claude, Some(&moved), false, || false).state,
            "stale"
        );
        register_row(&c, Row::Claude, &moved, None, &backups, "s3", || false).unwrap();
        assert_eq!(
            row_view(&c, Row::Claude, Some(&moved), false, || false).state,
            "registered"
        );
        // 外すのも1回で両方（ほかのサーバーの設定は残る）
        unregister_row(&c, Row::Claude, &backups, "s4", || false).unwrap();
        let v = row_view(&c, Row::Claude, Some(&moved), false, || false);
        assert_eq!(v.state, "unregistered");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&cfg).unwrap())
                .unwrap(),
            serde_json::from_str::<serde_json::Value>(DESKTOP).unwrap()
        );
        assert_eq!(
            lines(&log),
            [
                format!(
                    "mcp add --transport stdio --scope user {name} -- {} mcp",
                    exe.display()
                ),
                format!("mcp remove --scope user {name}"),
                format!(
                    "mcp add --transport stdio --scope user {name} -- {} mcp",
                    moved.display()
                ),
                format!("mcp remove --scope user {name}"),
            ]
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Claude の行・アプリが起動中: Claude Code の側だけ登録し、設定のファイルには触らない。終了してからもう一度押すと両方になる
    #[cfg(unix)]
    #[test]
    fn claude_row_while_the_app_is_running() {
        let home = tmp("row-running");
        let c = ctx(&home, Os::Mac);
        let exe = connector(&home);
        let backups = home.join("backups");
        let cfg = desktop_config(&home);
        let log = fake_claude(&home);
        let v = row_view(&c, Row::Claude, Some(&exe), false, || true);
        assert_eq!(
            states(&v),
            [
                ("claudeDesktop", "unregistered", Some("E_AI_APP_RUNNING")),
                ("claudeCode", "unregistered", None)
            ]
        );
        register_row(&c, Row::Claude, &exe, None, &backups, "s1", || true).unwrap();
        // 設定のファイルは元のまま（控えも一時ファイルも作らない）
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), DESKTOP);
        assert!(!backups.exists());
        assert_eq!(
            files(cfg.parent().unwrap()),
            vec!["claude_desktop_config.json".to_owned()]
        );
        let v = row_view(&c, Row::Claude, Some(&exe), false, || true);
        assert_eq!(v.state, "partial");
        assert_eq!(
            states(&v),
            [
                ("claudeDesktop", "unregistered", Some("E_AI_APP_RUNNING")),
                ("claudeCode", "registered", None)
            ]
        );
        // 起動中のままもう一度押しても同じ（claude も呼び直さない）
        register_row(&c, Row::Claude, &exe, None, &backups, "s2", || true).unwrap();
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), DESKTOP);
        assert_eq!(lines(&log).len(), 1);
        // 終了してからもう一度押すと、チャットのアプリの側にも登録する
        register_row(&c, Row::Claude, &exe, None, &backups, "s3", || false).unwrap();
        assert_eq!(
            row_view(&c, Row::Claude, Some(&exe), false, || false).state,
            "registered"
        );
        assert_eq!(lines(&log).len(), 1);
        // 両方に登録済みなら、起動中に押しても止めない（書く物が無い）
        register_row(&c, Row::Claude, &exe, None, &backups, "s4", || true).unwrap();
        // 起動中に外す: Claude Code の側だけ外し、起動中だと返す（設定のファイルは変えない）
        let before = std::fs::read_to_string(&cfg).unwrap();
        assert_eq!(
            unregister_row(&c, Row::Claude, &backups, "s5", || true),
            Err("E_AI_APP_RUNNING")
        );
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), before);
        assert_eq!(
            states(&row_view(&c, Row::Claude, Some(&exe), false, || true)),
            [
                ("claudeDesktop", "registered", Some("E_AI_APP_RUNNING")),
                ("claudeCode", "unregistered", None)
            ]
        );
        // Claude Code の側も登録できないとき（claude コマンドが無い）に起動中なら、何も書かずに起動中だと返す
        let home2 = tmp("row-running-only");
        let c2 = ctx(&home2, Os::Mac);
        let cfg2 = desktop_config(&home2);
        assert_eq!(
            register_row(&c2, Row::Claude, &exe, None, &backups, "s6", || true),
            Err("E_AI_APP_RUNNING")
        );
        assert_eq!(std::fs::read_to_string(&cfg2).unwrap(), DESKTOP);
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&home2);
    }

    /// Claude の行・claude コマンドが無い: チャットのアプリの側だけ登録する
    #[test]
    fn claude_row_without_the_claude_command() {
        let name = server_name();
        let home = tmp("row-no-command");
        let c = ctx(&home, Os::Mac);
        let exe = connector(&home);
        let backups = home.join("backups");
        let cfg = desktop_config(&home);
        // Claude Code を使ったことが無い PC（claude コマンドも ~/.claude.json も無い）
        assert_eq!(
            states(&row_view(&c, Row::Claude, Some(&exe), false, || false)),
            [
                ("claudeDesktop", "unregistered", None),
                ("claudeCode", "missing", None)
            ]
        );
        register_row(&c, Row::Claude, &exe, None, &backups, "s1", || false).unwrap();
        assert_eq!(
            json_found(&std::fs::read_to_string(&cfg).unwrap(), name).unwrap(),
            Found::Points(exe.to_string_lossy().into_owned())
        );
        assert!(!home.join(".claude.json").exists());
        // 使える側がすべて登録済みなら、行は「登録済み」
        assert_eq!(
            row_view(&c, Row::Claude, Some(&exe), false, || false).state,
            "registered"
        );
        unregister_row(&c, Row::Claude, &backups, "s2", || false).unwrap();
        // Claude Code の設定はあるが claude コマンドが見つからない PC: 読むだけのファイルには書かない
        std::fs::write(home.join(".claude.json"), "{\"numStartups\": 3}").unwrap();
        assert_eq!(
            states(&row_view(&c, Row::Claude, Some(&exe), false, || false)),
            [
                ("claudeDesktop", "unregistered", None),
                ("claudeCode", "unregistered", Some("E_AI_APP_NO_COMMAND"))
            ]
        );
        register_row(&c, Row::Claude, &exe, None, &backups, "s3", || false).unwrap();
        assert_eq!(
            std::fs::read_to_string(home.join(".claude.json")).unwrap(),
            "{\"numStartups\": 3}"
        );
        assert_eq!(
            row_view(&c, Row::Claude, Some(&exe), false, || false).state,
            "partial"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Claude の行・どちらも無い: 何も書かずに「見つかりません」。チャットのアプリが無い PC は Claude Code の側だけ登録する
    #[test]
    fn claude_row_with_neither() {
        let home = tmp("row-neither");
        let exe = connector(&home);
        let backups = home.join("backups");
        for os in [Os::Mac, Os::Windows, Os::Linux] {
            let c = ctx(&home, os);
            let v = row_view(&c, Row::Claude, Some(&exe), false, || false);
            assert_eq!(v.state, "missing", "{os:?}");
            assert_eq!(
                register_row(&c, Row::Claude, &exe, None, &backups, "s", || false),
                Err("E_AI_APP_MISSING"),
                "{os:?}"
            );
            // 外す物も無い（エラーにしない）
            assert_eq!(
                unregister_row(&c, Row::Claude, &backups, "s", || false),
                Ok(()),
                "{os:?}"
            );
        }
        assert_eq!(files(&home), vec!["Financia.app".to_owned()]);
        // Windows: Claude のアプリのフォルダ（%APPDATA%\Claude）があれば、そこの設定のファイルに書く
        let win = ctx(&home, Os::Windows);
        std::fs::create_dir_all(home.join("AppData/Roaming/Claude")).unwrap();
        register_row(&win, Row::Claude, &exe, None, &backups, "w", || false).unwrap();
        assert_eq!(
            json_found(
                &std::fs::read_to_string(
                    home.join("AppData/Roaming/Claude/claude_desktop_config.json")
                )
                .unwrap(),
                server_name()
            )
            .unwrap(),
            Found::Points(exe.to_string_lossy().into_owned())
        );
        assert_eq!(
            row_view(&win, Row::Claude, Some(&exe), false, || false).state,
            "registered"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// チャットのアプリが無い PC（Linux など）: Claude Code の側だけ登録する
    #[cfg(unix)]
    #[test]
    fn claude_row_without_the_desktop_app() {
        let home = tmp("row-no-desktop");
        let exe = connector(&home);
        let backups = home.join("backups");
        fake_claude(&home);
        for (os, desktop) in [(Os::Mac, "missing"), (Os::Linux, "unsupported")] {
            let c = ctx(&home, os);
            assert_eq!(
                states(&row_view(&c, Row::Claude, Some(&exe), false, || false)),
                [
                    ("claudeDesktop", desktop, None),
                    ("claudeCode", "unregistered", None)
                ]
            );
            register_row(&c, Row::Claude, &exe, None, &backups, "s", || false).unwrap();
            assert_eq!(
                row_view(&c, Row::Claude, Some(&exe), false, || false).state,
                "registered"
            );
            unregister_row(&c, Row::Claude, &backups, "s", || false).unwrap();
            assert!(!home.join("Library").exists());
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 本物の代わりの claude で、登録・場所の直し・外すの呼び方を確かめる
    #[cfg(unix)]
    #[test]
    fn claude_code_through_command() {
        let name = server_name();
        let home = tmp("claude");
        let c = ctx(&home, Os::Mac);
        let exe = home.join("lifeplan");
        std::fs::write(&exe, "").unwrap();
        let backups = home.join("backups");
        let v = view(&c, Client::ClaudeCode, Some(&exe), false, || false);
        assert_eq!(v.state, "missing");
        let log = fake_claude(&home);
        assert_eq!(
            view(&c, Client::ClaudeCode, Some(&exe), false, || false).state,
            "unregistered"
        );
        register(&c, Client::ClaudeCode, &exe, None, &backups, "s", || false).unwrap();
        assert_eq!(
            view(&c, Client::ClaudeCode, Some(&exe), false, || false).state,
            "registered"
        );
        let moved = home.join("moved-lifeplan");
        std::fs::write(&moved, "").unwrap();
        assert_eq!(
            view(&c, Client::ClaudeCode, Some(&moved), false, || false).state,
            "stale"
        );
        register(&c, Client::ClaudeCode, &moved, None, &backups, "s", || {
            false
        })
        .unwrap();
        unregister(&c, Client::ClaudeCode, &backups, "s", || false).unwrap();
        let calls = std::fs::read_to_string(&log).unwrap();
        assert_eq!(
            calls.lines().collect::<Vec<_>>(),
            [
                format!(
                    "mcp add --transport stdio --scope user {name} -- {} mcp",
                    exe.display()
                ),
                format!("mcp remove --scope user {name}"),
                format!(
                    "mcp add --transport stdio --scope user {name} -- {} mcp",
                    moved.display()
                ),
                format!("mcp remove --scope user {name}"),
            ]
        );
        let _ = std::fs::remove_dir_all(&home);
    }
}
