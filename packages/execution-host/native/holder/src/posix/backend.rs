use crate::platform::{Event, Timer};
use crate::table::Pace;
use std::collections::HashSet;
use std::ffi::{CStr, CString, c_char};
use std::fs::File;
use std::os::fd::RawFd;
use std::path::PathBuf;

pub type SpawnFailure = (i32, String);

pub trait Spawn: Sized {
    fn new(flags: i32) -> Result<Self, SpawnFailure>;
    fn duplicate(&mut self, from: RawFd, to: RawFd) -> Result<(), SpawnFailure>;
    fn inherit(&mut self, fd: RawFd) -> Result<(), SpawnFailure>;
    fn open(&mut self, fd: RawFd, path: &CStr, flags: i32) -> Result<(), SpawnFailure>;
    fn placeholder(&mut self, fd: RawFd) -> Result<(), SpawnFailure>;
    fn chdir(&mut self, path: &CStr) -> Result<(), SpawnFailure>;
    fn pace(&mut self, low: bool) -> bool;
    fn spawn(&self, path: &CStr, argv: &[CString], env: &[CString]) -> Result<i32, SpawnFailure>;
}

pub trait Events: Sized {
    fn new() -> Result<Self, i32>;
    fn read(&self, fd: RawFd) -> Result<(), i32>;
    fn write(&self, fd: RawFd, on: bool) -> Result<(), i32>;
    fn child(&self, pid: i32) -> Result<(), i32>;
    fn reaped(&self, pid: i32);
    fn timer(&self, timer: Timer, ms: u64) -> Result<(), i32>;
    fn sweep(&self, owned: &HashSet<u64>) -> Result<(), i32>;
    fn wait(&self, out: &mut Vec<Event<RawFd>>) -> Result<(), i32>;
}

pub struct ChildInfo {
    pub pid: i32,
    pub status: i32,
}

pub trait Backend: 'static {
    type Queue: Events;
    type Spawner: Spawn;
    const TERMINAL_EXPENSE: u8;
    const PIPE_EXPENSE: u8;
    const OPEN_MAX: libc::rlim_t;
    const RSS_UNIT: u64;
    const ZOMBIE_SIGNAL_SUCCEEDS: bool;
    const EXTRA_SIGNALS: &'static [(&'static str, i32)];
    const SPAWN_SETSID: i32;
    const SPAWN_SETEXEC: i32;
    const SPAWN_CLOEXEC_DEFAULT: i32;
    const SPAWN_SETSIGDEF: i32;
    const SPAWN_SETSIGMASK: i32;
    const SPAWN_START_SUSPENDED: i32;
    fn ground() -> Result<(), String>;
    fn pace_raises() -> Result<bool, i32>;
    fn no_sigpipe(fd: RawFd) -> Result<(), i32>;
    fn socket_nosigpipe(fd: RawFd) -> Result<(), i32>;
    fn led_alone(group: i32) -> Result<bool, i32>;
    fn birth(pid: i32) -> Result<String, i32>;
    fn lower(pid: i32) -> Result<(), i32>;
    fn tempo(pid: i32, birth: &str, initial: Pace, pace: Pace) -> Result<bool, i32>;
    fn monotonic_ms() -> u64;
    fn child_info(info: &libc::siginfo_t) -> ChildInfo;
    fn image_source() -> Result<PathBuf, String>;
    fn verify_image(bytes: &[u8]) -> Result<(), String>;
    fn sync_image(file: &File) -> Result<(), String>;
    fn output_path() -> Result<PathBuf, String>;
    unsafe fn exchange(from: *const c_char, to: *const c_char) -> i32;
}
