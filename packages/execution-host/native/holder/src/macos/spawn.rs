use super::sys::{self, POSIX_SPAWN_SETSID, QOS_CLASS_UTILITY};
use crate::frames::{Shape, Stdin};
use crate::table::{Pace, Transport};
use std::ffi::{CStr, CString, c_char, c_int};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::ptr;
use std::rc::Rc;

pub const CONTROL_FD: RawFd = 3;
pub const CONTROL_VARIABLE: &str = "EXECUTION_HOLDER_FD";
const STATUS_FD: RawFd = 4;
pub const TERMINAL_DESCRIPTOR_EXPENSE: u8 = 4;
pub const PIPE_DESCRIPTOR_EXPENSE: u8 = 8;

pub struct Program {
    pub path: CString,
    pub argv: Vec<CString>,
    pub env: Vec<CString>,
    pub cwd: Option<CString>,
}

pub struct Started {
    pub pid: i32,
    pub group: i32,
    pub birth: String,
    pub pace: Pace,
    pub transport: Transport<OwnedFd>,
    pub status: OwnedFd,
    pub environment: Vec<u8>,
}

pub type Failure = (i32, String);

fn failed(errno: i32, what: &str) -> Failure {
    (errno, format!("{what}: {}", std::io::Error::from_raw_os_error(errno)))
}

fn outcome(code: c_int, what: &str) -> Result<(), Failure> {
    if code == 0 { Ok(()) } else { Err(failed(code, what)) }
}

pub struct Spawner {
    attr: libc::posix_spawnattr_t,
    actions: libc::posix_spawn_file_actions_t,
}

impl Spawner {
    pub fn new(flags: c_int) -> Result<Self, Failure> {
        let mut spawner = Self { attr: ptr::null_mut(), actions: ptr::null_mut() };
        let code = unsafe { libc::posix_spawnattr_init(&mut spawner.attr) };
        if code != 0 {
            return Err(failed(code, "posix_spawnattr_init"));
        }
        let code = unsafe { libc::posix_spawn_file_actions_init(&mut spawner.actions) };
        if code != 0 {
            return Err(failed(code, "posix_spawn_file_actions_init"));
        }
        let mut empty: libc::sigset_t = 0;
        let mut every: libc::sigset_t = 0;
        unsafe {
            libc::sigemptyset(&mut empty);
            libc::sigfillset(&mut every);
        }
        outcome(unsafe { libc::posix_spawnattr_setflags(&mut spawner.attr, flags as libc::c_short) }, "posix_spawnattr_setflags")?;
        outcome(unsafe { libc::posix_spawnattr_setsigmask(&mut spawner.attr, &empty) }, "posix_spawnattr_setsigmask")?;
        outcome(unsafe { libc::posix_spawnattr_setsigdefault(&mut spawner.attr, &every) }, "posix_spawnattr_setsigdefault")?;
        Ok(spawner)
    }

    fn duplicate(&mut self, from: RawFd, to: RawFd) -> Result<(), Failure> {
        outcome(unsafe { libc::posix_spawn_file_actions_adddup2(&mut self.actions, from, to) }, "posix_spawn_file_actions_adddup2")
    }

    pub fn inherit(&mut self, fd: RawFd) -> Result<(), Failure> {
        outcome(unsafe { sys::posix_spawn_file_actions_addinherit_np(&mut self.actions, fd) }, "posix_spawn_file_actions_addinherit_np")
    }

    pub fn placeholder(&mut self, fd: RawFd) -> Result<(), Failure> {
        self.open(fd, c"/dev/null", libc::O_RDONLY)
    }

    fn open(&mut self, fd: RawFd, path: &CStr, flags: c_int) -> Result<(), Failure> {
        outcome(unsafe { libc::posix_spawn_file_actions_addopen(&mut self.actions, fd, path.as_ptr(), flags, 0) }, "posix_spawn_file_actions_addopen")
    }

    fn chdir(&mut self, path: &CStr) -> Result<(), Failure> {
        outcome(unsafe { sys::posix_spawn_file_actions_addchdir_np(&mut self.actions, path.as_ptr()) }, "posix_spawn_file_actions_addchdir_np")
    }

    pub fn spawn(&self, path: &CStr, argv: &[CString], env: &[CString]) -> Result<i32, Failure> {
        let mut args: Vec<*mut c_char> = argv.iter().map(|value| value.as_ptr().cast_mut()).collect();
        if args.is_empty() {
            args.push(path.as_ptr().cast_mut());
        }
        args.push(ptr::null_mut());
        let mut vars: Vec<*mut c_char> = env.iter().map(|value| value.as_ptr().cast_mut()).collect();
        vars.push(ptr::null_mut());
        let mut pid: libc::pid_t = 0;
        let code = unsafe { libc::posix_spawn(&mut pid, path.as_ptr(), &self.actions, &self.attr, args.as_ptr(), vars.as_ptr()) };
        if code != 0 {
            return Err(failed(code, &format!("posix_spawn {}", path.to_string_lossy())));
        }
        Ok(pid)
    }
}

impl Drop for Spawner {
    fn drop(&mut self) {
        unsafe {
            if !self.actions.is_null() {
                libc::posix_spawn_file_actions_destroy(&mut self.actions);
            }
            if !self.attr.is_null() {
                libc::posix_spawnattr_destroy(&mut self.attr);
            }
        }
    }
}

pub fn abandon(pid: i32) {
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
        libc::kill(pid, libc::SIGKILL);
    }
}

fn terminal(rows: u16, cols: u16) -> Result<(OwnedFd, OwnedFd, CString), Failure> {
    let mut master: c_int = -1;
    let mut slave: c_int = -1;
    let mut size = libc::winsize { ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0 };
    if unsafe { libc::openpty(&mut master, &mut slave, ptr::null_mut(), ptr::null_mut(), &mut size) } < 0 {
        return Err(failed(sys::errno(), "openpty"));
    }
    let pair = unsafe { (OwnedFd::from_raw_fd(master), OwnedFd::from_raw_fd(slave)) };
    sys::cloexec(master).map_err(|e| failed(e, "fcntl FD_CLOEXEC"))?;
    sys::cloexec(slave).map_err(|e| failed(e, "fcntl FD_CLOEXEC"))?;
    let name = unsafe { libc::ttyname(slave) };
    if name.is_null() {
        return Err(failed(sys::errno(), "ttyname"));
    }
    let name = unsafe { CStr::from_ptr(name) }.to_owned();
    Ok((pair.0, pair.1, name))
}

pub fn child(image: &CStr, program: &Program, shape: &Shape, requested: Pace, soft_nofile: libc::rlim_t) -> Result<Started, (Failure, Option<i32>)> {
    let mut born = None;
    let attempted = (|| -> Result<Started, Failure> {
        let mut flags = POSIX_SPAWN_SETSID | libc::POSIX_SPAWN_CLOEXEC_DEFAULT | libc::POSIX_SPAWN_SETSIGDEF | libc::POSIX_SPAWN_SETSIGMASK;
        if matches!(requested, Pace::Lowest) {
            flags |= libc::POSIX_SPAWN_START_SUSPENDED;
        }
        let mut spawner = Spawner::new(flags)?;
        let mut pace = Pace::Full;
        if matches!(requested, Pace::Low) && unsafe { sys::posix_spawnattr_set_qos_class_np(&mut spawner.attr, QOS_CLASS_UTILITY) } == 0 {
            pace = Pace::Low;
        }
        let mut child_ends: Vec<OwnedFd> = Vec::new();
        let (reader, writer) = sys::socket_pair().map_err(|e| failed(e, "startup socketpair"))?;
        sys::nonblocking(reader.as_raw_fd()).map_err(|e| failed(e, "nonblocking startup socket"))?;
        spawner.duplicate(writer.as_raw_fd(), STATUS_FD)?;
        child_ends.push(writer);
        let transport = match shape {
            Shape::Terminal { rows, cols } => {
                if *rows == 0 || *cols == 0 {
                    return Err((libc::EINVAL, "terminal geometry must be at least 1x1".into()));
                }
                let (master, slave, name) = terminal(*rows, *cols)?;
                spawner.open(0, &name, libc::O_RDWR)?;
                spawner.duplicate(0, 1)?;
                spawner.duplicate(0, 2)?;
                child_ends.push(slave);
                Transport::Terminal { handles: vec![Rc::new(master)], name: Some(name.into_bytes()) }
            }
            Shape::Pipes { stdin } => {
                let (stdout, stdout_end) = sys::pipe().map_err(|e| failed(e, "pipe"))?;
                let (stderr, stderr_end) = sys::pipe().map_err(|e| failed(e, "pipe"))?;
                spawner.duplicate(stdout_end.as_raw_fd(), 1)?;
                spawner.duplicate(stderr_end.as_raw_fd(), 2)?;
                child_ends.push(stdout_end);
                child_ends.push(stderr_end);
                let input = match stdin {
                    Stdin::Pipe => {
                        let (input_end, input) = sys::pipe().map_err(|e| failed(e, "pipe"))?;
                        spawner.duplicate(input_end.as_raw_fd(), 0)?;
                        child_ends.push(input_end);
                        Some(input)
                    }
                    Stdin::Inherit => {
                        spawner.inherit(0)?;
                        None
                    }
                    Stdin::Ignore => {
                        spawner.open(0, c"/dev/null", libc::O_RDONLY)?;
                        None
                    }
                };
                Transport::Pipes { stdout: Some(Rc::new(stdout)), stderr: Some(Rc::new(stderr)), piped: input.is_some(), stdin: input.map(Rc::new) }
            }
        };
        if let Some(cwd) = &program.cwd {
            spawner.chdir(cwd)?;
        }
        let executable = image.to_owned();
        let kind = if matches!(shape, Shape::Terminal { .. }) { "pty" } else { "pipes" };
        let mut argv = vec![
            executable.clone(),
            CString::new("--launch").unwrap(),
            CString::new(kind).unwrap(),
            CString::new(soft_nofile.to_string()).unwrap(),
            program.path.clone(),
        ];
        argv.extend(program.argv.iter().cloned());
        let length: usize = program.env.iter().map(|entry| entry.as_bytes_with_nul().len()).sum();
        let mut environment = (length as u64).to_le_bytes().to_vec();
        environment.extend(program.env.iter().flat_map(|entry| entry.as_bytes_with_nul().iter().copied()));
        let pid = spawner.spawn(&executable, &argv, &[])?;
        born = Some(pid);
        drop(child_ends);
        let prepared = (|| -> Result<(String, i32), Failure> {
            match &transport {
                Transport::Terminal { handles, .. } => {
                    for master in handles {
                        sys::nonblocking(master.as_raw_fd()).map_err(|e| failed(e, "fcntl O_NONBLOCK"))?;
                    }
                }
                Transport::Pipes { stdout, stderr, stdin, .. } => {
                    for output in stdout.iter().chain(stderr.iter()) {
                        sys::nonblocking(output.as_raw_fd()).map_err(|e| failed(e, "fcntl O_NONBLOCK"))?;
                    }
                    if let Some(stdin) = stdin {
                        sys::nonblocking(stdin.as_raw_fd()).map_err(|e| failed(e, "fcntl O_NONBLOCK"))?;
                        sys::no_sigpipe(stdin.as_raw_fd()).map_err(|e| failed(e, "fcntl F_SETNOSIGPIPE"))?;
                    }
                }
            }
            if matches!(requested, Pace::Lowest) {
                if unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid as libc::id_t, libc::PRIO_DARWIN_BG) } == 0 {
                    pace = Pace::Lowest;
                }
                if unsafe { libc::kill(pid, libc::SIGCONT) } < 0 {
                    return Err(failed(sys::errno(), "resume the suspended child"));
                }
            }
            let group = unsafe { libc::getpgid(pid) };
            if group < 0 {
                return Err(failed(sys::errno(), "getpgid"));
            }
            Ok((sys::birth(pid).map_err(|e| failed(e, "proc_pidinfo"))?, group))
        })();
        let (birth, group) = prepared?;
        Ok(Started { pid, group, birth, pace, transport, status: reader, environment })
    })();
    attempted.map_err(|failure| {
        if let Some(pid) = born {
            abandon(pid);
        }
        (failure, born)
    })
}

fn supplied_environment(fd: RawFd) -> Result<Vec<CString>, i32> {
    let mut prefix = [0u8; 8];
    let mut read = 0;
    while read < prefix.len() {
        let count = unsafe { libc::read(fd, prefix[read..].as_mut_ptr().cast(), prefix.len() - read) };
        if count == 0 { return Err(libc::EBADMSG); }
        if count < 0 {
            let errno = sys::errno();
            if errno == libc::EINTR { continue; }
            return Err(errno);
        }
        read += count as usize;
    }
    let length = usize::try_from(u64::from_le_bytes(prefix)).map_err(|_| libc::E2BIG)?;
    let mut bytes = Vec::new();
    let mut landing = [0u8; 8192];
    loop {
        let read = unsafe { libc::read(fd, landing.as_mut_ptr().cast(), landing.len()) };
        if read == 0 { break; }
        if read < 0 {
            let errno = sys::errno();
            if errno == libc::EINTR { continue; }
            return Err(errno);
        }
        if (read as usize) > length.saturating_sub(bytes.len()) { return Err(libc::EBADMSG); }
        bytes.extend_from_slice(&landing[..read as usize]);
    }
    if bytes.len() != length { return Err(libc::EBADMSG); }
    if !bytes.is_empty() && bytes.last() != Some(&0) { return Err(libc::EINVAL); }
    bytes.split_inclusive(|byte| *byte == 0)
        .map(|entry| CString::from_vec_with_nul(entry.to_vec()).map_err(|_| libc::EINVAL))
        .collect()
}

pub fn enter() -> i32 {
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(2).collect();
    let valid = unsafe {
        let mut status: libc::stat = std::mem::zeroed();
        libc::getsid(0) == libc::getpid()
            && libc::fstat(STATUS_FD, &mut status) == 0
            && status.st_mode & libc::S_IFMT == libc::S_IFSOCK
            && libc::fcntl(STATUS_FD, libc::F_GETFL) & libc::O_ACCMODE == libc::O_RDWR
    };
    let result = (|| -> Result<(), i32> {
        if !valid || args.len() < 3 {
            return Err(libc::EINVAL);
        }
        sys::cloexec(STATUS_FD)?;
        let environment = supplied_environment(STATUS_FD)?;
        let mut vars: Vec<*const c_char> = environment.iter().map(|entry| entry.as_ptr()).collect();
        vars.push(ptr::null());
        let soft = args[1].to_str().and_then(|value| value.parse::<libc::rlim_t>().ok()).ok_or(libc::EINVAL)?;
        let mut limit: libc::rlimit = unsafe { std::mem::zeroed() };
        sys::check(unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) })?;
        limit.rlim_cur = soft;
        sys::check(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) })?;
        match args[0].as_bytes() {
            b"pty" => {
                sys::check(unsafe { libc::ioctl(0, libc::TIOCSCTTY.into(), 0) })?;
                sys::check(unsafe { libc::tcsetpgrp(0, libc::getpgrp()) })?;
            }
            b"pipes" => {}
            _ => return Err(libc::EINVAL),
        }
        let argv: Vec<CString> = args[2..].iter().map(|arg| CString::new(arg.as_bytes()).map_err(|_| libc::EINVAL)).collect::<Result<_, _>>()?;
        let path = &argv[0];
        let mut pointers: Vec<*const c_char> = argv[1..].iter().map(|arg| arg.as_ptr()).collect();
        if pointers.is_empty() {
            pointers.push(path.as_ptr());
        }
        pointers.push(ptr::null());
        for signal in 1..32 {
            if signal == libc::SIGKILL || signal == libc::SIGSTOP {
                continue;
            }
            if unsafe { libc::signal(signal, libc::SIG_DFL) } == libc::SIG_ERR {
                return Err(sys::errno());
            }
        }
        let mut mask: libc::sigset_t = 0;
        sys::check(unsafe { libc::sigemptyset(&mut mask) })?;
        sys::check(unsafe { libc::sigprocmask(libc::SIG_SETMASK, &mask, ptr::null_mut()) })?;
        unsafe { libc::execve(path.as_ptr(), pointers.as_ptr(), vars.as_ptr()) };
        Err(sys::errno())
    })();
    if let Err(errno) = result {
        let bytes = errno.to_le_bytes();
        let mut offset = 0;
        while offset < bytes.len() {
            let wrote = unsafe { libc::write(STATUS_FD, bytes[offset..].as_ptr().cast(), bytes.len() - offset) };
            if wrote > 0 {
                offset += wrote as usize;
            } else if wrote < 0 && sys::errno() == libc::EINTR {
                continue;
            } else {
                break;
            }
        }
    }
    1
}

fn environment() -> Vec<CString> {
    let mut vars: Vec<CString> = std::env::vars_os()
        .filter(|(name, _)| name.as_bytes() != CONTROL_VARIABLE.as_bytes() && name.as_bytes() != super::output::LIMIT_VARIABLE.as_bytes())
        .filter_map(|(name, value)| {
            let mut entry = name.as_bytes().to_vec();
            entry.push(b'=');
            entry.extend_from_slice(value.as_bytes());
            CString::new(entry).ok()
        })
        .collect();
    vars.push(CString::new(format!("{CONTROL_VARIABLE}={CONTROL_FD}")).expect("the variable carries no NUL"));
    vars
}

pub fn logic(argv: &[CString], control: &OwnedFd, output: Option<RawFd>) -> Result<i32, Failure> {
    let moved = unsafe { libc::fcntl(control.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
    if moved < 0 {
        return Err(failed(sys::errno(), "fcntl F_DUPFD_CLOEXEC"));
    }
    let moved = unsafe { OwnedFd::from_raw_fd(moved) };
    let mut spawner = Spawner::new(libc::POSIX_SPAWN_CLOEXEC_DEFAULT | libc::POSIX_SPAWN_SETSIGDEF | libc::POSIX_SPAWN_SETSIGMASK)?;
    for fd in 0..=2 {
        if fd != 0 && let Some(output) = output {
            spawner.duplicate(output, fd)?;
        } else {
            spawner.inherit(fd)?;
        }
    }
    spawner.duplicate(moved.as_raw_fd(), CONTROL_FD)?;
    spawner.spawn(&argv[0], argv, &environment())
}
