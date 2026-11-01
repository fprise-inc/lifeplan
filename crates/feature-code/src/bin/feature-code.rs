//! 機能を有効にするコードの発行の道具（提供元だけが使う。0110）。
//!
//! ```text
//! feature-code keygen   [--key <秘密鍵>] [--kid <鍵の名前>]
//! feature-code public   [--key <秘密鍵>]
//! feature-code issue    [--key <秘密鍵>] [--log <記録.csv> | --no-log] [--id <番号>] --name <名前> --features <機能;…> --expires <YYYY-MM-DD> [--issued <YYYY-MM-DD>]
//! feature-code batch    [--key <秘密鍵>] [--log <記録.csv> | --no-log] --input <一覧.csv> [--out <結果.csv>]
//! feature-code record   [--log <記録.csv>] [--key <秘密鍵>] <コード>
//! feature-code show     [--key <秘密鍵>] <コード>
//! feature-code features
//! ```
//!
//! 既定の置き場所はリポジトリの外（`~/.lifeplan-issuer/signing.key`・`~/.lifeplan-issuer/issued.csv`。`LIFEPLAN_ISSUER_DIR` で変えられる）。

use std::path::PathBuf;
use std::process::ExitCode;

use feature_code::issuer::{self, BatchRow};
use feature_code::{decode_unverified, issue, verify, Claims, Request, FEATURES};

const USAGE: &str = "使い方:
  feature-code keygen   [--key <秘密鍵>] [--kid <鍵の名前>]       秘密鍵を作る（既にあれば止める）。配布元の設定に書く公開鍵の行を出す
  feature-code public   [--key <秘密鍵>]                          公開鍵の行を出す
  feature-code issue    [--key <秘密鍵>] [--log <記録.csv> | --no-log] [--id <番号>]
                        --name <名前> --features <機能;…> --expires <YYYY-MM-DD> [--issued <YYYY-MM-DD>]
                                                                  コードを1つ発行して出し、記録に1行足す（番号を省くと記録の続きの番号）
  feature-code batch    [--key <秘密鍵>] [--log <記録.csv> | --no-log] --input <一覧.csv> [--out <結果.csv>]
                                                                  一覧（列: id・name・features・expires・issued。id と issued は任意）からまとめて発行する
  feature-code record   [--log <記録.csv>] [--key <秘密鍵>] <コード>  発行したコードの中身を記録に1行足す
  feature-code show     [--key <秘密鍵>] <コード>                  コードの中身を見る（秘密鍵があれば署名も確かめる）
  feature-code features                                           機能の名前の一覧

既定の置き場所: ~/.lifeplan-issuer/signing.key（秘密鍵）・~/.lifeplan-issuer/issued.csv（記録）。LIFEPLAN_ISSUER_DIR で変えられる。
秘密鍵と記録は、リポジトリの外に置く（git の作業フォルダの中は断る）。";

struct Args {
    flags: Vec<(String, Option<String>)>,
    rest: Vec<String>,
}

impl Args {
    fn parse(v: &[String]) -> Result<Args, String> {
        let mut flags = vec![];
        let mut rest = vec![];
        let mut i = 0;
        while i < v.len() {
            let a = &v[i];
            if let Some(name) = a.strip_prefix("--") {
                if name == "no-log" {
                    flags.push((name.to_owned(), None));
                } else {
                    let val = v
                        .get(i + 1)
                        .ok_or_else(|| format!("--{name} の値がありません"))?;
                    flags.push((name.to_owned(), Some(val.clone())));
                    i += 1;
                }
            } else {
                rest.push(a.clone());
            }
            i += 1;
        }
        Ok(Args { flags, rest })
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.as_deref())
    }

    fn has(&self, name: &str) -> bool {
        self.flags.iter().any(|(n, _)| n == name)
    }

    fn only(&self, allowed: &[&str]) -> Result<(), String> {
        match self.flags.iter().find(|(n, _)| !allowed.contains(&n.as_str())) {
            Some((n, _)) => Err(format!("--{n} はこの命令では使えません")),
            None => Ok(()),
        }
    }

    fn required(&self, name: &str) -> Result<&str, String> {
        self.get(name).ok_or_else(|| format!("--{name} が要ります"))
    }
}

fn default_path(file: &str) -> Result<PathBuf, String> {
    issuer::default_dir()
        .map(|d| d.join(file))
        .ok_or_else(|| "ホームのフォルダが分かりません。--key・--log で場所を指定してください".into())
}

fn key_path(a: &Args) -> Result<PathBuf, String> {
    a.get("key")
        .map(PathBuf::from)
        .map_or_else(|| default_path("signing.key"), Ok)
}

/// 記録の場所（--no-log なら None）
fn log_path(a: &Args) -> Result<Option<PathBuf>, String> {
    if a.has("no-log") {
        return Ok(None);
    }
    a.get("log")
        .map(PathBuf::from)
        .map_or_else(|| default_path("issued.csv"), Ok)
        .map(Some)
}

fn print_claims(c: &Claims) {
    println!("番号: {}", c.id);
    println!("名前: {}", c.name);
    println!("機能: {}", c.features.join("・"));
    println!("発行日: {}", c.issued);
    println!("期限: {}（この日の終わりまで。日本の日付）", c.expires);
    println!("鍵: {}", c.kid);
}

fn run(argv: &[String]) -> Result<(), String> {
    let Some((cmd, rest)) = argv.split_first() else {
        return Err(USAGE.into());
    };
    let a = Args::parse(rest)?;
    let today = feature_code::today_now();
    match cmd.as_str() {
        "keygen" => {
            a.only(&["key", "kid"])?;
            let path = key_path(&a)?;
            let key = feature_code::SecretKey::generate(a.get("kid").unwrap_or("fc-1"))?;
            issuer::write_new_key(&path, &key)?;
            eprintln!("秘密鍵を作りました: {}（人に渡さない・リポジトリに入れない。控えを安全な所に保管する）", path.display());
            eprintln!("配布元の設定（config/distribution.toml の [keys] の feature_code）に、次の公開鍵の行を足してください:");
            println!("{}", key.public().line());
            Ok(())
        }
        "public" => {
            a.only(&["key"])?;
            println!("{}", issuer::read_key(&key_path(&a)?)?.public().line());
            Ok(())
        }
        "issue" => {
            a.only(&["key", "log", "no-log", "id", "name", "features", "expires", "issued"])?;
            let key = issuer::read_key(&key_path(&a)?)?;
            let log = log_path(&a)?;
            let logged = match &log {
                Some(l) => issuer::logged_ids(l)?,
                None => vec![],
            };
            let id = match a.get("id") {
                Some(id) => id.to_owned(),
                None if log.is_some() => issuer::next_id(&logged),
                None => return Err("--no-log のときは --id が要ります".into()),
            };
            if logged.contains(&id) {
                return Err(format!("番号 {id} は記録に既にあります"));
            }
            let expires = a.required("expires")?;
            if let Some(p) = issuer::expires_problem(expires, &today) {
                return Err(p);
            }
            let req = Request {
                id,
                name: a.required("name")?.to_owned(),
                features: issuer::split_features(a.required("features")?),
                issued: a.get("issued").unwrap_or(&today).to_owned(),
                expires: expires.to_owned(),
            };
            let code = issue(&key, &req)?;
            let claims = decode_unverified(&code).map_err(|e| e.to_string())?;
            if let Some(l) = &log {
                issuer::append_records(l, std::slice::from_ref(&claims))?;
                eprintln!("記録に足しました: {}", l.display());
            }
            eprintln!(
                "{}さん向け・{}・期限 {}（番号 {}）",
                claims.name,
                claims.features.join("・"),
                claims.expires,
                claims.id
            );
            println!("{code}");
            Ok(())
        }
        "batch" => {
            a.only(&["key", "log", "no-log", "input", "out"])?;
            let key = issuer::read_key(&key_path(&a)?)?;
            let log = log_path(&a)?;
            let input = a.required("input")?;
            let text = std::fs::read_to_string(input)
                .map_err(|e| format!("一覧 {input} を読めません: {e}"))?;
            let rows: Vec<BatchRow> = issuer::read_batch(&text)?;
            if log.is_none() && rows.iter().any(|r| r.id.is_none()) {
                return Err("--no-log のときは、一覧のすべての行に id が要ります".into());
            }
            let logged = match &log {
                Some(l) => issuer::logged_ids(l)?,
                None => vec![],
            };
            let issued = issuer::issue_batch(&key, &rows, &logged, &today)?;
            let mut out = String::from("\u{feff}id,name,features,expires,issued,code\n");
            for (c, code) in &issued {
                out.push_str(&issuer::record_line(c));
                out.push(',');
                out.push_str(code);
                out.push('\n');
            }
            // 結果を先に書く（記録に足してから結果を書けないと、発行したコードが手元に残らない）
            match a.get("out") {
                Some(p) => {
                    let p = PathBuf::from(p);
                    issuer::outside_repository(&p)?;
                    std::fs::write(&p, &out)
                        .map_err(|e| format!("結果 {} に書けません: {e}", p.display()))?;
                    eprintln!("結果を書きました: {}", p.display());
                }
                None => print!("{}", out.trim_start_matches('\u{feff}')),
            }
            if let Some(l) = &log {
                let claims: Vec<Claims> = issued.iter().map(|(c, _)| c.clone()).collect();
                issuer::append_records(l, &claims)?;
                eprintln!("記録に {} 行足しました: {}", claims.len(), l.display());
            }
            Ok(())
        }
        "record" => {
            a.only(&["log", "key"])?;
            let code = a.rest.first().ok_or("コードを渡してください")?;
            let claims = if a.get("key").is_some() || key_path(&a).is_ok_and(|p| p.exists()) {
                let key = issuer::read_key(&key_path(&a)?)?;
                verify(code, &[key.public()]).map_err(|e| format!("コードを確かめられません（{e}）"))?
            } else {
                decode_unverified(code).map_err(|e| format!("コードを読めません（{e}）"))?
            };
            let log = log_path(&a)?.ok_or("記録の場所が要ります")?;
            issuer::append_records(&log, std::slice::from_ref(&claims))?;
            eprintln!("記録に足しました: {}", log.display());
            Ok(())
        }
        "show" => {
            a.only(&["key"])?;
            let code = a.rest.first().ok_or("コードを渡してください")?;
            let path = key_path(&a)?;
            if path.exists() {
                let key = issuer::read_key(&path)?;
                let c = verify(code, &[key.public()]).map_err(|e| format!("この秘密鍵の署名ではありません（{e}）"))?;
                print_claims(&c);
                println!("署名: この秘密鍵の署名です");
            } else {
                let c = decode_unverified(code).map_err(|e| format!("コードを読めません（{e}）"))?;
                print_claims(&c);
                println!("署名: 確かめていません（秘密鍵が見つかりません）");
            }
            Ok(())
        }
        "features" => {
            for f in FEATURES {
                println!("{}\t{}", f.id, f.label);
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            Ok(())
        }
        other => Err(format!("知らない命令です: {other}\n\n{USAGE}")),
    }
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match run(&argv) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
