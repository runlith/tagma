use super::sys;
use crate::platform::{Event, Timer};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::ptr;

const RESTART: usize = 1;
const PREPARATION: usize = 2;
const DEPARTURE: usize = 3;

pub struct Queue {
    fd: OwnedFd,
}

fn change(ident: usize, filter: i16, flags: u16, data: isize) -> libc::kevent {
    libc::kevent { ident, filter, flags, fflags: 0, data, udata: ptr::null_mut() }
}

impl Queue {
    pub fn new() -> Result<Self, i32> {
        let fd = unsafe { libc::kqueue() };
        sys::check(fd)?;
        let queue = Self { fd: unsafe { OwnedFd::from_raw_fd(fd) } };
        sys::cloexec(fd)?;
        queue.apply(&[change(libc::SIGCHLD as usize, libc::EVFILT_SIGNAL, libc::EV_ADD, 0)])?;
        Ok(queue)
    }

    fn apply(&self, changes: &[libc::kevent]) -> Result<(), i32> {
        sys::check(unsafe {
            libc::kevent(self.fd.as_raw_fd(), changes.as_ptr(), changes.len() as i32, ptr::null_mut(), 0, ptr::null())
        })
    }

    pub fn read(&self, fd: RawFd) -> Result<(), i32> {
        self.apply(&[change(fd as usize, libc::EVFILT_READ, libc::EV_ADD, 0)])
    }

    pub fn write(&self, fd: RawFd, on: bool) -> Result<(), i32> {
        let state = if on { libc::EV_ENABLE } else { libc::EV_DISABLE };
        self.apply(&[change(fd as usize, libc::EVFILT_WRITE, libc::EV_ADD | state, 0)])
    }

    pub fn timer(&self, timer: Timer, ms: u64) -> Result<(), i32> {
        let ident = match timer {
            Timer::Restart => RESTART,
            Timer::Preparation => PREPARATION,
            Timer::Departure => DEPARTURE,
        };
        self.apply(&[change(ident, libc::EVFILT_TIMER, libc::EV_ADD | libc::EV_ONESHOT, ms as isize)])
    }

    pub fn wait(&self, out: &mut Vec<Event<RawFd>>) -> Result<(), i32> {
        let mut events = [change(0, 0, 0, 0); 32];
        let count = unsafe {
            libc::kevent(self.fd.as_raw_fd(), ptr::null(), 0, events.as_mut_ptr(), events.len() as i32, ptr::null())
        };
        if count < 0 {
            let errno = sys::errno();
            return if errno == libc::EINTR { Ok(()) } else { Err(errno) };
        }
        for event in &events[..count as usize] {
            out.push(match event.filter {
                libc::EVFILT_READ => Event::Readable(event.ident as RawFd),
                libc::EVFILT_WRITE => Event::Writable(event.ident as RawFd),
                libc::EVFILT_SIGNAL => Event::Child,
                _ if event.ident == PREPARATION => Event::Timer(Timer::Preparation),
                _ if event.ident == DEPARTURE => Event::Timer(Timer::Departure),
                _ => Event::Timer(Timer::Restart),
            });
        }
        Ok(())
    }
}
