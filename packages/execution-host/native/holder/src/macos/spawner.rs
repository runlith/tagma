use super::sys;
use std::ffi::{CStr, CString, c_char, c_int};
use std::os::fd::RawFd;
use std::ptr;

pub type Failure = (i32, String);
fn failed(errno: i32, what: &str) -> Failure { (errno, format!("{what}: {}", std::io::Error::from_raw_os_error(errno))) }
fn outcome(code: c_int, what: &str) -> Result<(), Failure> { if code == 0 { Ok(()) } else { Err(failed(code, what)) } }

pub struct Spawner { pub attr: libc::posix_spawnattr_t, actions: libc::posix_spawn_file_actions_t }

impl Spawner {
    pub fn new(flags: c_int) -> Result<Self, Failure> {
        let mut spawner = Self { attr: ptr::null_mut(), actions: ptr::null_mut() };
        let code = unsafe { libc::posix_spawnattr_init(&mut spawner.attr) };
        if code != 0 { return Err(failed(code, "posix_spawnattr_init")); }
        let code = unsafe { libc::posix_spawn_file_actions_init(&mut spawner.actions) };
        if code != 0 { return Err(failed(code, "posix_spawn_file_actions_init")); }
        let mut empty: libc::sigset_t = 0;
        let mut every: libc::sigset_t = 0;
        unsafe { libc::sigemptyset(&mut empty); libc::sigfillset(&mut every); }
        outcome(unsafe { libc::posix_spawnattr_setflags(&mut spawner.attr, flags as libc::c_short) }, "posix_spawnattr_setflags")?;
        outcome(unsafe { libc::posix_spawnattr_setsigmask(&mut spawner.attr, &empty) }, "posix_spawnattr_setsigmask")?;
        outcome(unsafe { libc::posix_spawnattr_setsigdefault(&mut spawner.attr, &every) }, "posix_spawnattr_setsigdefault")?;
        Ok(spawner)
    }

    pub fn duplicate(&mut self, from: RawFd, to: RawFd) -> Result<(), Failure> {
        outcome(unsafe { libc::posix_spawn_file_actions_adddup2(&mut self.actions, from, to) }, "posix_spawn_file_actions_adddup2")
    }

    pub fn inherit(&mut self, fd: RawFd) -> Result<(), Failure> {
        outcome(unsafe { sys::posix_spawn_file_actions_addinherit_np(&mut self.actions, fd) }, "posix_spawn_file_actions_addinherit_np")
    }

    pub fn placeholder(&mut self, fd: RawFd) -> Result<(), Failure> { self.open(fd, c"/dev/null", libc::O_RDONLY) }

    pub fn open(&mut self, fd: RawFd, path: &CStr, flags: c_int) -> Result<(), Failure> {
        outcome(unsafe { libc::posix_spawn_file_actions_addopen(&mut self.actions, fd, path.as_ptr(), flags, 0) }, "posix_spawn_file_actions_addopen")
    }

    pub fn chdir(&mut self, path: &CStr) -> Result<(), Failure> {
        outcome(unsafe { sys::posix_spawn_file_actions_addchdir_np(&mut self.actions, path.as_ptr()) }, "posix_spawn_file_actions_addchdir_np")
    }

    pub fn pace(&mut self, low: bool) -> bool {
        low && unsafe { sys::posix_spawnattr_set_qos_class_np(&mut self.attr, sys::QOS_CLASS_UTILITY) } == 0
    }

    pub fn spawn(&self, path: &CStr, argv: &[CString], env: &[CString]) -> Result<i32, Failure> {
        let mut args: Vec<*mut c_char> = argv.iter().map(|value| value.as_ptr().cast_mut()).collect();
        if args.is_empty() { args.push(path.as_ptr().cast_mut()); }
        args.push(ptr::null_mut());
        let mut vars: Vec<*mut c_char> = env.iter().map(|value| value.as_ptr().cast_mut()).collect();
        vars.push(ptr::null_mut());
        let mut pid: libc::pid_t = 0;
        let code = unsafe { libc::posix_spawn(&mut pid, path.as_ptr(), &self.actions, &self.attr, args.as_ptr(), vars.as_ptr()) };
        if code != 0 { return Err(failed(code, &format!("posix_spawn {}", path.to_string_lossy()))); }
        Ok(pid)
    }
}

impl Drop for Spawner {
    fn drop(&mut self) {
        unsafe {
            if !self.actions.is_null() { libc::posix_spawn_file_actions_destroy(&mut self.actions); }
            if !self.attr.is_null() { libc::posix_spawnattr_destroy(&mut self.attr); }
        }
    }
}
