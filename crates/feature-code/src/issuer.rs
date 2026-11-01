//! 発行の道具の部品（提供元だけが使う。アプリ本体は使わない）: 秘密鍵のファイル・発行の記録の CSV・一覧からまとめて発行する。
//!
//! - 秘密鍵と記録の CSV はリポジトリに入れない。置き場所は引数で受け取り、既定はリポジトリの外（ホームの `.lifeplan-issuer/`。
//!   環境変数 `LIFEPLAN_ISSUER_DIR` で変えられる）。git の作業フォルダの中の場所は断る（[`outside_repository`]）。
//! - 記録の CSV の列は `id,name,features,expires,issued`（機能は「;」で区切る）。表計算で開けるよう、作るときに UTF-8 の BOM を付ける。
//! - まとめて発行するときは、全部の行を先に確かめ（番号の重なりを含む）、1つでも誤りがあれば1件も発行しない。

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use crate::{decode_unverified, issue, parse_date, Claims, Request, SecretKey};

pub const LOG_HEADER: &str = "id,name,features,expires,issued";
const BOM: &str = "\u{feff}";

/// 既定の置き場所（リポジトリの外）
pub fn default_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("LIFEPLAN_ISSUER_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(d));
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|v| !v.is_empty())?;
    Some(PathBuf::from(home).join(".lifeplan-issuer"))
}

/// git の作業フォルダの中なら Err（秘密鍵・記録をリポジトリに入れないため）
pub fn outside_repository(path: &Path) -> Result<(), String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| "今のフォルダを読めません".to_owned())?
            .join(path)
    };
    let mut cur = abs.parent();
    while let Some(d) = cur {
        if d.join(".git").exists() {
            return Err(format!(
                "{} は git の作業フォルダ（{}）の中です。秘密鍵と発行の記録はリポジトリの外に置いてください",
                abs.display(),
                d.display()
            ));
        }
        cur = d.parent();
    }
    Ok(())
}

/// 秘密鍵を作ってファイルに書く（既にあれば止める。Unix では持ち主だけが読める 0600）
pub fn write_new_key(path: &Path, key: &SecretKey) -> Result<(), String> {
    outside_repository(path)?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir).map_err(|e| format!("フォルダを作れません: {e}"))?;
    }
    let mut o = OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        o.mode(0o600);
    }
    let mut f = o.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            format!("{} は既にあります（上書きしません）", path.display())
        } else {
            format!("{} に書けません: {e}", path.display())
        }
    })?;
    f.write_all(key.to_text().as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| format!("{} に書けません: {e}", path.display()))
}

pub fn read_key(path: &Path) -> Result<SecretKey, String> {
    let text = zeroize::Zeroizing::new(
        fs::read_to_string(path).map_err(|e| format!("秘密鍵 {} を読めません: {e}", path.display()))?,
    );
    SecretKey::from_text(&text)
}

// ---- CSV（RFC 4180 の範囲。引用符・カンマ・改行を含む欄は "…" で囲む）----

pub fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_owned()
    }
}

/// CSV を行と欄に分ける（最初の BOM は外す。空の行は飛ばす）
pub fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let text = text.strip_prefix(BOM).unwrap_or(text);
    let mut rows = vec![];
    let mut row = vec![];
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    field.push('"');
                }
                '"' => quoted = false,
                _ => field.push(c),
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                if !(row.len() == 1 && row[0].is_empty()) {
                    rows.push(std::mem::take(&mut row));
                }
                row.clear();
            }
            _ => field.push(c),
        }
    }
    if quoted {
        return Err("CSV の引用符が閉じていません".into());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}

pub fn record_line(c: &Claims) -> String {
    [
        csv_field(&c.id),
        csv_field(&c.name),
        csv_field(&c.features.join(";")),
        csv_field(&c.expires),
        csv_field(&c.issued),
    ]
    .join(",")
}

/// 記録の CSV に既にある番号（ファイルが無ければ空）
pub fn logged_ids(log: &Path) -> Result<Vec<String>, String> {
    if !log.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(log).map_err(|e| format!("記録 {} を読めません: {e}", log.display()))?;
    let rows = parse_csv(&text)?;
    let Some((head, body)) = rows.split_first() else {
        return Ok(vec![]);
    };
    if head.join(",") != LOG_HEADER {
        return Err(format!(
            "記録 {} の見出しの行が「{LOG_HEADER}」ではありません",
            log.display()
        ));
    }
    Ok(body.iter().filter_map(|r| r.first().cloned()).collect())
}

/// 記録の CSV に行を足す（無ければ BOM と見出しの行から作る）。既にある番号は断る
pub fn append_records(log: &Path, claims: &[Claims]) -> Result<(), String> {
    outside_repository(log)?;
    let have = logged_ids(log)?;
    for (i, c) in claims.iter().enumerate() {
        if have.contains(&c.id) || claims[..i].iter().any(|x| x.id == c.id) {
            return Err(format!("番号 {} は記録に既にあります", c.id));
        }
    }
    if let Some(dir) = log.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir).map_err(|e| format!("フォルダを作れません: {e}"))?;
    }
    let new = !log.exists();
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| format!("記録 {} に書けません: {e}", log.display()))?;
    let mut out = String::new();
    if new {
        out.push_str(BOM);
        out.push_str(LOG_HEADER);
        out.push('\n');
    }
    for c in claims {
        out.push_str(&record_line(c));
        out.push('\n');
    }
    f.write_all(out.as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| format!("記録 {} に書けません: {e}", log.display()))
}

/// 記録の次の番号（数字だけの番号のいちばん大きいもの＋1。4桁にそろえる）
pub fn next_id(existing: &[String]) -> String {
    let max = existing
        .iter()
        .filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
        .filter_map(|s| s.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    format!("{:04}", max + 1)
}

/// 「combinedBs;other」「combinedBs, other」を機能の名前の並びに
pub fn split_features(s: &str) -> Vec<String> {
    s.split([';', ',', ' '])
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(str::to_owned)
        .collect()
}

/// 一覧の1行（番号が空なら記録から振る）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchRow {
    pub id: Option<String>,
    pub name: String,
    pub features: Vec<String>,
    pub expires: String,
    pub issued: Option<String>,
}

/// 一覧の CSV（見出しの行に name・features・expires が要る。id・issued は任意）を読む
pub fn read_batch(text: &str) -> Result<Vec<BatchRow>, String> {
    let rows = parse_csv(text)?;
    let Some((head, body)) = rows.split_first() else {
        return Err("一覧が空です".into());
    };
    let col = |n: &str| head.iter().position(|h| h.trim() == n);
    let (Some(name), Some(features), Some(expires)) = (col("name"), col("features"), col("expires"))
    else {
        return Err("一覧の見出しの行に name・features・expires の列が要ります（id・issued は任意）".into());
    };
    let (id, issued) = (col("id"), col("issued"));
    let get = |r: &[String], i: usize| r.get(i).map(|s| s.trim().to_owned()).unwrap_or_default();
    Ok(body
        .iter()
        .map(|r| BatchRow {
            id: id.map(|i| get(r, i)).filter(|s| !s.is_empty()),
            name: get(r, name),
            features: split_features(&get(r, features)),
            expires: get(r, expires),
            issued: issued.map(|i| get(r, i)).filter(|s| !s.is_empty()),
        })
        .collect())
}

/// まとめて発行する（全部の行を先に確かめる。番号の無い行は、記録と一覧の番号の続きから振る）。
/// 返すのは（中身, コード）の並び。記録への書き込みは呼ぶ側（[`append_records`]）
pub fn issue_batch(
    key: &SecretKey,
    rows: &[BatchRow],
    logged: &[String],
    today: &str,
) -> Result<Vec<(Claims, String)>, String> {
    let mut used: Vec<String> = logged.to_vec();
    used.extend(rows.iter().filter_map(|r| r.id.clone()));
    let mut out = vec![];
    let mut errors = vec![];
    let mut seen: Vec<String> = vec![];
    for (i, r) in rows.iter().enumerate() {
        let line = i + 2;
        let id = match &r.id {
            Some(id) => id.clone(),
            None => {
                let n = next_id(&used);
                used.push(n.clone());
                n
            }
        };
        if logged.contains(&id) || seen.contains(&id) {
            errors.push(format!("{line}行目: 番号 {id} は記録か一覧に既にあります"));
            continue;
        }
        seen.push(id.clone());
        if let Some(p) = expires_problem(&r.expires, today) {
            errors.push(format!("{line}行目: {p}"));
            continue;
        }
        let req = Request {
            id,
            name: r.name.clone(),
            features: r.features.clone(),
            issued: r.issued.clone().unwrap_or_else(|| today.to_owned()),
            expires: r.expires.clone(),
        };
        match issue(key, &req) {
            Ok(code) => match decode_unverified(&code) {
                Ok(c) => out.push((c, code)),
                Err(e) => errors.push(format!("{line}行目: {e}")),
            },
            Err(e) => errors.push(format!("{line}行目: {e}")),
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    Ok(out)
}

/// 期限の目安の確かめ（発行日より前・今日より前の期限は道具が止める）
pub fn expires_problem(expires: &str, today: &str) -> Option<String> {
    let (Some(e), Some(t)) = (parse_date(expires), parse_date(today)) else {
        return Some(format!("期限「{expires}」は YYYY-MM-DD の形の、ある日付にしてください"));
    };
    (e < t).then(|| format!("期限 {expires} は今日（{today}）より前です"))
}
