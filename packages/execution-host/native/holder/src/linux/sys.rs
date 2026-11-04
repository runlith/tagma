use super::check;
use crate::table::Pace;
use std::ffi::c_char;
use std::os::fd::RawFd;

pub const SPAWN_SETSID: i32 = 1;
pub const SPAWN_SETEXEC: i32 = 2;
pub const SPAWN_CLOEXEC_DEFAULT: i32 = 0;
pub const SPAWN_SETSIGDEF: i32 = 0;
pub const SPAWN_SETSIGMASK: i32 = 0;
pub const SPAWN_START_SUSPENDED: i32 = 0;
pub const OPEN_MAX: libc::rlim_t = libc::RLIM_INFINITY;
pub const LOW_PRIORITY: i32 = 5;
const LOWEST_PRIORITY: i32 = 19;
const TEMPO_PASSES: usize = 8;

pub fn ground() -> Result<(), String> {
    check(unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) }).map_err(|errno| format!("PR_SET_CHILD_SUBREAPER: errno {errno}"))
}

pub fn no_sigpipe(_: RawFd) -> Result<(), i32> { Ok(()) }
pub fn socket_nosigpipe(_: RawFd) -> Result<(), i32> { Ok(()) }

pub fn led_alone(group: i32) -> bool {
    let Ok(pids) = crate::procfs::pids() else { return false; };
    for pid in pids {
        if pid == group { continue; }
        match crate::procfs::stat(pid) {
            Ok(read) if read.group == group as u32 && !read.zombie => return false,
            Ok(_) | Err(libc::ESRCH) => {},
            Err(_) => return false,
        }
    }
    true
}

pub fn birth(pid: i32) -> Result<String, i32> { crate::procfs::stat(pid).map(|read| format!("{}:0", read.started)) }

pub fn pace_raises() -> Result<bool, i32> {
    static RAISES: std::sync::OnceLock<Result<bool, i32>> = std::sync::OnceLock::new();
    *RAISES.get_or_init(|| {
        let text = std::fs::read_to_string("/proc/self/status").map_err(crate::procfs::error)?;
        let value = text.lines().find_map(|line| line.strip_prefix("CapEff:")).ok_or(libc::EBADMSG)?;
        let caps = u64::from_str_radix(value.trim(), 16).map_err(|_| libc::EBADMSG)?;
        Ok(caps & (1 << 23) != 0)
    })
}

pub fn priority(pid: i32) -> Result<i32, i32> {
    unsafe { *libc::__errno_location() = 0; }
    let priority = unsafe { libc::getpriority(libc::PRIO_PROCESS, pid as libc::id_t) };
    let code = unsafe { *libc::__errno_location() };
    if priority == -1 && code != 0 { Err(code) } else { Ok(priority) }
}

pub fn lower(pid: i32) -> Result<(), i32> {
    if !pace_raises()? { return Err(libc::ENOTSUP); }
    check(unsafe { libc::setpriority(libc::PRIO_PROCESS, pid as libc::id_t, LOWEST_PRIORITY) })
}

fn tasks(pid: i32) -> Result<Vec<i32>, i32> {
    std::fs::read_dir(format!("/proc/{pid}/task"))
        .map_err(crate::procfs::error)?
        .map(|entry| {
            let entry = entry.map_err(crate::procfs::error)?;
            entry.file_name().to_str().and_then(|name| name.parse().ok()).ok_or(libc::EBADMSG)
        })
        .collect()
}

pub fn tempo(pid: i32, expected: &str, initial: Pace, pace: Pace) -> Result<bool, i32> {
    if birth(pid)? != expected { return Err(libc::ESTALE); }
    let wanted = match pace { Pace::Full => priority(0)?, Pace::Low => priority(0)?.max(LOW_PRIORITY), Pace::Lowest => LOWEST_PRIORITY };
    let mut moved = false;
    for _ in 0..TEMPO_PASSES {
        let mut changed = false;
        for task in tasks(pid)? {
            let priority = match priority(task) {
                Ok(priority) => priority,
                Err(libc::ESRCH) => continue,
                Err(code) => return Err(code),
            };
            if priority == wanted { continue; }
            if matches!(initial, Pace::Low) && matches!(pace, Pace::Full) { return Err(libc::ENOTSUP); }
            if matches!(pace, Pace::Lowest) && !pace_raises()? { return Err(libc::ENOTSUP); }
            if wanted < priority && !pace_raises()? { return Err(libc::ENOTSUP); }
            match check(unsafe { libc::setpriority(libc::PRIO_PROCESS, task as libc::id_t, wanted) }) {
                Ok(()) | Err(libc::ESRCH) => changed = true,
                Err(code) => return Err(code),
            }
        }
        if !changed { break; }
        moved = true;
    }
    Ok(moved)
}

pub fn monotonic_ms() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    now.tv_sec.max(0) as u64 * 1000 + now.tv_nsec.max(0) as u64 / 1_000_000
}

pub unsafe fn exchange(from: *const c_char, to: *const c_char) -> i32 {
    unsafe { libc::syscall(libc::SYS_renameat2, libc::AT_FDCWD, from, libc::AT_FDCWD, to, libc::RENAME_EXCHANGE) as i32 }
}
