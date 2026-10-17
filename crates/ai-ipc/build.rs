// 0017 の2: アプリの識別子は config/distribution.toml にだけ書く。作業フォルダ・パイプの名前に使うので、ビルドの時に読む
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let path = manifest_dir.join("../../config/distribution.toml");
    println!("cargo:rerun-if-changed={}", path.display());
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} を読めません: {e}", path.display()));
    let identifier = text
        .lines()
        .find_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("identifier")?.trim_start();
            let rest = rest.strip_prefix('=')?.trim();
            Some(rest.trim_matches('"').to_owned())
        })
        .expect("config/distribution.toml に identifier がありません");
    assert!(
        !identifier.is_empty()
            && identifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'),
        "identifier の書式が違います"
    );
    println!("cargo:rustc-env=FINANCIA_IDENTIFIER={identifier}");
}
