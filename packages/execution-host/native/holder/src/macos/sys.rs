use crate::frames::Reason;
use crate::platform::Failure;
use crate::table::Pace;
use std::ffi::{c_char, c_int};
use std::io;
use std::os::fd::{FromRawFd, OwnedFd, RawFd};

pub const POSIX_SPAWN_SETSID: c_int = 0x0400;
pub const QOS_CLASS_UTILITY: u32 = 0x11;
pub const F_SETNOSIGPIPE: c_int = 73;
pub const CLD_EXITED: c_int = 1;
pub const CLD_KILLED: c_int = 2;
pub const CLD_DUMPED: c_int = 3;
pub const OPEN_MAX: libc::rlim_t = 10_240;

unsafe extern "C" {
    pub fn posix_spawn_file_actions_addinherit_np(actions: *mut libc::posix_spawn_file_actions_t, fd: c_int) -> c_int;
    pub fn posix_spawn_file_actions_addchdir_np(actions: *mut libc::posix_spawn_file_actions_t, path: *const c_char) -> c_int;
    pub fn posix_spawnattr_set_qos_class_np(attr: *mut libc::posix_spawnattr_t, class: u32) -> c_int;
}

pub fn errno() -> i32 {
    match io::Error::last_os_error().raw_os_error() {
        Some(0) | None => libc::EIO,
        Some(code) => code,
    }
}

pub fn check(result: c_int) -> Result<(), i32> {
    if result < 0 { Err(errno()) } else { Ok(()) }
}

pub fn cloexec(fd: RawFd) -> Result<(), i32> {
    check(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) })
}

pub fn led_alone(group: i32) -> bool {
    let size = unsafe { libc::proc_listpgrppids(group, std::ptr::null_mut(), 0) };
    if size <= 0 {
        return false;
    }
    let mut members = vec![0 as libc::pid_t; size as usize / size_of::<libc::pid_t>() + 8];
    let room = (members.len() * size_of::<libc::pid_t>()) as c_int;
    let listed = unsafe { libc::proc_listpgrppids(group, members.as_mut_ptr().cast(), room) };
    if listed <= 0 || listed >= room {
        return false;
    }
    members[..listed as usize / size_of::<libc::pid_t>()].iter().all(|member| *member == 0 || *member == group)
}

pub fn inheritable(fd: RawFd) -> Result<(), i32> {
    check(unsafe { libc::fcntl(fd, libc::F_SETFD, 0) })
}

pub fn nonblocking(fd: RawFd) -> Result<(), i32> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    check(flags)?;
    check(unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) })
}

pub fn no_sigpipe(fd: RawFd) -> Result<(), i32> {
    check(unsafe { libc::fcntl(fd, F_SETNOSIGPIPE, 1) })
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
    let on: c_int = 1;
    for fd in ends {
        cloexec(fd)?;
        check(unsafe {
            libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE, (&on as *const c_int).cast(), size_of::<c_int>() as libc::socklen_t)
        })?;
    }
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

pub fn failure(errno: i32, what: &str) -> Failure {
    Failure::new(classify(errno), format!("{what}: {}", io::Error::from_raw_os_error(errno)))
}

const PROC_FLAG_EXT_DARWINBG: u32 = 0x10000;

fn bsd(pid: i32) -> Result<libc::proc_bsdinfo, i32> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = size_of::<libc::proc_bsdinfo>() as c_int;
    let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    if read != size {
        return Err(errno());
    }
    Ok(info)
}

pub fn started(pid: i32) -> Result<(u64, u64), i32> {
    bsd(pid).map(|info| (info.pbi_start_tvsec, info.pbi_start_tvusec))
}

pub fn birth(pid: i32) -> Result<String, i32> {
    started(pid).map(|(seconds, micros)| format!("{seconds}:{micros}"))
}

pub fn tempo(pid: i32, birth: &str, initial: Pace, pace: Pace) -> Result<bool, i32> {
    let (seconds, micros) = birth.split_once(':').ok_or(libc::EINVAL)?;
    let expected = (seconds.parse::<u64>().map_err(|_| libc::EINVAL)?, micros.parse::<u64>().map_err(|_| libc::EINVAL)?);
    let info = bsd(pid)?;
    if (info.pbi_start_tvsec, info.pbi_start_tvusec) != expected { return Err(libc::ESTALE); }
    if (matches!(pace, Pace::Low) && !matches!(initial, Pace::Low)) || (matches!(pace, Pace::Full) && matches!(initial, Pace::Low)) {
        return Err(libc::ENOTSUP);
    }
    let lowest = matches!(pace, Pace::Lowest);
    if (info.pbi_flags & PROC_FLAG_EXT_DARWINBG != 0) == lowest {
        return Ok(false);
    }
    let priority = if lowest { libc::PRIO_DARWIN_BG } else { 0 };
    check(unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid as libc::id_t, priority) })?;
    Ok(true)
}

pub fn monotonic_ms() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut now) };
    (now.tv_sec.max(0) as u64) * 1000 + (now.tv_nsec.max(0) as u64) / 1_000_000
}
