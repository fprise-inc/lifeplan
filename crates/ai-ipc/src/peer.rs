//! 話しかけてきたプロセスの、観測できた範囲の情報（実行ファイルのパスと親のプロセス）。
//! どれも認証ではない（同じ OS ユーザーのプログラムは偽れる）。AIに渡した記録の参考情報として残す（0014 の3・0015 の8）。

use std::path::PathBuf;

/// プロセスの実行ファイルのパスと親のプロセスの ID（取れなければ None）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessInfo {
    pub exe: Option<PathBuf>,
    pub ppid: Option<u32>,
}

#[cfg(target_os = "linux")]
pub fn process_info(pid: u32) -> ProcessInfo {
    let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
    // /proc/<pid>/stat の4つ目が親の pid（2つ目の名前は括弧つきで空白を含みうるので、最後の ')' の後から数える）
    let ppid = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|s| {
            let rest = &s[s.rfind(')')? + 1..];
            rest.split_whitespace().nth(1)?.parse().ok()
        });
    ProcessInfo { exe, ppid }
}

#[cfg(target_os = "macos")]
pub fn process_info(pid: u32) -> ProcessInfo {
    let Ok(pid_c) = libc::c_int::try_from(pid) else {
        return ProcessInfo::default();
    };
    let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: buf は PROC_PIDPATHINFO_MAXSIZE バイトの書ける領域
    let n = unsafe {
        libc::proc_pidpath(
            pid_c,
            buf.as_mut_ptr().cast(),
            u32::try_from(buf.len()).unwrap_or(0),
        )
    };
    let exe = (n > 0).then(|| {
        buf.truncate(usize::try_from(n).unwrap_or(0));
        PathBuf::from(String::from_utf8_lossy(&buf).into_owned())
    });
    // SAFETY: proc_bsdinfo はただのデータの構造体で、全部0でよい
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = libc::c_int::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).unwrap_or(0);
    // SAFETY: info は size バイトの書ける領域
    let got = unsafe {
        libc::proc_pidinfo(
            pid_c,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    let ppid = (got == size).then_some(info.pbi_ppid);
    ProcessInfo { exe, ppid }
}

/// そのほかの OS（Windows の実行ファイルのパスは transport が名前付きパイプの相手から取る。親のプロセスは未対応）
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn process_info(_pid: u32) -> ProcessInfo {
    ProcessInfo::default()
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn own_process_has_exe_and_parent() {
        let info = process_info(std::process::id());
        assert!(info.exe.is_some(), "{info:?}");
        assert!(info.ppid.is_some_and(|p| p > 0), "{info:?}");
    }
}
