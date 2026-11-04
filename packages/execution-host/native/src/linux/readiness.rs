use std::collections::HashMap;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::Mutex;

struct Interest { key: u64, token: u64, flags: u32 }
#[derive(Default)]
struct Interests { issued: u64, by_fd: HashMap<i32, Interest>, by_key: HashMap<u64, i32> }
pub struct Queue { fd: OwnedFd, wake: OwnedFd, interests: Mutex<Interests> }
pub struct Ready { pub token: u64, pub flags: u64 }

impl Queue {
    pub fn open() -> io::Result<Self> {
        let fd = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        let wake = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
        if wake < 0 { return Err(io::Error::last_os_error()); }
        let queue = Self { fd, wake: unsafe { OwnedFd::from_raw_fd(wake) }, interests: Mutex::new(Interests::default()) };
        queue.change(libc::EPOLL_CTL_ADD, wake, 0, libc::EPOLLIN as u32)?;
        Ok(queue)
    }

    fn change(&self, operation: i32, fd: i32, key: u64, flags: u32) -> io::Result<()> {
        let mut event = libc::epoll_event { events: flags, u64: key };
        if unsafe { libc::epoll_ctl(self.fd.as_raw_fd(), operation, fd, &mut event) } < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }

    pub fn arm(&self, fd: i32, token: u64, read: bool, write: bool) -> io::Result<()> {
        let mut interests = self.interests.lock().map_err(|_| io::Error::other("the readiness interests were poisoned"))?;
        let (key, previous) = match interests.by_fd.get(&fd).filter(|interest| interest.token == token) {
            Some(interest) => (interest.key, interest.flags),
            None => {
                interests.issued = interests.issued.checked_add(1).ok_or_else(|| io::Error::other("the readiness key space is exhausted"))?;
                (interests.issued, 0)
            }
        };
        let flags = previous | if read { libc::EPOLLIN as u32 } else { 0 } | if write { libc::EPOLLOUT as u32 } else { 0 };
        let event = flags | (libc::EPOLLONESHOT | libc::EPOLLRDHUP) as u32;
        match self.change(libc::EPOLL_CTL_MOD, fd, key, event) {
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => self.change(libc::EPOLL_CTL_ADD, fd, key, event)?,
            outcome => outcome?,
        }
        if let Some(previous) = interests.by_fd.insert(fd, Interest { key, token, flags }) { interests.by_key.remove(&previous.key); }
        interests.by_key.insert(key, fd);
        Ok(())
    }

    pub fn wait(&self) -> io::Result<Vec<Ready>> {
        let mut events = [libc::epoll_event { events: 0, u64: 0 }; 64];
        let count = unsafe { libc::epoll_wait(self.fd.as_raw_fd(), events.as_mut_ptr(), events.len() as i32, -1) };
        if count < 0 { return Err(io::Error::last_os_error()); }
        let mut ready = Vec::with_capacity(count as usize);
        let mut interests = self.interests.lock().map_err(|_| io::Error::other("the readiness interests were poisoned"))?;
        for event in &events[..count as usize] {
            let key = event.u64;
            let Some(&fd) = interests.by_key.get(&key) else { continue; };
            let Some(interest) = interests.by_fd.get_mut(&fd) else { continue; };
            let bits = event.events as i32;
            let mut flags = 0;
            if bits & libc::EPOLLIN != 0 { flags |= super::super::reactor::READ; }
            if bits & libc::EPOLLOUT != 0 { flags |= super::super::reactor::WRITE; }
            if bits & (libc::EPOLLRDHUP | libc::EPOLLHUP) != 0 { flags |= super::super::reactor::EOF; }
            if bits & libc::EPOLLERR != 0 { flags |= super::super::reactor::ERROR; }
            ready.push(Ready { token: interest.token, flags });
            interest.flags &= !event.events;
            if bits & (libc::EPOLLRDHUP | libc::EPOLLHUP | libc::EPOLLERR) != 0 { interest.flags = 0; }
            let left = interest.flags;
            if left != 0 {
                match self.change(libc::EPOLL_CTL_MOD, fd, key, left | (libc::EPOLLONESHOT | libc::EPOLLRDHUP) as u32) {
                    Ok(()) => continue,
                    Err(error) if matches!(error.raw_os_error(), Some(libc::EBADF) | Some(libc::ENOENT)) => {}
                    Err(error) => return Err(error),
                }
            }
            interests.by_fd.remove(&fd);
            interests.by_key.remove(&key);
        }
        Ok(ready)
    }

    pub fn wake(&self) -> io::Result<()> {
        let value = 1u64;
        if unsafe { libc::write(self.wake.as_raw_fd(), (&value as *const u64).cast(), size_of::<u64>()) } < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }
}
