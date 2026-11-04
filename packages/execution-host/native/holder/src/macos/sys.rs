use crate::posix::sys::{check, errno};
use crate::table::Pace;
use std::ffi::{c_char, c_int};
use std::os::fd::RawFd;

pub const SPAWN_SETSID: c_int = 0x0400;
pub const SPAWN_CLOEXEC_DEFAULT: c_int = libc::POSIX_SPAWN_CLOEXEC_DEFAULT;
pub const SPAWN_SETSIGDEF: c_int = libc::POSIX_SPAWN_SETSIGDEF;
pub const SPAWN_SETSIGMASK: c_int = libc::POSIX_SPAWN_SETSIGMASK;
pub const SPAWN_START_SUSPENDED: c_int = libc::POSIX_SPAWN_START_SUSPENDED;
pub const SPAWN_SETEXEC: c_int = libc::POSIX_SPAWN_SETEXEC;
pub const OPEN_MAX: libc::rlim_t = 10_240;
pub const QOS_CLASS_UTILITY: u32 = 0x11;

unsafe extern "C" {
    pub fn posix_spawn_file_actions_addinherit_np(actions: *mut libc::posix_spawn_file_actions_t, fd: c_int) -> c_int;
    pub fn posix_spawn_file_actions_addchdir_np(actions: *mut libc::posix_spawn_file_actions_t, path: *const c_char) -> c_int;
    pub fn posix_spawnattr_set_qos_class_np(attr: *mut libc::posix_spawnattr_t, class: u32) -> c_int;
}

pub fn ground() -> Result<(), String> { Ok(()) }
pub fn pace_raises() -> Result<bool, i32> { Ok(true) }
pub fn no_sigpipe(fd: RawFd) -> Result<(), i32> { check(unsafe { libc::fcntl(fd, 73, 1) }) }
pub fn socket_nosigpipe(fd: RawFd) -> Result<(), i32> {
    let on: c_int = 1;
    check(unsafe { libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE, (&on as *const c_int).cast(), size_of::<c_int>() as libc::socklen_t) })
}

pub fn led_alone(group: i32) -> bool {
    let size = unsafe { libc::proc_listpgrppids(group, std::ptr::null_mut(), 0) };
    if size <= 0 { return false; }
    let mut members = vec![0 as libc::pid_t; size as usize / size_of::<libc::pid_t>() + 8];
    let room = (members.len() * size_of::<libc::pid_t>()) as c_int;
    let listed = unsafe { libc::proc_listpgrppids(group, members.as_mut_ptr().cast(), room) };
    if listed <= 0 || listed >= room { return false; }
    members[..listed as usize / size_of::<libc::pid_t>()].iter().all(|member| *member == 0 || *member == group)
}

fn bsd(pid: i32) -> Result<libc::proc_bsdinfo, i32> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = size_of::<libc::proc_bsdinfo>() as c_int;
    if unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) } != size { return Err(errno()); }
    Ok(info)
}

pub fn birth(pid: i32) -> Result<String, i32> { bsd(pid).map(|info| format!("{}:{}", info.pbi_start_tvsec, info.pbi_start_tvusec)) }
pub fn lower(pid: i32) -> Result<(), i32> { check(unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid as libc::id_t, libc::PRIO_DARWIN_BG) }) }

pub fn tempo(pid: i32, birth: &str, initial: Pace, pace: Pace) -> Result<bool, i32> {
    let (seconds, micros) = birth.split_once(':').ok_or(libc::EINVAL)?;
    let expected = (seconds.parse::<u64>().map_err(|_| libc::EINVAL)?, micros.parse::<u64>().map_err(|_| libc::EINVAL)?);
    let info = bsd(pid)?;
    if (info.pbi_start_tvsec, info.pbi_start_tvusec) != expected { return Err(libc::ESTALE); }
    if (matches!(pace, Pace::Low) && !matches!(initial, Pace::Low)) || (matches!(pace, Pace::Full) && matches!(initial, Pace::Low)) { return Err(libc::ENOTSUP); }
    let lowest = matches!(pace, Pace::Lowest);
    if (info.pbi_flags & 0x10000 != 0) == lowest { return Ok(false); }
    check(unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid as libc::id_t, if lowest { libc::PRIO_DARWIN_BG } else { 0 }) })?;
    Ok(true)
}

pub fn monotonic_ms() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut now) };
    (now.tv_sec.max(0) as u64) * 1000 + (now.tv_nsec.max(0) as u64) / 1_000_000
}

pub unsafe fn exchange(from: *const c_char, to: *const c_char) -> i32 { unsafe { libc::renamex_np(from, to, libc::RENAME_SWAP) } }
