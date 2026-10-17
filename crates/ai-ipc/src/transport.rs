//! 同じPCの中だけでつなぐ口。OS ごとの違いはこのファイルの中に閉じ込める（0015 の4）。
//!
//! 使う側から見える形（どの OS でも同じ）:
//! - `LocalListener::bind(dir)` → `(listener, 口の文字列)`（口の文字列は `app.json` の `endpoint` に書く）
//! - `listener.accept().await` → `(LocalStream, PeerInfo)`
//! - `connect(口の文字列).await` → `LocalStream`

use std::io;
use std::path::{Path, PathBuf};

/// 話しかけてきた相手（OS が教えてくれる情報。相手が自分で名乗るものではない。どれも認証ではない）
#[derive(Debug, Clone, Default)]
pub struct PeerInfo {
    pub uid: Option<u32>,
    pub pid: Option<u32>,
    /// 相手（接続口）の実行ファイルのパス
    pub exe: Option<PathBuf>,
    /// 相手を起動した親のプロセス（AIのアプリ）の実行ファイルのパス
    pub parent_exe: Option<PathBuf>,
    /// 相手が自分と同じ OS ユーザーか（Windows はパイプの DACL で本人以外は開けないので true とする）
    pub same_user: bool,
}

fn fill_process(peer: &mut PeerInfo) {
    if let Some(pid) = peer.pid {
        let me = crate::peer::process_info(pid);
        if peer.exe.is_none() {
            peer.exe = me.exe;
        }
        if let Some(ppid) = me.ppid {
            peer.parent_exe = crate::peer::process_info(ppid).exe;
        }
    }
}

// ---------------------------------------------------------------- Unix
#[cfg(unix)]
mod imp {
    use super::*;
    use tokio::net::{UnixListener, UnixStream};

    pub type LocalStream = UnixStream;

    pub struct LocalListener {
        inner: UnixListener,
        path: PathBuf,
        /// ソケットのパスが長すぎて、一時フォルダの下に作った専用のフォルダ（終了時に消す）
        fallback_dir: Option<PathBuf>,
    }

    pub const SOCKET_FILE: &str = "app.sock";

    /// Unix ドメインソケットのパスの上限（Mac は 104 バイト。余裕を見る）
    const MAX_SOCKET_PATH: usize = 100;

    impl LocalListener {
        pub fn bind(dir: &Path) -> io::Result<(Self, String)> {
            let mut path = dir.join(SOCKET_FILE);
            let mut fallback_dir = None;
            if path.as_os_str().len() > MAX_SOCKET_PATH {
                // 0015 の4: 長すぎるときは、OS が用意するそのユーザー専用の一時フォルダの下に置き、実際のパスを app.json に書く
                let d = std::env::temp_dir().join(format!("lifeplan-{}", crate::random_hex(6)));
                crate::discovery::prepare_private_dir(&d)?;
                path = d.join(SOCKET_FILE);
                fallback_dir = Some(d);
            }
            if path.exists() {
                // 前回の残り（アプリが落ちた）なら消す。生きているアプリがいるなら二重起動なので止める
                if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                    return Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        "アプリがすでに起動しています",
                    ));
                }
                std::fs::remove_file(&path)?;
            }
            let inner = UnixListener::bind(&path)?;
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            }
            let endpoint = path.to_string_lossy().into_owned();
            Ok((
                Self {
                    inner,
                    path,
                    fallback_dir,
                },
                endpoint,
            ))
        }

        pub async fn accept(&self) -> io::Result<(LocalStream, PeerInfo)> {
            let (stream, _) = self.inner.accept().await?;
            let mut peer = PeerInfo::default();
            if let Ok(cred) = stream.peer_cred() {
                peer.uid = Some(cred.uid());
                peer.pid = cred.pid().and_then(|p| u32::try_from(p).ok());
                // SAFETY: geteuid は引数を取らず、失敗しない
                peer.same_user = cred.uid() == unsafe { libc::geteuid() };
            }
            fill_process(&mut peer);
            Ok((stream, peer))
        }
    }

    impl Drop for LocalListener {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
            if let Some(d) = &self.fallback_dir {
                let _ = std::fs::remove_dir(d);
            }
        }
    }

    pub async fn connect(endpoint: &str) -> io::Result<LocalStream> {
        UnixStream::connect(endpoint).await
    }
}

// ---------------------------------------------------------------- Windows
#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
    use tokio::net::windows::named_pipe::{
        ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
    };
    use tokio::sync::Mutex;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_PIPE_BUSY, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub enum LocalStream {
        Server(NamedPipeServer),
        Client(NamedPipeClient),
    }

    impl AsyncRead for LocalStream {
        fn poll_read(
            self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            match self.get_mut() {
                LocalStream::Server(s) => Pin::new(s).poll_read(cx, buf),
                LocalStream::Client(c) => Pin::new(c).poll_read(cx, buf),
            }
        }
    }

    impl AsyncWrite for LocalStream {
        fn poll_write(
            self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &[u8],
        ) -> Poll<io::Result<usize>> {
            match self.get_mut() {
                LocalStream::Server(s) => Pin::new(s).poll_write(cx, buf),
                LocalStream::Client(c) => Pin::new(c).poll_write(cx, buf),
            }
        }
        fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            match self.get_mut() {
                LocalStream::Server(s) => Pin::new(s).poll_flush(cx),
                LocalStream::Client(c) => Pin::new(c).poll_flush(cx),
            }
        }
        fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            match self.get_mut() {
                LocalStream::Server(s) => Pin::new(s).poll_shutdown(cx),
                LocalStream::Client(c) => Pin::new(c).poll_shutdown(cx),
            }
        }
    }

    /// 「今の OS ユーザーだけに全権限」のセキュリティ記述子（SDDL: D:P(A;;GA;;;<自分の SID>)）
    struct OwnerOnlySecurity {
        descriptor: *mut core::ffi::c_void,
        attrs: SECURITY_ATTRIBUTES,
    }
    // SAFETY: 記述子は作った後に書き換えず、読むだけ
    unsafe impl Send for OwnerOnlySecurity {}
    // SAFETY: 同上
    unsafe impl Sync for OwnerOnlySecurity {}

    impl OwnerOnlySecurity {
        fn new() -> io::Result<Self> {
            // SAFETY: Win32 の呼び出し。戻り値を確かめ、確保したものは LocalFree で返す
            unsafe {
                let mut token: HANDLE = std::ptr::null_mut();
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                    return Err(io::Error::last_os_error());
                }
                let mut len = 0u32;
                GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len);
                let mut buf = vec![0u8; len as usize];
                let ok =
                    GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len);
                CloseHandle(token);
                if ok == 0 {
                    return Err(io::Error::last_os_error());
                }
                let user = &*(buf.as_ptr() as *const TOKEN_USER);
                let mut sid_str: *mut u16 = std::ptr::null_mut();
                if ConvertSidToStringSidW(user.User.Sid, &mut sid_str) == 0 {
                    return Err(io::Error::last_os_error());
                }
                let mut n = 0usize;
                while *sid_str.add(n) != 0 {
                    n += 1;
                }
                let sid = String::from_utf16_lossy(std::slice::from_raw_parts(sid_str, n));
                LocalFree(sid_str.cast());
                let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
                    .encode_utf16()
                    .chain([0])
                    .collect();
                let mut descriptor: *mut core::ffi::c_void = std::ptr::null_mut();
                if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                ) == 0
                {
                    return Err(io::Error::last_os_error());
                }
                let attrs = SECURITY_ATTRIBUTES {
                    nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                    lpSecurityDescriptor: descriptor,
                    bInheritHandle: 0,
                };
                Ok(Self { descriptor, attrs })
            }
        }
    }

    impl Drop for OwnerOnlySecurity {
        fn drop(&mut self) {
            // SAFETY: ConvertStringSecurityDescriptorToSecurityDescriptorW が確保したもの
            unsafe { LocalFree(self.descriptor) };
        }
    }

    pub struct LocalListener {
        name: String,
        security: OwnerOnlySecurity,
        next: Mutex<NamedPipeServer>,
    }

    impl LocalListener {
        fn create(
            name: &str,
            security: &OwnerOnlySecurity,
            first: bool,
        ) -> io::Result<NamedPipeServer> {
            let mut opts = ServerOptions::new();
            // 最初のインスタンスを強制（ほかのプログラムが先に同じ名前で待ち構えていたら失敗させる）・ネットワーク越しの接続を拒否
            opts.first_pipe_instance(first).reject_remote_clients(true);
            // SAFETY: attrs は security が生きている間有効
            unsafe {
                opts.create_with_security_attributes_raw(
                    name,
                    &security.attrs as *const SECURITY_ATTRIBUTES as *mut core::ffi::c_void,
                )
            }
        }

        /// Windows では dir は使わず、起動ごとに推測できない名前のパイプを作る（名前は app.json に書く）
        pub fn bind(_dir: &Path) -> io::Result<(Self, String)> {
            let name = format!(r"\\.\pipe\{}-{}", crate::IDENTIFIER, crate::random_hex(16));
            let security = OwnerOnlySecurity::new()?;
            let first = Self::create(&name, &security, true)?;
            Ok((
                Self {
                    name: name.clone(),
                    security,
                    next: Mutex::new(first),
                },
                name,
            ))
        }

        pub async fn accept(&self) -> io::Result<(LocalStream, PeerInfo)> {
            let mut guard = self.next.lock().await;
            guard.connect().await?;
            let fresh = Self::create(&self.name, &self.security, false)?;
            let server = std::mem::replace(&mut *guard, fresh);
            drop(guard);
            let mut peer = PeerInfo {
                same_user: true,
                ..Default::default()
            };
            // SAFETY: Win32 の呼び出し。戻り値を確かめ、開いたハンドルは閉じる
            unsafe {
                let mut pid = 0u32;
                if GetNamedPipeClientProcessId(server.as_raw_handle() as HANDLE, &mut pid) != 0 {
                    peer.pid = Some(pid);
                    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !h.is_null() {
                        let mut buf = vec![0u16; 32768];
                        let mut len = buf.len() as u32;
                        if QueryFullProcessImageNameW(
                            h,
                            PROCESS_NAME_WIN32,
                            buf.as_mut_ptr(),
                            &mut len,
                        ) != 0
                        {
                            peer.exe = Some(PathBuf::from(String::from_utf16_lossy(
                                &buf[..len as usize],
                            )));
                        }
                        CloseHandle(h);
                    }
                }
            }
            fill_process(&mut peer);
            Ok((LocalStream::Server(server), peer))
        }
    }

    pub async fn connect(endpoint: &str) -> io::Result<LocalStream> {
        for _ in 0..50 {
            match ClientOptions::new().open(endpoint) {
                Ok(c) => return Ok(LocalStream::Client(c)),
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "パイプが混み合っています",
        ))
    }
}

pub use imp::{connect, LocalListener, LocalStream};
