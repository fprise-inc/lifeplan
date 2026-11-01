//! 機能を有効にするコードの発行の道具（提供元だけが使う。0110）。
//!
//! ```text
//! feature-code keygen   [--key <秘密鍵>] [--kid <鍵の名前>]
//! feature-code public   [--key <秘密鍵>]
//! feature-code issue    [--key <秘密鍵>] [--log <記録.csv> | --no-log] [--id <番号>] --name <名前> --features <機能;…> (--expires <YYYY-MM-DD> | --no-expires) [--issued <YYYY-MM-DD>]
//! feature-code batch    [--key <秘密鍵>] [--log <記録.csv> | --no-log] --input <一覧.csv> [--out <結果.csv>]
//! feature-code record   [--log <記録.csv>] [--key <秘密鍵>] <コード>
//! feature-code show     [--key <秘密鍵>] <コード>
//! feature-code features
//! feature-code revocations keygen [--revocation-key <秘密鍵>] [--kid <鍵の名前>]
//! feature-code revocations new    [--draft <下書き>]
//! feature-code revocations add    [--draft <下書き>] [--log <記録.csv> | --no-log] <番号>…
//! feature-code revocations remove [--draft <下書き>] <番号>…
//! feature-code revocations show   [--draft <下書き>] [--signed <配信する一覧> [--revocation-key <秘密鍵>]]
//! feature-code revocations sign   [--draft <下書き>] [--revocation-key <秘密鍵>] [--out <配信する一覧>]
//! ```
//!
//! 既定の置き場所はリポジトリの外（`~/.lifeplan-issuer/signing.key`・`~/.lifeplan-issuer/issued.csv`・`~/.lifeplan-issuer/revocation.key`・
//! `~/.lifeplan-issuer/revocations-draft.json`・`~/.lifeplan-issuer/revocations.json`。`LIFEPLAN_ISSUER_DIR` で変えられる）。

use std::path::PathBuf;
use std::process::ExitCode;

use feature_code::issuer::{self, BatchRow, Draft};
use feature_code::revocation;
use feature_code::{decode_unverified, issue, verify, Claims, Request, FEATURES};

const USAGE: &str = "使い方:
  feature-code keygen   [--key <秘密鍵>] [--kid <鍵の名前>]       秘密鍵を作る（既にあれば止める）。配布元の設定に書く公開鍵の行を出す
  feature-code public   [--key <秘密鍵>]                          公開鍵の行を出す
  feature-code issue    [--key <秘密鍵>] [--log <記録.csv> | --no-log] [--id <番号>]
                        --name <名前> --features <機能;…> (--expires <YYYY-MM-DD> | --no-expires) [--issued <YYYY-MM-DD>]
                                                                  コードを1つ発行して出し、記録に1行足す（番号を省くと記録の続きの番号）
                                                                  期限なしは --no-expires（提供元が止めた一覧で止める）
  feature-code batch    [--key <秘密鍵>] [--log <記録.csv> | --no-log] --input <一覧.csv> [--out <結果.csv>]
                                                                  一覧（列: id・name・features・expires・issued。id と issued は任意。期限なしは expires を none）からまとめて発行する
  feature-code record   [--log <記録.csv>] [--key <秘密鍵>] <コード>  発行したコードの中身を記録に1行足す
  feature-code show     [--key <秘密鍵>] <コード>                  コードの中身を見る（秘密鍵があれば署名も確かめる）
  feature-code features                                           機能の名前の一覧

止めた一覧（提供元が止めたコードの番号。アプリは配信元から取りに行き、載っているコードの機能を止める）:
  feature-code revocations keygen [--revocation-key <秘密鍵>] [--kid <鍵の名前>]
                                                                  止めた一覧の秘密鍵を作る（コードの鍵とは別の鍵）。配布元の設定に書く公開鍵の行を出す
  feature-code revocations new    [--draft <下書き>]                手元の下書きを作る（既にあれば止める）
  feature-code revocations add    [--draft <下書き>] [--log <記録.csv> | --no-log] <番号>…
                                                                  止める番号を下書きに足す（記録に無い番号は知らせる）
  feature-code revocations remove [--draft <下書き>] <番号>…        下書きから外す（署名して置き直すと、次に確かめたときにアプリで戻る）
  feature-code revocations show   [--draft <下書き>] [--signed <配信する一覧> [--revocation-key <秘密鍵>]]
                                                                  下書き（または署名した一覧）の中身を見る
  feature-code revocations sign   [--draft <下書き>] [--revocation-key <秘密鍵>] [--out <配信する一覧>]
                                                                  下書きに署名して、配信元に置く一覧を作る（通し番号を1つ上げる）

既定の置き場所: ~/.lifeplan-issuer/signing.key（秘密鍵）・~/.lifeplan-issuer/issued.csv（記録）・
~/.lifeplan-issuer/revocation.key（止めた一覧の秘密鍵）・~/.lifeplan-issuer/revocations-draft.json（下書き）・
~/.lifeplan-issuer/revocations.json（配信元に置く一覧）。LIFEPLAN_ISSUER_DIR で変えられる。
秘密鍵・記録・下書きは、リポジトリの外に置く（git の作業フォルダの中は断る）。";

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
                if name == "no-log" || name == "no-expires" {
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
        match self
            .flags
            .iter()
            .find(|(n, _)| !allowed.contains(&n.as_str()))
        {
            Some((n, _)) => Err(format!("--{n} はこの命令では使えません")),
            None => Ok(()),
        }
    }

    fn required(&self, name: &str) -> Result<&str, String> {
        self.get(name).ok_or_else(|| format!("--{name} が要ります"))
    }
}

fn default_path(file: &str) -> Result<PathBuf, String> {
    issuer::default_dir().map(|d| d.join(file)).ok_or_else(|| {
        "ホームのフォルダが分かりません。--key・--log で場所を指定してください".into()
    })
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
    match &c.expires {
        Some(e) => println!("期限: {e}（この日の終わりまで。日本の日付）"),
        None => println!("期限: なし（止めるときは止めた一覧に載せる）"),
    }
    println!("鍵: {}（中身の形の版 {}）", c.kid, c.v);
}

fn expires_label(c: &Claims) -> String {
    c.expires
        .as_ref()
        .map_or_else(|| "期限なし".to_owned(), |e| format!("期限 {e}"))
}

fn revocation_key_path(a: &Args) -> Result<PathBuf, String> {
    a.get("revocation-key")
        .map(PathBuf::from)
        .map_or_else(|| default_path("revocation.key"), Ok)
}

fn draft_path(a: &Args) -> Result<PathBuf, String> {
    a.get("draft")
        .map(PathBuf::from)
        .map_or_else(|| default_path("revocations-draft.json"), Ok)
}

fn need_draft(path: &std::path::Path) -> Result<Draft, String> {
    issuer::read_draft(path)?.ok_or_else(|| {
        format!(
            "止めた一覧の下書き {} がありません（feature-code revocations new で作る）",
            path.display()
        )
    })
}

fn print_draft(d: &Draft) {
    println!("最後に署名した通し番号: {}", d.serial);
    if d.revoked.is_empty() {
        println!("止めた番号: なし");
    } else {
        println!(
            "止めた番号（{}件）: {}",
            d.revoked.len(),
            d.revoked.join("・")
        );
    }
}

fn revocations(sub: &str, a: &Args, today: &str) -> Result<(), String> {
    match sub {
        "keygen" => {
            a.only(&["revocation-key", "kid"])?;
            let path = revocation_key_path(a)?;
            let key = feature_code::SecretKey::generate(a.get("kid").unwrap_or("rv-1"))?;
            issuer::write_new_key(&path, &key)?;
            eprintln!("止めた一覧の秘密鍵を作りました: {}（コードの鍵とは別の鍵。人に渡さない・リポジトリに入れない。控えを安全な所に保管する）", path.display());
            eprintln!("配布元の設定（config/distribution.toml の [keys] の feature_code_revocation）に、次の公開鍵の行を足してください:");
            println!("{}", key.public().line());
            Ok(())
        }
        "new" => {
            a.only(&["draft"])?;
            let path = draft_path(a)?;
            if path.exists() {
                return Err(format!(
                    "{} は既にあります（上書きしません）",
                    path.display()
                ));
            }
            issuer::write_draft(&path, &Draft::default())?;
            eprintln!("止めた一覧の下書きを作りました: {}", path.display());
            Ok(())
        }
        "add" => {
            a.only(&["draft", "log", "no-log"])?;
            if a.rest.len() < 2 {
                return Err("止める番号を1つ以上渡してください".into());
            }
            let path = draft_path(a)?;
            let mut d = need_draft(&path)?;
            let ids = a.rest[1..].to_vec();
            let added = issuer::draft_add(&mut d, &ids)?;
            if let Some(log) = log_path(a)? {
                let logged = issuer::logged_ids(&log)?;
                for id in ids.iter().filter(|id| !logged.contains(id)) {
                    eprintln!("番号 {id} は発行の記録（{}）にありません。番号を確かめてください（一覧には足しました）", log.display());
                }
            }
            issuer::write_draft(&path, &d)?;
            eprintln!("下書きに {} 件足しました（署名して配信元に置くまで、アプリでは止まりません: feature-code revocations sign）", added.len());
            print_draft(&d);
            Ok(())
        }
        "remove" => {
            a.only(&["draft"])?;
            if a.rest.len() < 2 {
                return Err("外す番号を1つ以上渡してください".into());
            }
            let path = draft_path(a)?;
            let mut d = need_draft(&path)?;
            let removed = issuer::draft_remove(&mut d, &a.rest[1..])?;
            issuer::write_draft(&path, &d)?;
            eprintln!("下書きから {} 件外しました（署名して配信元に置くと、次に確かめたときにアプリで戻ります）", removed.len());
            print_draft(&d);
            Ok(())
        }
        "show" => {
            a.only(&["draft", "signed", "revocation-key"])?;
            if let Some(signed) = a.get("signed") {
                let bytes = std::fs::read(signed)
                    .map_err(|e| format!("一覧 {signed} を読めません: {e}"))?;
                let key = issuer::read_key(&revocation_key_path(a)?)?;
                let l = revocation::verify(&bytes, &[key.public()])
                    .map_err(|e| format!("この秘密鍵の署名の一覧ではありません（{e}）"))?;
                println!("通し番号: {}", l.serial);
                println!("作った日: {}", l.issued);
                println!(
                    "止めた番号（{}件）: {}",
                    l.revoked.len(),
                    l.revoked.join("・")
                );
                println!("署名: この秘密鍵の署名です");
                return Ok(());
            }
            print_draft(&need_draft(&draft_path(a)?)?);
            Ok(())
        }
        "sign" => {
            a.only(&["draft", "revocation-key", "out"])?;
            let path = draft_path(a)?;
            let d = need_draft(&path)?;
            let key = issuer::read_key(&revocation_key_path(a)?)?;
            let (text, next) = issuer::sign_draft(&key, &d, today)?;
            let out = a
                .get("out")
                .map(PathBuf::from)
                .map_or_else(|| default_path("revocations.json"), Ok)?;
            // 配信元に置く一覧を先に書き、書けてから下書きの通し番号を上げる
            std::fs::write(&out, &text)
                .map_err(|e| format!("{} に書けません: {e}", out.display()))?;
            issuer::write_draft(&path, &next)?;
            eprintln!(
                "配信元に置く一覧を作りました: {}（通し番号 {}・{}件。鍵 {}）",
                out.display(),
                next.serial,
                next.revoked.len(),
                key.kid
            );
            eprintln!("配布元の設定の [endpoints] の feature_code_revocations の場所に置くと、アプリは次に確かめたときに使います");
            Ok(())
        }
        other => Err(format!("知らない命令です: revocations {other}\n\n{USAGE}")),
    }
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
            a.only(&[
                "key",
                "log",
                "no-log",
                "id",
                "name",
                "features",
                "expires",
                "no-expires",
                "issued",
            ])?;
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
            let expires = match (a.get("expires"), a.has("no-expires")) {
                (Some(_), true) => {
                    return Err("--expires と --no-expires は一緒に使えません".into());
                }
                (None, false) => {
                    return Err(
                        "--expires <YYYY-MM-DD> か --no-expires（期限なし）が要ります".into(),
                    );
                }
                (Some(e), false) => {
                    if let Some(p) = issuer::expires_problem(e, &today) {
                        return Err(p);
                    }
                    Some(e.to_owned())
                }
                (None, true) => None,
            };
            let req = Request {
                id,
                name: a.required("name")?.to_owned(),
                features: issuer::split_features(a.required("features")?),
                issued: a.get("issued").unwrap_or(&today).to_owned(),
                expires,
            };
            let code = issue(&key, &req)?;
            let claims = decode_unverified(&code).map_err(|e| e.to_string())?;
            if let Some(l) = &log {
                issuer::append_records(l, std::slice::from_ref(&claims))?;
                eprintln!("記録に足しました: {}", l.display());
            }
            eprintln!(
                "{}さん向け・{}・{}（番号 {}）",
                claims.name,
                claims.features.join("・"),
                expires_label(&claims),
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
                verify(code, &[key.public()])
                    .map_err(|e| format!("コードを確かめられません（{e}）"))?
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
                let c = verify(code, &[key.public()])
                    .map_err(|e| format!("この秘密鍵の署名ではありません（{e}）"))?;
                print_claims(&c);
                println!("署名: この秘密鍵の署名です");
            } else {
                let c =
                    decode_unverified(code).map_err(|e| format!("コードを読めません（{e}）"))?;
                print_claims(&c);
                println!("署名: 確かめていません（秘密鍵が見つかりません）");
            }
            Ok(())
        }
        "revocations" => {
            let sub = a
                .rest
                .first()
                .ok_or_else(|| format!("revocations の後に命令が要ります\n\n{USAGE}"))?
                .clone();
            revocations(&sub, &a, &today)
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
