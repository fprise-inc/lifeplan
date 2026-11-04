//! 配布元の設定（`config/distribution.toml`）の読み方（0017 の2・0117 の7）。
//!
//! TOML の部品は入れず、1行の形だけを読む（`name = "…"` と `name = ["…", …]`）。本体の build.rs と、提供元の道具
//! （`feature-code revocations open` が、配信元の一覧を確かめる公開鍵を読む）が同じ読み方を使う。
//! 名前はちょうど同じものだけ（`revocation` と `revocations`、`feature_code` と `feature_code_revocation` のように、前の部分が同じ名前を取り違えない）。

/// `[section]` の `name = …` の値（右辺の文字列のまま）
pub fn value<'a>(toml: &'a str, section: &str, name: &str) -> Option<&'a str> {
    let mut in_section = false;
    for line in toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_section = t == format!("[{section}]");
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((k, v)) = t.split_once('=') else {
            continue;
        };
        if k.trim() == name {
            return Some(v.trim());
        }
    }
    None
}

/// `[section]` の `name = "…"` の文字列（無ければ None。`"…"` で書いていなければ誤り）
pub fn string(toml: &str, section: &str, name: &str) -> Result<Option<String>, String> {
    let Some(v) = value(toml, section, name) else {
        return Ok(None);
    };
    v.strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .map(|x| Some(x.to_owned()))
        .ok_or_else(|| format!("config/distribution.toml: [{section}] の {name} は \"…\" で書く"))
}

/// `[section]` の公開鍵の並び（`name = ["…", …]` の1行の配列。書いたままの文字列。無ければ空）。
/// 中身の形（鍵の名前・公開鍵・本番と開発用の名前の決まり・役割をまたいだ重なり）は、鍵の束（[`crate::keys`]）で確かめる
pub fn key_list(toml: &str, section: &str, name: &str) -> Result<Vec<String>, String> {
    let Some(v) = value(toml, section, name) else {
        return Ok(vec![]);
    };
    let inner = v
        .strip_prefix('[')
        .and_then(|x| x.strip_suffix(']'))
        .ok_or_else(|| {
            format!("config/distribution.toml: [{section}] の {name} は1行の [\"…\"] で書く")
        })?;
    inner
        .split(',')
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(|x| {
            x.strip_prefix('"')
                .and_then(|y| y.strip_suffix('"'))
                .map(str::to_owned)
                .ok_or_else(|| {
                    format!("config/distribution.toml: [{section}] の {name} の値は \"…\" で書く")
                })
        })
        .collect()
}

/// 本体が自動で取りに行く一覧の URL（`[endpoints]` の `name`）: https で、`host` のものだけ。クエリ・転送の印は付けない
pub fn endpoint_url(toml: &str, name: &str) -> Result<(String, String), String> {
    let get = |n: &str| {
        string(toml, "endpoints", n)?
            .ok_or_else(|| format!("config/distribution.toml に [endpoints] の {n} がありません"))
    };
    let host = get("host")?;
    let url = get(name)?;
    let rest = url.strip_prefix("https://").ok_or_else(|| {
        format!("config/distribution.toml: [endpoints] の {name} は https:// で始める")
    })?;
    let (h, path) = rest.split_once('/').unwrap_or((rest, ""));
    if h != host || path.is_empty() || url.contains(['?', '#', '@', '\\', ' ']) {
        return Err(format!("config/distribution.toml: [endpoints] の {name} は https://{host}/… の形にする（ほかのホスト・クエリは使わない）"));
    }
    Ok((host, url))
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: &str = "[endpoints]\nhost = \"u.example.test\"\nrevocations = \"https://u.example.test/v1/r.json\"\nbad = \"https://other.test/x\"\n\
                     [keys]\nfeature_code = [\"fc-a:AAA\"]\nfeature_code_revocation = [\"fr-a:BBB\", \"fr-b:CCC\"]\nrevocation = []\n";

    #[test]
    fn reads_exact_names_only() {
        assert_eq!(key_list(T, "keys", "feature_code").unwrap(), ["fc-a:AAA"]);
        assert_eq!(
            key_list(T, "keys", "feature_code_revocation").unwrap(),
            ["fr-a:BBB", "fr-b:CCC"]
        );
        assert!(key_list(T, "keys", "revocation").unwrap().is_empty());
        assert!(key_list(T, "keys", "data").unwrap().is_empty());
        assert!(key_list(T, "dev_keys", "feature_code").unwrap().is_empty());
        assert_eq!(
            endpoint_url(T, "revocations").unwrap().1,
            "https://u.example.test/v1/r.json"
        );
        assert!(endpoint_url(T, "bad").is_err());
        assert!(endpoint_url(T, "missing").is_err());
        assert!(key_list("[keys]\ndata = \"x\"\n", "keys", "data").is_err());
    }
}
