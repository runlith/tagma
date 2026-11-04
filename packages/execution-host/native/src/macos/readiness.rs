use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub struct Queue { fd: OwnedFd }
pub struct Ready { pub token: u64, pub flags: u64 }

fn event(ident: usize, filter: i16, flags: u16, fflags: u32, token: u64) -> libc::kevent {
    libc::kevent { ident, filter, flags, fflags, data: 0, udata: token as usize as *mut libc::c_void }
}

impl Queue {
    fn change(&self, changes: &[libc::kevent]) -> io::Result<()> {
        if unsafe { libc::kevent(self.fd.as_raw_fd(), changes.as_ptr(), changes.len() as i32, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }

    pub fn open() -> io::Result<Self> {
        let fd = unsafe { libc::kqueue() };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        let queue = Self { fd: unsafe { OwnedFd::from_raw_fd(fd) } };
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 { return Err(io::Error::last_os_error()); }
        queue.change(&[event(0, libc::EVFILT_USER, libc::EV_ADD | libc::EV_CLEAR, 0, 0)])?;
        Ok(queue)
    }

    pub fn arm(&self, fd: i32, token: u64, read: bool, write: bool) -> io::Result<()> {
        let mut changes = Vec::with_capacity(2);
        if read { changes.push(event(fd as usize, libc::EVFILT_READ, libc::EV_ADD | libc::EV_ONESHOT, 0, token)); }
        if write { changes.push(event(fd as usize, libc::EVFILT_WRITE, libc::EV_ADD | libc::EV_ONESHOT, 0, token)); }
        self.change(&changes)
    }

    pub fn wait(&self) -> io::Result<Vec<Ready>> {
        let mut events = [event(0, 0, 0, 0, 0); 64];
        let count = unsafe { libc::kevent(self.fd.as_raw_fd(), std::ptr::null(), 0, events.as_mut_ptr(), events.len() as i32, std::ptr::null()) };
        if count < 0 { return Err(io::Error::last_os_error()); }
        Ok(events[..count as usize].iter().filter(|event| event.filter != libc::EVFILT_USER).map(|event| {
            let mut flags = if event.filter == libc::EVFILT_READ { super::super::reactor::READ } else { super::super::reactor::WRITE };
            if event.flags & libc::EV_EOF != 0 { flags |= super::super::reactor::EOF; }
            if event.flags & libc::EV_ERROR != 0 { flags |= super::super::reactor::ERROR; }
            Ready { token: event.udata as usize as u64, flags }
        }).collect())
    }

    pub fn wake(&self) -> io::Result<()> { self.change(&[event(0, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER, 0)]) }
}
