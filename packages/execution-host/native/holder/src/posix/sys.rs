use crate::frames::Reason;
use crate::platform::Failure;
use std::ffi::c_int;
use std::io;
use std::os::fd::{FromRawFd, OwnedFd, RawFd};

#[cfg(target_os = "macos")]
#[path = "../macos/sys.rs"]
mod native;
#[cfg(target_os = "linux")]
#[path = "../linux/sys.rs"]
mod native;
pub use native::*;

pub const CLD_EXITED: c_int = 1;
pub const CLD_KILLED: c_int = 2;
pub const CLD_DUMPED: c_int = 3;

pub fn errno() -> i32 { io::Error::last_os_error().raw_os_error().filter(|code| *code > 0).unwrap_or(libc::EIO) }
pub fn check(result: c_int) -> Result<(), i32> { if result < 0 { Err(errno()) } else { Ok(()) } }
pub fn cloexec(fd: RawFd) -> Result<(), i32> { check(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) }) }
pub fn inheritable(fd: RawFd) -> Result<(), i32> { check(unsafe { libc::fcntl(fd, libc::F_SETFD, 0) }) }

pub fn nonblocking(fd: RawFd) -> Result<(), i32> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    check(flags)?;
    check(unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) })
}

pub fn pipe() -> Result<(OwnedFd, OwnedFd), i32> {
    let mut ends = [0 as c_int; 2];
    check(unsafe { libc::pipe(ends.as_mut_ptr()) })?;
    let pair = unsafe { (OwnedFd::from_raw_fd(ends[0]), OwnedFd::from_raw_fd(ends[1])) };
    cloexec(ends[0])?;
    cloexec(ends[1])?;
    Ok(pair)
}

pub fn socket_pair() -> Result<(OwnedFd, OwnedFd), i32> {
    let mut ends = [0 as c_int; 2];
    check(unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, ends.as_mut_ptr()) })?;
    let pair = unsafe { (OwnedFd::from_raw_fd(ends[0]), OwnedFd::from_raw_fd(ends[1])) };
    for fd in ends { cloexec(fd)?; socket_nosigpipe(fd)?; }
    Ok(pair)
}

pub fn classify(errno: i32) -> Reason {
    match errno {
        libc::EMFILE | libc::ENFILE => Reason::Capacity,
        libc::ESRCH => Reason::Gone,
        libc::ENOENT => Reason::NotFound,
        libc::EACCES | libc::EPERM => Reason::Denied,
        libc::ESTALE => Reason::Changed,
        libc::ENOTSUP => Reason::Unsupported,
        _ => Reason::Os,
    }
}

pub fn failure(errno: i32, what: &str) -> Failure { Failure::new(classify(errno), format!("{what}: {}", io::Error::from_raw_os_error(errno))) }
