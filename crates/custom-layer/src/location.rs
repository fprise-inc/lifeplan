//! カスタム層の場所の決まり（0016 の3）: カスタム層と、データフォルダ・鍵置き場（とアプリのデータの場所）は、互いに相手を含んではいけない。

use std::path::{Component, Path, PathBuf};

/// カスタム層の既定のフォルダの名前（書類のフォルダの中。製品名に依存させない）
pub const DEFAULT_DIR_NAME: &str = "lifeplan-custom";

/// パスを比べられる形にする（. と .. を解き、あれば実在のパスにする。無いフォルダは、ある所までを実在のパスにして残りを足す）
pub fn normalized(p: &Path) -> PathBuf {
    if let Ok(c) = p.canonicalize() {
        return c;
    }
    let mut lexical = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                lexical.pop();
            }
            Component::CurDir => {}
            other => lexical.push(other),
        }
    }
    // ある所までさかのぼって実在のパスにする（Mac の /var → /private/var のような置き換えをそろえる）
    let mut rest = Vec::new();
    let mut cur = lexical.clone();
    while let Some(name) = cur.file_name().map(|n| n.to_owned()) {
        rest.push(name);
        if !cur.pop() {
            break;
        }
        if let Ok(c) = cur.canonicalize() {
            let mut out = c;
            for n in rest.iter().rev() {
                out.push(n);
            }
            return out;
        }
    }
    lexical
}

/// カスタム層にしてよい場所か。よければ比べられる形のパスを返す。
/// `protected` はデータフォルダ・鍵置き場・アプリのデータの場所など、カスタム層と重なってはいけない場所
pub fn check(custom: &Path, protected: &[PathBuf]) -> Result<PathBuf, &'static str> {
    if !custom.is_absolute() {
        return Err("E_CUSTOM_PLACE");
    }
    let c = normalized(custom);
    if c.parent().is_none() {
        return Err("E_CUSTOM_PLACE");
    }
    for p in protected {
        let p = normalized(p);
        if c.starts_with(&p) || p.starts_with(&c) {
            return Err("E_CUSTOM_PLACE_OVERLAP");
        }
    }
    Ok(c)
}
