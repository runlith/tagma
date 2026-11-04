mod events;
mod spawner;
mod sys;

use crate::posix::backend::{Backend, ChildInfo};
use crate::table::Pace;
use std::ffi::c_char;
use std::fs::File;
use std::os::fd::RawFd;
use std::path::PathBuf;

pub struct Kernel;

impl Backend for Kernel {
    type Queue = events::Queue;
    type Spawner = spawner::Spawner;
    const TERMINAL_EXPENSE: u8 = 7;
    const PIPE_EXPENSE: u8 = 11;
    const OPEN_MAX: libc::rlim_t = sys::OPEN_MAX;
    const RSS_UNIT: u64 = 1024;
    const ZOMBIE_SIGNAL_SUCCEEDS: bool = true;
    const EXTRA_SIGNALS: &'static [(&'static str, i32)] = &[("SIGPWR", libc::SIGPWR), ("SIGSTKFLT", libc::SIGSTKFLT)];
    const SPAWN_SETSID: i32 = sys::SPAWN_SETSID;
    const SPAWN_SETEXEC: i32 = sys::SPAWN_SETEXEC;
    const SPAWN_CLOEXEC_DEFAULT: i32 = sys::SPAWN_CLOEXEC_DEFAULT;
    const SPAWN_SETSIGDEF: i32 = sys::SPAWN_SETSIGDEF;
    const SPAWN_SETSIGMASK: i32 = sys::SPAWN_SETSIGMASK;
    const SPAWN_START_SUSPENDED: i32 = sys::SPAWN_START_SUSPENDED;
    fn ground() -> Result<(), String> { sys::ground() }
    fn pace_raises() -> Result<bool, i32> { sys::pace_raises() }
    fn no_sigpipe(fd: RawFd) -> Result<(), i32> { sys::no_sigpipe(fd) }
    fn socket_nosigpipe(fd: RawFd) -> Result<(), i32> { sys::socket_nosigpipe(fd) }
    fn led_alone(group: i32) -> Result<bool, i32> { sys::led_alone(group) }
    fn birth(pid: i32) -> Result<String, i32> { sys::birth(pid) }
    fn lower(pid: i32) -> Result<(), i32> { sys::lower(pid) }
    fn tempo(pid: i32, birth: &str, initial: Pace, pace: Pace) -> Result<bool, i32> { sys::tempo(pid, birth, initial, pace) }
    fn monotonic_ms() -> u64 { sys::monotonic_ms() }
    fn child_info(info: &libc::siginfo_t) -> ChildInfo { unsafe { ChildInfo { pid: info.si_pid(), status: info.si_status() } } }
    fn image_source() -> Result<PathBuf, String> { Ok(PathBuf::from("/proc/self/exe")) }
    fn verify_image(_: &[u8]) -> Result<(), String> { Ok(()) }
    fn sync_image(file: &File) -> Result<(), String> { file.sync_all().map_err(|error| error.to_string()) }
    fn output_path() -> Result<PathBuf, String> { std::fs::read_link("/proc/self/fd/2").map_err(|error| error.to_string()) }
    unsafe fn exchange(from: *const c_char, to: *const c_char) -> i32 { unsafe { sys::exchange(from, to) } }
}
