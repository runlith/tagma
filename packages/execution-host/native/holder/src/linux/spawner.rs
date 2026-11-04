use super::sys as kernel;
use crate::posix::sys;
use std::ffi::{CStr, CString, c_char};
use std::os::fd::{AsRawFd, RawFd};

use crate::posix::backend::{Spawn, SpawnFailure as Failure};
enum Action { Duplicate(RawFd, RawFd), Inherit(RawFd), Open(RawFd, CString, i32), Chdir(CString) }
pub struct Spawner { flags: i32, actions: Vec<Action>, low: bool }

fn failed(errno: i32, what: &str) -> Failure { (errno, format!("{what}: {}", std::io::Error::from_raw_os_error(errno))) }

impl Spawner {
    pub fn new(flags: i32) -> Result<Self, Failure> { Ok(Self { flags, actions: Vec::new(), low: false }) }
    pub fn duplicate(&mut self, from: RawFd, to: RawFd) -> Result<(), Failure> { self.actions.push(Action::Duplicate(from, to)); Ok(()) }
    pub fn inherit(&mut self, fd: RawFd) -> Result<(), Failure> { self.actions.push(Action::Inherit(fd)); Ok(()) }
    pub fn open(&mut self, fd: RawFd, path: &CStr, flags: i32) -> Result<(), Failure> { self.actions.push(Action::Open(fd, path.to_owned(), flags)); Ok(()) }
    pub fn placeholder(&mut self, fd: RawFd) -> Result<(), Failure> { self.open(fd, c"/dev/null", libc::O_RDONLY) }
    pub fn chdir(&mut self, path: &CStr) -> Result<(), Failure> { self.actions.push(Action::Chdir(path.to_owned())); Ok(()) }
    pub fn pace(&mut self, low: bool) -> bool { self.low = low; low }

    fn enter(&self, descriptors: &[RawFd], path: &CStr, argv: &[*const c_char], env: &[*const c_char]) -> i32 {
        for &fd in descriptors { if let Err(errno) = sys::cloexec(fd) { return errno; } }
        if self.flags & kernel::SPAWN_SETEXEC == 0 { unsafe {
            let mut mask: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut mask);
            if libc::sigprocmask(libc::SIG_SETMASK, &mask, std::ptr::null_mut()) < 0 { return sys::errno(); }
            for signal in 1..=64 {
                if signal == libc::SIGKILL || signal == libc::SIGSTOP || signal == 32 || signal == 33 { continue; }
                if libc::signal(signal, libc::SIG_DFL) == libc::SIG_ERR { return sys::errno(); }
            }
            if self.flags & kernel::SPAWN_SETSID != 0 && libc::setsid() < 0 { return sys::errno(); }
        } }
        for action in &self.actions {
            let done = match action {
                Action::Duplicate(from, to) => sys::check(unsafe { libc::dup2(*from, *to) }).and_then(|_| sys::inheritable(*to)),
                Action::Inherit(fd) => sys::inheritable(*fd),
                Action::Chdir(path) => sys::check(unsafe { libc::chdir(path.as_ptr()) }),
                Action::Open(fd, path, flags) => {
                    let opened = unsafe { libc::open(path.as_ptr(), *flags) };
                    if opened < 0 { return sys::errno(); }
                    let done = if opened != *fd { sys::check(unsafe { libc::dup2(opened, *fd) }) } else { Ok(()) };
                    if opened != *fd { unsafe { libc::close(opened) }; }
                    done
                }
            };
            if let Err(errno) = done { return errno; }
        }
        if self.low {
            let priority = match kernel::priority(0) { Ok(priority) => priority, Err(errno) => return errno };
            if priority < kernel::LOW_PRIORITY && unsafe { libc::setpriority(libc::PRIO_PROCESS, 0, kernel::LOW_PRIORITY) } < 0 { return sys::errno(); }
        }
        unsafe { libc::execve(path.as_ptr(), argv.as_ptr(), env.as_ptr()) };
        sys::errno()
    }

    pub fn spawn(&self, path: &CStr, argv: &[CString], env: &[CString]) -> Result<i32, Failure> {
        let mut args: Vec<_> = argv.iter().map(|arg| arg.as_ptr()).collect();
        if args.is_empty() { args.push(path.as_ptr()); }
        args.push(std::ptr::null());
        let vars: Vec<_> = env.iter().map(|entry| entry.as_ptr()).chain(std::iter::once(std::ptr::null())).collect();
        let (reader, writer) = sys::pipe().map_err(|errno| failed(errno, "spawn confirmation pipe"))?;
        let descriptors = std::fs::read_dir("/proc/self/fd").map_err(|error| failed(error.raw_os_error().unwrap_or(libc::EIO), "spawn descriptor table"))?
            .map(|entry| entry.map_err(|error| failed(error.raw_os_error().unwrap_or(libc::EIO), "spawn descriptor")))
            .collect::<Result<Vec<_>, _>>()?.into_iter()
            .filter_map(|entry| entry.file_name().to_str().and_then(|name| name.parse::<RawFd>().ok())).collect::<Vec<_>>();
        let descriptors = descriptors.into_iter().filter(|fd| *fd > 2 && unsafe { libc::fcntl(*fd, libc::F_GETFD) } >= 0).collect::<Vec<_>>();
        if self.flags & kernel::SPAWN_SETEXEC != 0 { return Err(failed(self.enter(&descriptors, path, &args, &vars), "exec holder")); }
        let pid = unsafe { libc::fork() };
        if pid < 0 { return Err(failed(sys::errno(), "fork")); }
        if pid == 0 {
            let errno = self.enter(&descriptors, path, &args, &vars);
            let bytes = errno.to_le_bytes();
            let mut at = 0;
            while at < bytes.len() {
                let count = unsafe { libc::write(writer.as_raw_fd(), bytes[at..].as_ptr().cast(), bytes.len() - at) };
                if count > 0 { at += count as usize; }
                else if count < 0 && sys::errno() == libc::EINTR { continue; }
                else { break; }
            }
            unsafe { libc::_exit(127) };
        }
        drop(writer);
        let mut bytes = [0u8; 4];
        let mut at = 0;
        loop {
            let count = unsafe { libc::read(reader.as_raw_fd(), bytes[at..].as_mut_ptr().cast(), bytes.len() - at) };
            if count == 0 && at == 0 { return Ok(pid); }
            if count > 0 {
                at += count as usize;
                if at < bytes.len() { continue; }
            } else if count < 0 && sys::errno() == libc::EINTR { continue; }
            let errno = if at == bytes.len() { i32::from_le_bytes(bytes) } else if count < 0 { sys::errno() } else { libc::EBADMSG };
            unsafe { libc::kill(pid, libc::SIGKILL) };
            loop {
                if unsafe { libc::waitpid(pid, std::ptr::null_mut(), 0) } >= 0 { break; }
                if sys::errno() != libc::EINTR { break; }
            }
            return Err(failed(errno, &format!("exec {}", path.to_string_lossy())));
        }
    }
}

impl Spawn for Spawner {
    fn new(flags: i32) -> Result<Self, Failure> { Spawner::new(flags) }
    fn duplicate(&mut self, from: RawFd, to: RawFd) -> Result<(), Failure> { Spawner::duplicate(self, from, to) }
    fn inherit(&mut self, fd: RawFd) -> Result<(), Failure> { Spawner::inherit(self, fd) }
    fn open(&mut self, fd: RawFd, path: &CStr, flags: i32) -> Result<(), Failure> { Spawner::open(self, fd, path, flags) }
    fn placeholder(&mut self, fd: RawFd) -> Result<(), Failure> { Spawner::placeholder(self, fd) }
    fn chdir(&mut self, path: &CStr) -> Result<(), Failure> { Spawner::chdir(self, path) }
    fn pace(&mut self, low: bool) -> bool { Spawner::pace(self, low) }
    fn spawn(&self, path: &CStr, argv: &[CString], env: &[CString]) -> Result<i32, Failure> { Spawner::spawn(self, path, argv, env) }
}
