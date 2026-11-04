use super::sys;
use crate::platform::{Event, Timer};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};

const CHILD: u64 = 1 << 62;
const SIGNAL: u64 = 1 << 63;
const RESTART: u64 = SIGNAL + 1;
const PREPARATION: u64 = SIGNAL + 2;
const DEPARTURE: u64 = SIGNAL + 3;

pub struct Queue {
    fd: OwnedFd,
    signal: OwnedFd,
    timers: [OwnedFd; 3],
    interests: RefCell<HashMap<RawFd, u32>>,
    children: RefCell<HashMap<i32, OwnedFd>>,
    known: RefCell<HashSet<i32>>,
}

fn own(fd: RawFd) -> Result<OwnedFd, i32> { sys::check(fd)?; Ok(unsafe { OwnedFd::from_raw_fd(fd) }) }

impl Queue {
    pub fn new() -> Result<Self, i32> {
        let fd = own(unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) })?;
        let mut mask: libc::sigset_t = unsafe { std::mem::zeroed() };
        sys::check(unsafe { libc::sigemptyset(&mut mask) })?;
        sys::check(unsafe { libc::sigaddset(&mut mask, libc::SIGCHLD) })?;
        sys::check(unsafe { libc::sigprocmask(libc::SIG_BLOCK, &mask, std::ptr::null_mut()) })?;
        let signal = own(unsafe { libc::signalfd(-1, &mask, libc::SFD_CLOEXEC | libc::SFD_NONBLOCK) })?;
        let timer = || own(unsafe { libc::timerfd_create(libc::CLOCK_MONOTONIC, libc::TFD_CLOEXEC | libc::TFD_NONBLOCK) });
        let queue = Self { fd, signal, timers: [timer()?, timer()?, timer()?], interests: RefCell::new(HashMap::new()), children: RefCell::new(HashMap::new()), known: RefCell::new(HashSet::new()) };
        queue.change(libc::EPOLL_CTL_ADD, queue.signal.as_raw_fd(), SIGNAL, libc::EPOLLIN as u32)?;
        for (index, timer) in queue.timers.iter().enumerate() { queue.change(libc::EPOLL_CTL_ADD, timer.as_raw_fd(), RESTART + index as u64, libc::EPOLLIN as u32)?; }
        Ok(queue)
    }

    fn change(&self, operation: i32, fd: RawFd, token: u64, events: u32) -> Result<(), i32> {
        let mut event = libc::epoll_event { events, u64: token };
        sys::check(unsafe { libc::epoll_ctl(self.fd.as_raw_fd(), operation, fd, &mut event) })
    }

    fn interest(&self, fd: RawFd, read: bool, write: bool) -> Result<(), i32> {
        let mut interests = self.interests.borrow_mut();
        let previous = interests.get(&fd).copied().unwrap_or(0);
        let flags = if read { previous | libc::EPOLLIN as u32 } else if write { previous | libc::EPOLLOUT as u32 } else { previous & !(libc::EPOLLOUT as u32) };
        match self.change(libc::EPOLL_CTL_MOD, fd, fd as u64, flags | libc::EPOLLRDHUP as u32) {
            Err(libc::ENOENT) => self.change(libc::EPOLL_CTL_ADD, fd, fd as u64, flags | libc::EPOLLRDHUP as u32)?,
            outcome => outcome?,
        }
        interests.insert(fd, flags);
        Ok(())
    }

    pub fn read(&self, fd: RawFd) -> Result<(), i32> { self.interest(fd, true, false) }
    pub fn write(&self, fd: RawFd, on: bool) -> Result<(), i32> { self.interest(fd, false, on) }

    pub fn child(&self, pid: i32) -> Result<(), i32> {
        self.known.borrow_mut().insert(pid);
        let mut children = self.children.borrow_mut();
        if children.contains_key(&pid) { return Ok(()); }
        let fd = own(unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) as i32 })?;
        self.change(libc::EPOLL_CTL_ADD, fd.as_raw_fd(), CHILD | pid as u64, (libc::EPOLLIN | libc::EPOLLONESHOT) as u32)?;
        children.insert(pid, fd);
        Ok(())
    }

    pub fn reaped(&self, pid: i32) { self.children.borrow_mut().remove(&pid); self.known.borrow_mut().remove(&pid); }

    pub fn timer(&self, timer: Timer, ms: u64) -> Result<(), i32> {
        let index = match timer { Timer::Restart => 0, Timer::Preparation => 1, Timer::Departure => 2 };
        let nanos = ms.max(1) as u128 * 1_000_000;
        let interval = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        let value = libc::timespec { tv_sec: (nanos / 1_000_000_000) as libc::time_t, tv_nsec: (nanos % 1_000_000_000) as libc::c_long };
        let settings = libc::itimerspec { it_interval: interval, it_value: value };
        sys::check(unsafe { libc::timerfd_settime(self.timers[index].as_raw_fd(), 0, &settings, std::ptr::null_mut()) })
    }

    fn adopted(&self) -> Result<(), i32> {
        let path = format!("/proc/self/task/{}/children", std::process::id());
        let text = std::fs::read_to_string(path).map_err(crate::procfs::error)?;
        let children = self.known.borrow();
        for child in text.split_whitespace() {
            let pid = child.parse::<i32>().map_err(|_| libc::EBADMSG)?;
            if children.contains(&pid) { continue; }
            if unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) } < 0 {
                let errno = sys::errno();
                if errno != libc::ECHILD && errno != libc::EINTR { return Err(errno); }
            }
        }
        Ok(())
    }

    pub fn wait(&self, out: &mut Vec<Event<RawFd>>) -> Result<(), i32> {
        let mut events = [libc::epoll_event { events: 0, u64: 0 }; 32];
        let count = unsafe { libc::epoll_wait(self.fd.as_raw_fd(), events.as_mut_ptr(), events.len() as i32, -1) };
        if count < 0 { let errno = sys::errno(); return if errno == libc::EINTR { Ok(()) } else { Err(errno) }; }
        for event in &events[..count as usize] {
            let token = event.u64;
            if token == SIGNAL {
                let mut info: libc::signalfd_siginfo = unsafe { std::mem::zeroed() };
                loop {
                    let read = unsafe { libc::read(self.signal.as_raw_fd(), (&mut info as *mut libc::signalfd_siginfo).cast(), size_of::<libc::signalfd_siginfo>()) };
                    if read > 0 { continue; }
                    if read < 0 && sys::errno() == libc::EINTR { continue; }
                    if read < 0 && sys::errno() != libc::EAGAIN { return Err(sys::errno()); }
                    break;
                }
                out.push(Event::Child);
            } else if [RESTART, PREPARATION, DEPARTURE].contains(&token) {
                let mut value = 0u64;
                let index = (token - RESTART) as usize;
                if unsafe { libc::read(self.timers[index].as_raw_fd(), (&mut value as *mut u64).cast(), size_of::<u64>()) } < 0 { return Err(sys::errno()); }
                out.push(Event::Timer(match token { PREPARATION => Timer::Preparation, DEPARTURE => Timer::Departure, _ => Timer::Restart }));
            } else if token & CHILD != 0 { out.push(Event::Child); }
            else {
                let bits = event.events as i32;
                if bits & (libc::EPOLLIN | libc::EPOLLRDHUP | libc::EPOLLHUP | libc::EPOLLERR) != 0 { out.push(Event::Readable(token as RawFd)); }
                if bits & libc::EPOLLOUT != 0 { out.push(Event::Writable(token as RawFd)); }
            }
        }
        if out.iter().any(|event| matches!(event, Event::Child)) { self.adopted()?; }
        Ok(())
    }
}
