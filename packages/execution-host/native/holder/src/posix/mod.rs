macro_rules! eprintln {
    ($($message:tt)*) => { crate::posix::output::message(format_args!($($message)*)) };
}

mod output;
#[cfg(target_os = "macos")]
#[path = "../macos/events.rs"]
mod events;
#[cfg(target_os = "linux")]
#[path = "../linux/events.rs"]
mod events;
#[cfg(target_os = "macos")]
#[path = "../macos/spawner.rs"]
mod spawner;
#[cfg(target_os = "linux")]
#[path = "../linux/spawner.rs"]
mod spawner;
mod signals;
mod image;
mod rescue;
mod spawn;
mod succession;
mod sys;

use crate::frames::{Action, Launch, Reason, Target};
use crate::platform::{Event, Failure, Inheritance, Io, Launching, Opened, Part, Platform, Spawned, Timer};
use crate::table::{Exit, Pace, Prepared, Transport, Usage};
use events::Queue;
use succession::Mode;
#[cfg(target_os = "linux")]
use std::collections::HashSet;
use std::ffi::{CString, OsStr, OsString, c_int};
use std::fs::OpenOptions;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

const CLAIM_FILE: &str = "writer.lock";
const CAPABILITIES: [&str; 7] = [
    "named-signals",
    "pipe-graceful-stop",
    "pace-raise",
    "terminal-foreground",
    "terminal-survives-holder",
    "pipe-survives-holder",
    "holder-replaces-itself",
];

pub struct Posix {
    queue: Queue,
    claim: Rc<OwnedFd>,
    handle_limit: u64,
    child_nofile: libc::rlim_t,
    capabilities: Vec<&'static str>,
    image: image::Image,
    pid: u32,
    state: PathBuf,
    inherited: Option<succession::Inherited>,
    output: Option<output::Capture>,
}

pub struct Child {
    pid: i32,
}

pub struct Status {
    channel: OwnedFd,
    environment: Vec<u8>,
    written: usize,
    sent: bool,
    bytes: [u8; 4],
    read: usize,
}

fn micros(time: libc::timeval) -> u64 {
    (time.tv_sec.max(0) as u64) * 1_000_000 + (time.tv_usec.max(0) as u64)
}

fn text(value: &str, what: &str) -> Result<CString, Failure> {
    CString::new(value).map_err(|_| Failure::new(Reason::Invalid, format!("{what} carries a NUL")))
}

fn program(launch: &Launch) -> Result<spawn::Program, Failure> {
    Ok(spawn::Program {
        path: text(&launch.path, "the program path")?,
        argv: launch.argv.iter().map(|arg| text(arg, "an argument")).collect::<Result<_, _>>()?,
        env: launch.env.iter().map(|entry| text(entry, "an environment entry")).collect::<Result<_, _>>()?,
        cwd: launch.cwd.as_deref().map(|cwd| text(cwd, "the cwd")).transpose()?,
    })
}

fn deliver(pid: i32, target: Target, signal: c_int, exited: impl FnOnce() -> bool) -> Result<(), Failure> {
    let aim = match target {
        Target::Leader => pid,
        Target::Work => -pid,
    };
    if unsafe { libc::kill(aim, signal) } == 0 {
        return Ok(());
    }
    let errno = sys::errno();
    if errno == libc::EPERM && matches!(target, Target::Work) && exited() && sys::led_alone(pid) {
        return Err(Failure::new(Reason::Gone, format!("the work of {pid} has no member but its exited leader")));
    }
    Err(sys::failure(errno, &format!("kill {aim} {}", signals::name(signal))))
}

fn rights(fd: RawFd, bytes: &[u8], fds: &[Rc<OwnedFd>]) -> isize {
    let raw: Vec<RawFd> = fds.iter().map(|shared| shared.as_raw_fd()).collect();
    let length = std::mem::size_of_val(raw.as_slice()) as u32;
    let mut control = vec![0u8; unsafe { libc::CMSG_SPACE(length) } as usize];
    let mut part = libc::iovec { iov_base: bytes.as_ptr().cast_mut().cast(), iov_len: bytes.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut part;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as _;
    unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(length) as _;
        std::ptr::copy_nonoverlapping(raw.as_ptr().cast::<u8>(), libc::CMSG_DATA(header), length as usize);
        libc::sendmsg(fd, &message, 0)
    }
}

fn standard_descriptors() -> Result<(), String> {
    for fd in 0..=2 {
        if unsafe { libc::fcntl(fd, libc::F_GETFD) } >= 0 {
            continue;
        }
        let opened = unsafe { libc::open(c"/dev/null".as_ptr(), libc::O_RDWR) };
        if opened != fd {
            return Err(format!("descriptor {fd} could not be opened on /dev/null"));
        }
    }
    Ok(())
}

fn dispositions() {
    unsafe {
        let mut empty: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut empty);
        libc::sigprocmask(libc::SIG_SETMASK, &empty, std::ptr::null_mut());
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        libc::signal(libc::SIGCHLD, libc::SIG_DFL);
    }
}

fn descriptor_room() -> Result<(u64, libc::rlim_t), String> {
    let mut limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } < 0 {
        return Err(format!("getrlimit RLIMIT_NOFILE: errno {}", sys::errno()));
    }
    let inherited = limit.rlim_cur;
    let wanted = limit.rlim_max.min(sys::OPEN_MAX);
    if wanted > limit.rlim_cur {
        limit.rlim_cur = wanted;
        if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) } < 0 {
            return Err(format!("setrlimit RLIMIT_NOFILE: errno {}", sys::errno()));
        }
    }
    Ok((limit.rlim_cur, inherited))
}

fn ground(state: &Path) -> Result<(u64, libc::rlim_t, Vec<&'static str>), String> {
    if !state.is_dir() {
        return Err(format!("{} is not a directory", state.display()));
    }
    standard_descriptors()?;
    let room = descriptor_room()?;
    dispositions();
    session()?;
    sys::ground()?;
    let raises = sys::pace_raises().map_err(|errno| format!("the scheduling capability could not be read: errno {errno}"))?;
    let capabilities = CAPABILITIES.into_iter().filter(|capability| *capability != "pace-raise" || raises).collect();
    Ok((room.0, room.1, capabilities))
}

fn session() -> Result<(), String> {
    if unsafe { libc::getsid(0) } == unsafe { libc::getpid() } {
        return Ok(());
    }
    if unsafe { libc::setsid() } < 0 {
        return Err(format!("setsid: errno {}", sys::errno()));
    }
    Ok(())
}

fn claim(state: &Path) -> Result<Option<OwnedFd>, String> {
    let path = state.join(CLAIM_FILE);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC)
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let fd = OwnedFd::from(file);
    if unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } < 0 {
        let errno = sys::errno();
        return if errno == libc::EWOULDBLOCK { Ok(None) } else { Err(format!("flock {}: errno {errno}", path.display())) };
    }
    Ok(Some(fd))
}

impl Platform for Posix {
    type Handle = OwnedFd;
    type Channel = OwnedFd;
    type Process = Child;
    type Status = Status;
    type Token = RawFd;

    const TERMINAL_EXPENSE: u8 = spawn::TERMINAL_DESCRIPTOR_EXPENSE;
    const PIPE_EXPENSE: u8 = spawn::PIPE_DESCRIPTOR_EXPENSE;

    fn open() -> Result<Opened<Self>, String> {
        let all: Vec<OsString> = std::env::args_os().skip(1).collect();
        let mode = all.first().map(OsString::as_os_str);
        if mode == Some(OsStr::new("--launch")) {
            return Ok(Opened::Entered(spawn::enter()));
        }
        output::install()?;
        let carrying = [succession::SUCCESSOR, succession::RETURNED, succession::VERIFY];
        if mode.is_some_and(|mode| carrying.iter().any(|carried| mode == OsStr::new(carried))) {
            let inherited = succession::inherited(&all)?;
            if inherited.mode == Mode::Activated {
                rescue::arm(&inherited);
            }
            let attempt = (|| {
                let (handle_limit, _, capabilities) = ground(&inherited.state)?;
                let table = inherited.table()?;
                if inherited.mode == Mode::Verifying {
                    Queue::new().map_err(|e| format!("event queue: errno {e}"))?;
                    return Ok(Err(table));
                }
                let image = image::Image::open(&inherited.state)?;
                let queue = Queue::new().map_err(|e| format!("event queue: errno {e}"))?;
                Ok::<_, String>(Ok((handle_limit, capabilities, table, image, queue)))
            })();
            let (handle_limit, capabilities, table, image, queue) = match attempt {
                Ok(Ok(taken)) => taken,
                Ok(Err(table)) => return Ok(Opened::Verifying(table)),
                Err(detail) => return Err(inherited.retreat(&[], &detail, false)),
            };
            let carried = Inheritance { table, activated: inherited.mode == Mode::Activated };
            let output = output::Capture::open(&queue)?;
            let platform = Self {
                queue,
                claim: Rc::new(unsafe { OwnedFd::from_raw_fd(inherited.claim) }),
                handle_limit,
                child_nofile: inherited.child_nofile,
                capabilities,
                image,
                pid: std::process::id(),
                state: inherited.state.clone(),
                inherited: Some(inherited),
                output,
            };
            return Ok(Opened::Claimed { platform, logic: Vec::new(), carried: Some(carried) });
        }
        let Some(state) = all.first().map(Path::new) else {
            return Err("expected the state directory and the logic program with its arguments".into());
        };
        let logic = all[1..]
            .iter()
            .map(|arg| arg.to_str().map(str::to_string).ok_or_else(|| format!("{} is not UTF-8", arg.display())))
            .collect::<Result<Vec<_>, _>>()?;
        if !logic.first().is_some_and(|program| Path::new(program).is_absolute()) {
            return Err("the logic program must be named by an absolute path".into());
        }
        let (handle_limit, child_nofile, capabilities) = ground(state)?;
        let Some(claim) = claim(state)? else {
            return Ok(Opened::Held(state.display().to_string()));
        };
        let image = image::Image::open(state)?;
        let queue = Queue::new().map_err(|e| format!("event queue: errno {e}"))?;
        let pid = std::process::id();
        let output = output::Capture::open(&queue)?;
        let platform = Self { queue, claim: Rc::new(claim), handle_limit, child_nofile, capabilities, image, pid, state: state.to_path_buf(), inherited: None, output };
        Ok(Opened::Claimed { platform, logic, carried: None })
    }

    fn diagnostic(message: std::fmt::Arguments<'_>) {
        output::message(message);
    }

    fn flush_output(&mut self) {
        if let Some(output) = &self.output { output.drain(true); }
    }

    fn pid(&self) -> u32 {
        self.pid
    }

    fn claim(&self) -> Rc<OwnedFd> {
        Rc::clone(&self.claim)
    }

    fn handle_limit(&self) -> Option<u64> {
        (self.handle_limit != libc::RLIM_INFINITY).then_some(self.handle_limit)
    }

    fn capabilities(&self) -> &[&'static str] {
        &self.capabilities
    }

    fn start_logic(&mut self, argv: &[String]) -> Result<(Child, OwnedFd), String> {
        let argv = argv
            .iter()
            .map(|arg| CString::new(arg.as_str()).map_err(|_| "an argument of the logic carries a NUL".to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        if argv.is_empty() {
            return Err("no logic program is named".into());
        }
        let (ours, theirs) = sys::socket_pair().map_err(|e| format!("socketpair: errno {e}"))?;
        sys::nonblocking(ours.as_raw_fd()).map_err(|e| format!("fcntl O_NONBLOCK: errno {e}"))?;
        sys::nonblocking(theirs.as_raw_fd()).map_err(|e| format!("fcntl O_NONBLOCK: errno {e}"))?;
        self.queue.read(ours.as_raw_fd()).map_err(|e| format!("event queue: errno {e}"))?;
        let pid = spawn::logic(&argv, &theirs, self.output.as_ref().map(output::Capture::writer)).map_err(|(_, detail)| detail)?;
        #[cfg(target_os = "linux")]
        if let Err(errno) = self.queue.child(pid) {
            unsafe { libc::kill(pid, libc::SIGKILL) };
            return Err(format!("the logic could not be watched: errno {errno}"));
        }
        Ok((Child { pid }, ours))
    }

    fn end(&mut self, logic: &Child) {
        unsafe { libc::kill(logic.pid, libc::SIGKILL) };
    }

    fn token(&self, channel: &OwnedFd) -> RawFd {
        channel.as_raw_fd()
    }

    fn hand(&mut self, _: &OwnedFd, _: &[Rc<OwnedFd>]) -> Result<Vec<u64>, String> {
        Ok(Vec::new())
    }

    fn send(&mut self, channel: &OwnedFd, bytes: &[u8], handles: &[Rc<OwnedFd>]) -> Io {
        let fd = channel.as_raw_fd();
        let written = if handles.is_empty() { unsafe { libc::send(fd, bytes.as_ptr().cast(), bytes.len(), 0) } } else { rights(fd, bytes, handles) };
        if written >= 0 {
            return Io::Done(written as usize);
        }
        match sys::errno() {
            libc::EAGAIN | libc::EINTR => Io::Blocked,
            errno => Io::Broken(format!("the channel to the logic refused a write: errno {errno}")),
        }
    }

    fn watch_write(&mut self, channel: &OwnedFd, on: bool) -> Result<(), String> {
        self.queue.write(channel.as_raw_fd(), on).map_err(|errno| format!("write interest of the channel could not be changed: errno {errno}"))
    }

    fn receive(&mut self, channel: &OwnedFd, into: &mut [u8]) -> Io {
        let read = unsafe { libc::recv(channel.as_raw_fd(), into.as_mut_ptr().cast(), into.len(), 0) };
        if read > 0 {
            return Io::Done(read as usize);
        }
        if read == 0 {
            return Io::Ended;
        }
        match sys::errno() {
            libc::EAGAIN | libc::EINTR => Io::Blocked,
            libc::ECONNRESET => Io::Ended,
            errno => Io::Broken(format!("the channel to the logic refused a read: errno {errno}")),
        }
    }

    fn wait(&mut self, events: &mut Vec<Event<RawFd>>) -> Result<(), String> {
        self.queue.wait(events).map_err(|e| format!("event queue: errno {e}"))?;
        if let Some(output) = &self.output {
            events.retain(|event| {
                if matches!(event, Event::Readable(fd) if *fd == output.reader()) {
                    output.drain(false);
                    false
                } else {
                    true
                }
            });
        }
        Ok(())
    }

    fn timer(&mut self, timer: Timer, ms: u64) -> Result<(), String> {
        self.queue.timer(timer, ms).map_err(|e| format!("event queue: errno {e}"))
    }

    fn now_ms(&self) -> u64 {
        sys::monotonic_ms()
    }

    fn launch(&mut self, launch: &Launch) -> Result<Launching<Self>, (Failure, Option<Child>)> {
        let program = program(launch).map_err(|failure| (failure, None))?;
        let started = spawn::child(self.image.path(), &program, &launch.shape, launch.pace, self.child_nofile)
            .map_err(|((errno, detail), born)| (Failure::new(sys::classify(errno), detail), born.map(|pid| Child { pid })))?;
        let token = started.status.as_raw_fd();
        let spawned = Spawned {
            process: Child { pid: started.pid },
            pid: started.pid as u32,
            work: started.group as u32,
            birth: started.birth,
            pace: started.pace,
            transport: started.transport,
        };
        #[cfg(target_os = "linux")]
        if let Err(errno) = self.queue.child(started.pid) {
            spawn::abandon(started.pid);
            return Err((sys::failure(errno, "the launch could not be watched"), Some(spawned.process)));
        }
        if let Err(errno) = self.queue.read(token).and_then(|_| self.queue.write(token, true)) {
            spawn::abandon(started.pid);
            return Err((sys::failure(errno, "the launch channel could not be watched"), Some(spawned.process)));
        }
        Ok(Launching { spawned, status: Status { channel: started.status, environment: started.environment, written: 0, sent: false, bytes: [0; 4], read: 0 }, token })
    }

    fn settle(&mut self, status: &mut Status) -> Option<Result<(), Failure>> {
        let fd = status.channel.as_raw_fd();
        while status.written < status.environment.len() {
            let left = &status.environment[status.written..];
            let sent = unsafe { libc::send(fd, left.as_ptr().cast(), left.len(), 0) };
            if sent > 0 {
                status.written += sent as usize;
                continue;
            }
            let errno = if sent == 0 { libc::EPIPE } else { sys::errno() };
            if errno == libc::EAGAIN || errno == libc::EINTR { return None; }
            return Some(Err(sys::failure(errno, "the launch environment could not be sent")));
        }
        if !status.sent {
            if let Err(errno) = sys::check(unsafe { libc::shutdown(fd, libc::SHUT_WR) }).and_then(|_| self.queue.write(fd, false)) {
                return Some(Err(sys::failure(errno, "the launch environment could not be ended")));
            }
            status.sent = true;
            status.environment.clear();
        }
        let count = unsafe { libc::read(fd, status.bytes[status.read..].as_mut_ptr().cast(), 4 - status.read) };
        let errno = if count < 0 {
            let errno = sys::errno();
            if errno == libc::EAGAIN || errno == libc::EINTR {
                return None;
            }
            errno
        } else if count > 0 {
            status.read += count as usize;
            if status.read < 4 {
                return None;
            }
            i32::from_le_bytes(status.bytes)
        } else if status.read != 0 {
            libc::EBADMSG
        } else {
            return Some(Ok(()));
        };
        Some(Err(sys::failure(errno, "terminal startup")))
    }

    fn observe(&mut self, process: &Child) -> Option<Exit> {
        #[cfg(target_os = "linux")]
        if let Err(errno) = self.queue.child(process.pid) { eprintln!("execution-holder: pidfd watch of {} failed: errno {errno}", process.pid); }
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let found = unsafe { libc::waitid(libc::P_PID, process.pid as libc::id_t, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) };
        #[cfg(target_os = "macos")]
        let (pid, status) = (info.si_pid, info.si_status);
        #[cfg(target_os = "linux")]
        let (pid, status) = unsafe { (info.si_pid(), info.si_status()) };
        if found < 0 || pid != process.pid {
            return None;
        }
        match info.si_code {
            sys::CLD_EXITED => Some(Exit::Code(status)),
            sys::CLD_KILLED | sys::CLD_DUMPED => Some(Exit::Signal(signals::name(status))),
            _ => None,
        }
    }

    fn reap(&mut self, process: &mut Child) -> Result<Option<(Exit, Usage)>, Failure> {
        #[cfg(target_os = "linux")]
        self.queue.child(process.pid).map_err(|errno| sys::failure(errno, "pidfd watch"))?;
        let mut status: c_int = 0;
        let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
        let reaped = unsafe { libc::wait4(process.pid, &mut status, libc::WNOHANG, &mut usage) };
        if reaped < 0 {
            return Err(sys::failure(sys::errno(), &format!("wait4 {}", process.pid)));
        }
        if reaped == 0 {
            return Ok(None);
        }
        let exit = if libc::WIFEXITED(status) { Exit::Code(libc::WEXITSTATUS(status)) } else { Exit::Signal(signals::name(libc::WTERMSIG(status))) };
        #[cfg(target_os = "linux")]
        self.queue.reaped(process.pid);
        #[cfg(target_os = "macos")]
        let rss_unit = 1;
        #[cfg(target_os = "linux")]
        let rss_unit = 1024;
        let usage = Usage { user_micros: micros(usage.ru_utime), system_micros: micros(usage.ru_stime), peak_rss_bytes: usage.ru_maxrss.max(0) as u64 * rss_unit };
        Ok(Some((exit, usage)))
    }

    #[cfg(target_os = "linux")]
    fn sweep(&mut self, owned: &HashSet<u64>) -> Result<(), String> {
        self.queue.sweep(owned).map_err(|errno| format!("errno {errno}"))
    }

    fn close(&mut self, _: &mut Child, _: Part, handles: Vec<Rc<OwnedFd>>) {
        drop(handles);
    }

    fn release(&mut self, _: &mut Child, transport: Transport<OwnedFd>) {
        drop(transport);
    }

    fn act(&mut self, process: &mut Child, target: Target, action: Action) -> Result<(), Failure> {
        let signal = match action {
            Action::HangUp => libc::SIGHUP,
            Action::Interrupt => libc::SIGINT,
            Action::Terminate => libc::SIGTERM,
            Action::Kill => libc::SIGKILL,
        };
        deliver(process.pid, target, signal, || self.observe(process).is_some())
    }

    fn signal(&mut self, process: &mut Child, target: Target, name: &str) -> Result<(), Failure> {
        let Some(signal) = signals::number(name) else {
            return Err(Failure::new(Reason::Invalid, format!("{name} is not a signal of this platform")));
        };
        deliver(process.pid, target, signal, || self.observe(process).is_some())
    }

    fn abandon(&mut self, process: &mut Child) {
        spawn::abandon(process.pid);
    }

    fn pace(&mut self, pid: u32, birth: &str, initial: Pace, next: Pace) -> Result<bool, Failure> {
        sys::tempo(pid as i32, birth, initial, next).map_err(|errno| sys::failure(errno, &format!("tempo of {pid}")))
    }

    fn handle_value(handle: &OwnedFd) -> u64 {
        handle.as_raw_fd() as u64
    }

    fn process_value(process: &Child) -> u64 {
        process.pid as u64
    }

    fn keep_handle(value: u64) -> Result<(), String> {
        let fd = RawFd::try_from(value).map_err(|_| format!("{value} is not a descriptor"))?;
        let mut status: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstat(fd, &mut status) } < 0 {
            return Err(format!("descriptor {fd} is not open: errno {}", sys::errno()));
        }
        sys::cloexec(fd).map_err(|errno| format!("descriptor {fd} could not be kept from children: errno {errno}"))
    }

    fn own_handle(value: u64) -> OwnedFd {
        unsafe { OwnedFd::from_raw_fd(value as RawFd) }
    }

    fn seal(&mut self) {
        if let Some(inherited) = &self.inherited {
            rescue::disarm();
            inherited.seal();
        }
    }

    fn retreat(&mut self, handles: &[u64], why: &str) -> String {
        let Some(inherited) = &self.inherited else { return why.to_string() };
        let handles: Vec<RawFd> = handles.iter().map(|value| *value as RawFd).collect();
        inherited.retreat(&handles, why, true)
    }

    fn adopt_process(value: u64) -> Result<Child, String> {
        let pid = i32::try_from(value).ok().filter(|pid| *pid > 0).ok_or_else(|| format!("{value} is not a process id"))?;
        Ok(Child { pid })
    }

    fn entry(&mut self) -> Result<Option<Prepared>, Failure> {
        succession::entry(&self.state)
    }

    fn differs(&mut self, holder: &str) -> Result<bool, Failure> {
        let next = succession::part(&self.state, holder);
        let digest = image::digest_of(&next)
            .map_err(|error| sys::failure(error.raw_os_error().unwrap_or(libc::EIO), &format!("read {}", next.display())))?;
        Ok(self.image.digest() != Some(digest.as_str()))
    }

    fn prepare(&mut self, holder: &str, table: &[u8], handles: &[Rc<OwnedFd>]) -> Result<Child, Failure> {
        let handles: Vec<RawFd> = handles.iter().map(|handle| handle.as_raw_fd()).collect();
        let pid = succession::verify(&self.state, holder, self.claim.as_raw_fd(), self.child_nofile, table, &handles)?;
        #[cfg(target_os = "linux")]
        if let Err(errno) = self.queue.child(pid) { eprintln!("execution-holder: pidfd watch of verifier {pid} failed: errno {errno}"); }
        Ok(Child { pid })
    }

    fn rotate(&mut self) -> Result<(), Failure> {
        succession::rotate(&self.state)
    }

    fn restore(&mut self) -> Result<(), Failure> {
        succession::restore(&self.state)
    }

    fn replace(&mut self, holder: &str, table: &[u8], handles: &[Rc<OwnedFd>]) -> Failure {
        succession::replace(&self.state, holder, self.claim.as_raw_fd(), self.child_nofile, table, handles)
    }
}
