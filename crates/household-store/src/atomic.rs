//! 一時ファイルに書いて差し替える保存（0011 の7・0013 の4）:
//!
//! 1. 同じフォルダに一時ファイル（`<ファイル名>.tmp-<乱数>`）を作り、全体を書く。
//! 2. 一時ファイルをディスクへ同期する（Rust 標準の `sync_all`。Mac では `F_FULLFSYNC` を使う）。
//! 3. 今のファイルを `<ファイル名>.prev` へ名前を変える（前の `.prev` は置き換わる）。
//! 4. 一時ファイルを今のファイルの名前へ変える（Windows は上書きありの移動）。
//! 5. フォルダをディスクへ同期する（できる OS のとき）。
//!
//! 起動時の片付け（[`recover`]）: 今のファイルが無く、完全な一時ファイルか `.prev` があれば、新しいほうを今のファイルに戻す。
//! 残った一時ファイルは、今のファイルが開けることを確かめてから片付ける。

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::crypto;

/// 試験用: 保存の各段階で止める（強制終了の代わり）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FailPoint {
    #[default]
    None,
    /// 一時ファイルの途中まで書いたところ
    DuringTempWrite,
    /// 一時ファイルを書いて同期した直後（差し替えの前）
    AfterTempWritten,
    /// 今のファイルを .prev に移した直後（一時ファイルを今の名前にする前）
    AfterCurrentMoved,
    /// 一時ファイルを今の名前にした直後
    AfterReplaced,
}

fn interrupted() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "試験用の停止")
}

pub fn prev_path(path: &Path) -> PathBuf {
    with_suffix(path, ".prev")
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// 残った一時ファイル（`<ファイル名>.tmp-*`）
pub fn temp_files(path: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return vec![];
    };
    let prefix = format!("{}.tmp-", name.to_string_lossy());
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

fn sync_dir(dir: &Path) {
    // Windows はフォルダの同期が無い（0013 の4）
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// 差し替えて保存する。直前の世代を `.prev` に1つ残す
pub fn replace(path: &Path, bytes: &[u8], fail: FailPoint) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("フォルダが無い"))?;
    fs::create_dir_all(dir)?;
    let mut r = [0u8; 6];
    crypto::fill_random(&mut r);
    let tmp = with_suffix(path, &format!(".tmp-{}", crypto::hex_encode(&r)));
    {
        let mut f = File::create(&tmp)?;
        if fail == FailPoint::DuringTempWrite {
            f.write_all(&bytes[..bytes.len() / 2])?;
            return Err(interrupted());
        }
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if fail == FailPoint::AfterTempWritten {
        return Err(interrupted());
    }
    if path.exists() {
        fs::rename(path, prev_path(path))?;
    }
    if fail == FailPoint::AfterCurrentMoved {
        return Err(interrupted());
    }
    fs::rename(&tmp, path)?;
    sync_dir(dir);
    if fail == FailPoint::AfterReplaced {
        return Err(interrupted());
    }
    Ok(())
}

/// 差し替えて保存する（直前の世代を残さない）。共有フォルダの、すぐ書き直す小さなファイル（世帯の札・開いている印。0023）に使う
pub fn replace_no_prev(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("フォルダが無い"))?;
    fs::create_dir_all(dir)?;
    let mut r = [0u8; 6];
    crypto::fill_random(&mut r);
    let tmp = with_suffix(path, &format!(".tmp-{}", crypto::hex_encode(&r)));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    sync_dir(dir);
    Ok(())
}

/// 片付けの結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recovered {
    /// 何もしなかった（今のファイルがある・どれも無い）
    Nothing,
    /// 今のファイルが無かったので、一時ファイルか .prev から戻した
    Restored,
}

/// 起動時の片付け。`generation` は、ファイルが完全な形で開ければ世代番号を返す（開けなければ None）
pub fn recover(path: &Path, generation: impl Fn(&[u8]) -> Option<u64>) -> io::Result<Recovered> {
    let temps = temp_files(path);
    let prev = prev_path(path);
    let mut result = Recovered::Nothing;
    if !path.exists() {
        let mut best: Option<(u64, PathBuf)> = None;
        for c in temps.iter().chain(std::iter::once(&prev)) {
            let Ok(bytes) = fs::read(c) else { continue };
            if let Some(g) = generation(&bytes) {
                if best.as_ref().is_none_or(|(bg, _)| g > *bg) {
                    best = Some((g, c.clone()));
                }
            }
        }
        if let Some((_, from)) = best {
            if from == prev {
                // .prev は残したまま、写しを今のファイルにする（直前の世代を失わない）
                let bytes = fs::read(&prev)?;
                replace(path, &bytes, FailPoint::None)?;
                // replace が今のファイルを .prev にしないよう、今のファイルが無い状態で呼んでいる
            } else {
                fs::rename(&from, path)?;
                if let Some(dir) = path.parent() {
                    sync_dir(dir);
                }
            }
            result = Recovered::Restored;
        }
    }
    // 今のファイルが開けるときだけ、残った一時ファイルを片付ける
    if fs::read(path).ok().and_then(|b| generation(&b)).is_some() {
        for t in temp_files(path) {
            let _ = fs::remove_file(t);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gen_of(b: &[u8]) -> Option<u64> {
        // 試験の形式: "G<世代>:<中身>;"（最後の ; が無ければ不完全）
        let s = std::str::from_utf8(b).ok()?;
        let s = s.strip_suffix(';')?;
        s.strip_prefix('G')?.split(':').next()?.parse().ok()
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hs-atomic-{name}-{}", crypto::new_uuid()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn replace_keeps_the_previous_generation() {
        let d = dir("prev");
        let p = d.join("a.lphf");
        replace(&p, b"G1:a;", FailPoint::None).unwrap();
        replace(&p, b"G2:b;", FailPoint::None).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"G2:b;");
        assert_eq!(fs::read(prev_path(&p)).unwrap(), b"G1:a;");
        assert!(temp_files(&p).is_empty());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn every_failure_point_leaves_a_complete_generation() {
        for fp in [
            FailPoint::DuringTempWrite,
            FailPoint::AfterTempWritten,
            FailPoint::AfterCurrentMoved,
            FailPoint::AfterReplaced,
        ] {
            let d = dir("fail");
            let p = d.join("a.lphf");
            replace(&p, b"G1:old;", FailPoint::None).unwrap();
            assert!(replace(&p, b"G2:new;", fp).is_err());
            recover(&p, gen_of).unwrap();
            let now = fs::read(&p).unwrap();
            let g = gen_of(&now).expect("完全な形で残る");
            match fp {
                FailPoint::DuringTempWrite | FailPoint::AfterTempWritten => {
                    assert_eq!(g, 1, "{fp:?}: 前の世代のまま")
                }
                // 今のファイルが無い状態では、完全な一時ファイル（新しい世代）を戻す
                FailPoint::AfterCurrentMoved => assert_eq!(g, 2, "{fp:?}"),
                FailPoint::AfterReplaced => assert_eq!(g, 2, "{fp:?}"),
                FailPoint::None => unreachable!(),
            }
            assert!(temp_files(&p).is_empty(), "{fp:?}: 一時ファイルは片付く");
            fs::remove_dir_all(&d).ok();
        }
    }

    #[test]
    fn falls_back_to_prev_when_temp_is_broken() {
        let d = dir("broken");
        let p = d.join("a.lphf");
        replace(&p, b"G1:old;", FailPoint::None).unwrap();
        replace(&p, b"G2:new;", FailPoint::None).unwrap();
        // 今のファイルが消え、壊れた一時ファイルだけがある
        fs::remove_file(&p).unwrap();
        fs::write(with_suffix(&p, ".tmp-0000"), b"G3:half").unwrap();
        assert_eq!(recover(&p, gen_of).unwrap(), Recovered::Restored);
        assert_eq!(fs::read(&p).unwrap(), b"G1:old;");
        assert_eq!(
            fs::read(prev_path(&p)).unwrap(),
            b"G1:old;",
            "直前の世代は残る"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn nothing_to_do_when_current_is_fine() {
        let d = dir("fine");
        let p = d.join("a.lphf");
        replace(&p, b"G1:a;", FailPoint::None).unwrap();
        assert_eq!(recover(&p, gen_of).unwrap(), Recovered::Nothing);
        assert_eq!(
            recover(&d.join("none.lphf"), gen_of).unwrap(),
            Recovered::Nothing
        );
        fs::remove_dir_all(&d).ok();
    }
}
