//! 提供元が使う道具: データ用・自動配信用・取り下げ用・コードを止めるだけの鍵を作り、封筒に署名する（0117 の2）。
//!
//! ```text
//! dist-keys keygen <data|auto_delivery|revocation|feature_code_revocation> <鍵の名前> <秘密鍵のファイル>
//!     秘密鍵を作ってファイルに書き（既にあれば止める・リポジトリの中には書かない・0600）、
//!     配布元の設定の [keys] に足す1行（「鍵の名前:公開鍵」）を出す
//! dist-keys public <秘密鍵のファイル>
//!     その秘密鍵の [keys] の1行を出し直す
//! dist-keys seal <pack-catalog|revocations|feature-code-revocations|notices> <秘密鍵のファイル> <中身の JSON のファイル>
//!     中身の JSON（そのままのバイト列）に署名した封筒を出す。鍵の役割が中身の種類に合わなければ止める
//! dist-keys revocations new <下書き>
//!     取り下げの一覧の下書き（中身の JSON。通し番号 0・何も載っていない）を作る（既にあれば止める）
//! dist-keys revocations show <下書き>
//!     下書きの中身（通し番号・期限・載っている数）を出す（取り下げの一覧と、コードを止めるだけの一覧のどちらの下書きも）
//! dist-keys revocations sign <秘密鍵> <下書き> <出す一覧のファイル> [--days <日数>]
//!     下書きの通し番号を1つ上げ、作った時刻を今・有効期限を日数（既定90日）の後にして署名し、配信元に置く一覧を書く。
//!     下書きも上げた通し番号で書き直す。下書きの種類と鍵の役割が合わなければ止める:
//!     - 取り下げの一覧の下書き（`dist-keys revocations new`）は取り下げ用の鍵 → `/v1/revocations/revocations.json`
//!     - コードを止めるだけの一覧の下書き（`feature-code revocations new`）はコードを止めるだけの鍵 → `/v1/revocations/feature-codes.json`
//! ```
//!
//! アプリ更新用の鍵は、この道具ではなく `tauri signer generate`・`tauri signer sign` を使う。
//! 機能を有効にするコードの鍵（`feature_code`）は、コードの発行の道具（`feature-code keygen`）で作る（0110）。
//! 止めるコードの番号を足す・外すのは `feature-code revocations add|remove`（ふだんはコードを止めるだけの一覧の下書き。
//! `--draft` で取り下げの一覧の下書きも直せる。0117 の追記 2026-11-04 の2）。
//! 秘密鍵のファイルは、オフラインの2か所に控える（0117 の2）。この道具は秘密鍵を画面にもログにも出さない。

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine as _;
use distribution::keys::{valid_kid, Role};
use distribution::{envelope, feature_code_revocations, format_utc, pack_catalog, revocations};
use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

const HEADER: &str = "financia-distribution-secret-key/1";

struct Secret {
    role: Role,
    kid: String,
    key: SigningKey,
}

fn public_line(s: &Secret) -> String {
    format!(
        "{}:{}",
        s.kid,
        B64URL.encode(s.key.verifying_key().to_bytes())
    )
}

fn outside_repository(path: &Path) -> Result<(), String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("今のフォルダが分かりません: {e}"))?
            .join(path)
    };
    let mut cur = abs.parent();
    while let Some(d) = cur {
        if d.join(".git").exists() {
            return Err(format!(
                "{} は git の作業フォルダの中です。秘密鍵はリポジトリの外（オフラインの置き場）に書いてください",
                abs.display()
            ));
        }
        cur = d.parent();
    }
    Ok(())
}

fn keygen(role: &str, kid: &str, path: &Path) -> Result<String, String> {
    let role = Role::from_name(role)
        .filter(|r| !matches!(r, Role::AppUpdate | Role::FeatureCode))
        .ok_or("役割は data・auto_delivery・revocation・feature_code_revocation のどれか（アプリ更新用の鍵は tauri signer generate、機能を有効にするコードの発行の鍵は feature-code keygen で作る）")?;
    if !valid_kid(kid) {
        return Err("鍵の名前は英小文字・数字・「-」の32文字まで（例: data-2026a）".into());
    }
    outside_repository(path)?;
    let mut seed = Zeroizing::new([0u8; 32]);
    getrandom::getrandom(seed.as_mut()).map_err(|_| "乱数を作れませんでした")?;
    let s = Secret {
        role,
        kid: kid.to_owned(),
        key: SigningKey::from_bytes(&seed),
    };
    let text = Zeroizing::new(format!(
        "{HEADER}\n{}\n{}\n{}\n",
        role.name(),
        kid,
        B64URL.encode(seed.as_ref())
    ));
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
    f.write_all(text.as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| format!("{} に書けません: {e}", path.display()))?;
    Ok(public_line(&s))
}

fn read_secret(path: &Path) -> Result<Secret, String> {
    let text = Zeroizing::new(
        fs::read_to_string(path)
            .map_err(|e| format!("秘密鍵 {} を読めません: {e}", path.display()))?,
    );
    let lines: Vec<&str> = text.lines().collect();
    let bad = || format!("{} は dist-keys の秘密鍵の形ではありません", path.display());
    if lines.len() != 4 || lines[0] != HEADER {
        return Err(bad());
    }
    let role = Role::from_name(lines[1]).ok_or_else(bad)?;
    if !valid_kid(lines[2]) {
        return Err(bad());
    }
    let seed: Zeroizing<Vec<u8>> = Zeroizing::new(B64URL.decode(lines[3]).map_err(|_| bad())?);
    let seed: &[u8; 32] = seed.as_slice().try_into().map_err(|_| bad())?;
    Ok(Secret {
        role,
        kid: lines[2].to_owned(),
        key: SigningKey::from_bytes(seed),
    })
}

fn seal(kind: &str, key_path: &Path, payload_path: &Path) -> Result<String, String> {
    let (format, roles): (&str, &[Role]) = match kind {
        "pack-catalog" => (
            pack_catalog::ENVELOPE_FORMAT,
            &[Role::Data, Role::AutoDelivery],
        ),
        "revocations" => (revocations::ENVELOPE_FORMAT, &[Role::Revocation]),
        "feature-code-revocations" => (
            feature_code_revocations::ENVELOPE_FORMAT,
            &[Role::FeatureCodeRevocation],
        ),
        "notices" => ("financia-notices-envelope", &[Role::Data]),
        _ => {
            return Err(
                "種類は pack-catalog・revocations・feature-code-revocations・notices のどれか"
                    .into(),
            )
        }
    };
    let s = read_secret(key_path)?;
    if !roles.contains(&s.role) {
        return Err(format!(
            "{} の鍵では {kind} に署名できません（0017 の5 の役割）",
            s.role.name()
        ));
    }
    let payload = fs::read_to_string(payload_path)
        .map_err(|e| format!("{} を読めません: {e}", payload_path.display()))?;
    serde_json::from_str::<serde_json::Value>(&payload)
        .map_err(|_| format!("{} は JSON ではありません", payload_path.display()))?;
    Ok(envelope::seal(&payload, format, &[(&s.kid, &s.key)]))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(0))
        .unwrap_or(0)
}

/// 下書き（署名の前の中身）: 取り下げの一覧か、コードを止めるだけの一覧か（中身の `format` で見分ける）
enum Draft {
    Main(revocations::RevocationList),
    Codes(feature_code_revocations::FeatureCodeRevocationList),
}

fn read_draft(path: &Path) -> Result<Draft, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("下書き {} を読めません: {e}", path.display()))?;
    let format = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("format").and_then(|f| f.as_str()).map(str::to_owned));
    let bad = |e: distribution::Reject| format!("下書き {} の形が違います（{e}）", path.display());
    match format.as_deref() {
        Some(feature_code_revocations::FORMAT) => feature_code_revocations::parse_payload(&text)
            .map(|v| Draft::Codes(v.list))
            .map_err(bad),
        _ => revocations::parse_payload(&text)
            .map(|v| Draft::Main(v.list))
            .map_err(bad),
    }
}

/// 別の名前に書いてから置き換える（書きかけで壊さない）
fn write_replace(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text)
        .and_then(|_| fs::rename(&tmp, path))
        .map_err(|e| format!("{} に書けません: {e}", path.display()))
}

fn draft_text(list: &impl serde::Serialize) -> String {
    let mut s = serde_json::to_string_pretty(list).unwrap_or_default();
    s.push('\n');
    s
}

fn revocations_cmd(args: &[String]) -> Result<String, String> {
    match args {
        [c, draft] if c == "new" => {
            let path = PathBuf::from(draft);
            if path.exists() {
                return Err(format!("{} は既にあります（上書きしません）", path.display()));
            }
            let list = revocations::empty_draft(now_secs());
            write_replace(&path, &draft_text(&list))?;
            Ok(format!("下書きを作りました: {}", path.display()))
        }
        [c, draft] if c == "show" => match read_draft(&PathBuf::from(draft))? {
            Draft::Main(l) => {
                let r = &l.revoked;
                Ok(format!(
                    "取り下げの一覧の下書き（取り下げ用の鍵で署名する）\n通し番号 {}（次に署名すると {}）\n作った時刻 {}・有効期限 {}\n最低版 {}\n載っているもの: 制度の値 {}・計算部品 {}・パック {}・アプリの版 {}・鍵 {}・機能を有効にするコード {}{}",
                    l.serial,
                    l.serial + 1,
                    l.issued_at,
                    l.expires_at,
                    l.min_app_version.as_deref().unwrap_or("なし"),
                    r.regulation_values.len(),
                    r.component_revisions.len(),
                    r.packs.len(),
                    r.app_versions.len(),
                    r.keys.len(),
                    r.feature_codes.len(),
                    if r.keys.is_empty() {
                        String::new()
                    } else {
                        format!("\n取り下げた鍵: {}", r.keys.join("・"))
                    }
                ))
            }
            Draft::Codes(l) => Ok(format!(
                "コードを止めるだけの一覧の下書き（コードを止めるだけの鍵で署名する）\n通し番号 {}（次に署名すると {}）\n作った時刻 {}・有効期限 {}\n止めるコード {} 件",
                l.serial,
                l.serial + 1,
                l.issued_at,
                l.expires_at,
                l.feature_codes.len()
            )),
        },
        [c, key, draft, out, rest @ ..] if c == "sign" => {
            let days = match rest {
                [] => revocations::DEFAULT_VALID_DAYS,
                [f, n] if f == "--days" => n
                    .parse()
                    .map_err(|_| "--days は日数（1〜366）".to_owned())?,
                _ => return Err("使い方: dist-keys revocations sign <秘密鍵> <下書き> <出す一覧のファイル> [--days <日数>]".into()),
            };
            let s = read_secret(&PathBuf::from(key))?;
            let draft_path = PathBuf::from(draft);
            let draft = read_draft(&draft_path)?;
            let now = now_secs();
            let bad_days = |e: distribution::Reject| format!("下書きの形が違います（{e}。--days は 1〜366）");
            let (sealed, next_text, done) = match draft {
                Draft::Main(list) => {
                    if s.role != Role::Revocation {
                        return Err(format!(
                            "{} の鍵では取り下げの一覧に署名できません（取り下げ用の鍵を使う。0017 の5。コードを止めるだけの鍵は、コードを止めるだけの一覧〔feature-code revocations new〕にだけ署名できる）",
                            s.role.name()
                        ));
                    }
                    let next = revocations::next_issue(&list, now, days).map_err(bad_days)?;
                    let payload = serde_json::to_string(&next).map_err(|e| e.to_string())?;
                    (
                        envelope::seal(&payload, revocations::ENVELOPE_FORMAT, &[(&s.kid, &s.key)]),
                        draft_text(&next),
                        format!(
                            "{out} を書きました（取り下げの一覧・通し番号 {}・有効期限 {}・機能を有効にするコード {} 件・鍵 {}）。配信元の /v1/revocations/revocations.json に置くと、アプリが次に確かめたときから効きます。有効期限（{}）の前に出し直してください（今は {}）",
                            next.serial,
                            next.expires_at,
                            next.revoked.feature_codes.len(),
                            s.kid,
                            next.expires_at,
                            format_utc(now)
                        ),
                    )
                }
                Draft::Codes(list) => {
                    if s.role != Role::FeatureCodeRevocation {
                        return Err(format!(
                            "{} の鍵では、コードを止めるだけの一覧に署名できません（feature_code_revocation の鍵を使う。0117 の追記 2026-11-04 の2）",
                            s.role.name()
                        ));
                    }
                    let next =
                        feature_code_revocations::next_issue(&list, now, days).map_err(bad_days)?;
                    let payload = serde_json::to_string(&next).map_err(|e| e.to_string())?;
                    (
                        envelope::seal(
                            &payload,
                            feature_code_revocations::ENVELOPE_FORMAT,
                            &[(&s.kid, &s.key)],
                        ),
                        draft_text(&next),
                        format!(
                            "{out} を書きました（コードを止めるだけの一覧・通し番号 {}・有効期限 {}・止めるコード {} 件・鍵 {}）。配信元の /v1/revocations/feature-codes.json に置くと、アプリが次に確かめたときから効きます。有効期限（{}）の前に出し直してください（今は {}）",
                            next.serial,
                            next.expires_at,
                            next.feature_codes.len(),
                            s.kid,
                            next.expires_at,
                            format_utc(now)
                        ),
                    )
                }
            };
            write_replace(&PathBuf::from(out), &sealed)?;
            write_replace(&draft_path, &next_text)?;
            Ok(done)
        }
        _ => Err("使い方: dist-keys revocations new <下書き> | show <下書き> | sign <秘密鍵> <下書き> <出す一覧のファイル> [--days <日数>]".into()),
    }
}

fn run(args: &[String]) -> Result<String, String> {
    let usage = "使い方: dist-keys keygen <役割> <鍵の名前> <秘密鍵のファイル> | public <秘密鍵のファイル> | seal <種類> <秘密鍵のファイル> <中身のファイル> | revocations new|show|sign …";
    if args.first().is_some_and(|c| c == "revocations") {
        return revocations_cmd(&args[1..]);
    }
    match args {
        [c, role, kid, path] if c == "keygen" => keygen(role, kid, &PathBuf::from(path)),
        [c, path] if c == "public" => read_secret(&PathBuf::from(path)).map(|s| public_line(&s)),
        [c, kind, key, payload] if c == "seal" => {
            seal(kind, &PathBuf::from(key), &PathBuf::from(payload))
        }
        _ => Err(usage.into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(out) => {
            println!("{}", out.trim_end());
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
