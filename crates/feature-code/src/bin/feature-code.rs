//! 機能を有効にするコードの発行の道具（提供元だけが使う。0110）。
//!
//! ```text
//! feature-code keygen   [--key <秘密鍵>] --kid <鍵の名前>
//! feature-code public   [--key <秘密鍵>]
//! feature-code issue    [--key <秘密鍵>] [--log <記録.csv> | --no-log] [--id <番号>] --name <名前> --features <機能;…> (--expires <YYYY-MM-DD> | --no-expires) [--issued <YYYY-MM-DD>]
//! feature-code batch    [--key <秘密鍵>] [--log <記録.csv> | --no-log] --input <一覧.csv> [--out <結果.csv>]
//! feature-code record   [--log <記録.csv>] [--key <秘密鍵>] <コード>
//! feature-code show     [--key <秘密鍵>] <コード>
//! feature-code features
//! feature-code revocations new    [--draft <下書き>]
//! feature-code revocations add    [--draft <下書き>] [--log <記録.csv> | --no-log] <番号>…
//! feature-code revocations remove [--draft <下書き>] <番号>…
//! feature-code revocations show   [--draft <下書き>]
//! ```
//!
//! 止めるコードは、配布の取り下げの一覧（0117 の3 (3)）の `revoked.featureCodes` に載せる。この道具は下書きに番号を足す・外すだけで、
//! 署名は配布の道具 `dist-keys revocations sign <取り下げ用の秘密鍵> <下書き> <一覧>`（0110 の追記 2026-11-04）。
//!
//! 既定の置き場所はリポジトリの外（`~/.lifeplan-issuer/signing.key`・`~/.lifeplan-issuer/issued.csv`・
//! `~/.lifeplan-issuer/revocations-draft.json`。`LIFEPLAN_ISSUER_DIR` で変えられる）。

use std::path::PathBuf;
use std::process::ExitCode;

use distribution::revocations::RevocationList;
use feature_code::issuer::{self, BatchRow};
use feature_code::{decode_unverified, issue, verify, Claims, Request, FEATURES};

const USAGE: &str = "使い方:
  feature-code keygen   [--key <秘密鍵>] --kid <鍵の名前>         秘密鍵を作る（既にあれば止める）。配布元の設定に書く公開鍵の行を出す
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

止めるコード（配布の取り下げの一覧の featureCodes。アプリは配信元から一覧を取りに行き、載っているコードの機能を止める）:
  feature-code revocations new    [--draft <下書き>]                取り下げの一覧の下書きを作る（既にあれば止める）
  feature-code revocations add    [--draft <下書き>] [--log <記録.csv> | --no-log] <番号>…
                                                                  止める番号を下書きに足す（記録に無い番号は知らせる）
  feature-code revocations remove [--draft <下書き>] <番号>…        下書きから外す（署名して置き直すと、次に確かめたときにアプリで戻る）
  feature-code revocations show   [--draft <下書き>]                下書きの止める番号を見る
  署名は配布の道具: dist-keys revocations sign <取り下げ用の秘密鍵> <下書き> <一覧>（通し番号を1つ上げ、有効期限を入れる）

既定の置き場所: ~/.lifeplan-issuer/signing.key（秘密鍵）・~/.lifeplan-issuer/issued.csv（記録）・
~/.lifeplan-issuer/revocations-draft.json（取り下げの一覧の下書き）。LIFEPLAN_ISSUER_DIR で変えられる。
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

fn draft_path(a: &Args) -> Result<PathBuf, String> {
    a.get("draft")
        .map(PathBuf::from)
        .map_or_else(|| default_path("revocations-draft.json"), Ok)
}

fn need_draft(path: &std::path::Path) -> Result<RevocationList, String> {
    issuer::read_draft(path)?.ok_or_else(|| {
        format!(
            "取り下げの一覧の下書き {} がありません（feature-code revocations new で作る。配信元に一覧を置いたことがあれば、その下書きを使う）",
            path.display()
        )
    })
}

fn print_draft(d: &RevocationList) {
    println!(
        "最後に署名した通し番号: {}（有効期限 {}）",
        d.serial, d.expires_at
    );
    let ids = &d.revoked.feature_codes;
    if ids.is_empty() {
        println!("止めるコードの番号: なし");
    } else {
        println!("止めるコードの番号（{}件）: {}", ids.len(), ids.join("・"));
    }
}

const SIGN_HINT: &str = "dist-keys revocations sign <取り下げ用の秘密鍵> <下書き> <一覧> で署名し、配信元の /v1/revocations/revocations.json に置く";

fn revocations(sub: &str, a: &Args) -> Result<(), String> {
    match sub {
        "new" => {
            a.only(&["draft"])?;
            let path = draft_path(a)?;
            if path.exists() {
                return Err(format!(
                    "{} は既にあります（上書きしません）",
                    path.display()
                ));
            }
            issuer::write_draft(&path, &issuer::new_draft())?;
            eprintln!("取り下げの一覧の下書きを作りました: {}", path.display());
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
            eprintln!(
                "下書きに {} 件足しました（署名して配信元に置くまで、アプリでは止まりません: {SIGN_HINT}）",
                added.len()
            );
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
            eprintln!(
                "下書きから {} 件外しました（署名して配信元に置くと、次に確かめたときにアプリで戻ります: {SIGN_HINT}）",
                removed.len()
            );
            print_draft(&d);
            Ok(())
        }
        "show" => {
            a.only(&["draft"])?;
            print_draft(&need_draft(&draft_path(a)?)?);
            Ok(())
        }
        "keygen" | "sign" => Err(format!(
            "revocations {sub} は無くなりました（止めるコードは配布の取り下げの一覧に載せる。0110 の追記 2026-11-04）。鍵は dist-keys keygen revocation、署名は {SIGN_HINT}"
        )),
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
            let kid = a.required("kid").map_err(|_| {
                "鍵の名前（--kid）が要ります。本番の鍵は作った年と通し文字で、現用と次期で変える（例: fc-2026a・fc-2026b。0117 の2）。dev- で始まる名前は開発用の鍵".to_owned()
            })?;
            let key = feature_code::SecretKey::generate(kid)?;
            issuer::write_new_key(&path, &key)?;
            eprintln!("秘密鍵を作りました: {}（人に渡さない・リポジトリに入れない。オフラインの控えを2か所に保管する。0117 の2）", path.display());
            if kid.starts_with(distribution::keys::DEV_KID_PREFIX) {
                eprintln!("開発用の鍵です。配布元の設定（config/distribution.toml）の [dev_keys] の feature_code に、次の公開鍵の行を足してください（開発用のビルドだけが受け付けます）:");
            } else {
                eprintln!("配布元の設定（config/distribution.toml の [keys] の feature_code。現用＋次期の2本まで）に、次の公開鍵の行を足してください:");
            }
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
            revocations(&sub, &a)
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
