use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

const WAKE: usize = 0;

pub const READ: u64 = 1;
pub const WRITE: u64 = 2;
pub const EOF: u64 = 4;
pub const ERROR: u64 = 8;

struct Shared {
    queue: OwnedFd,
    callback: unsafe extern "C" fn(),
    ready: Mutex<Vec<(u64, u64)>>,
    pending: AtomicBool,
    stop: AtomicBool,
    error: AtomicI32,
}

fn event(ident: usize, filter: i16, flags: u16, fflags: u32, token: u64) -> libc::kevent {
    libc::kevent { ident, filter, flags, fflags, data: 0, udata: token as usize as *mut libc::c_void }
}

impl Shared {
    fn change(&self, events: &[libc::kevent]) -> io::Result<()> {
        let result = unsafe {
            libc::kevent(self.queue.as_raw_fd(), events.as_ptr(), events.len() as i32, std::ptr::null_mut(), 0, std::ptr::null())
        };
        if result < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }

    fn notify(&self) {
        if !self.stop.load(Ordering::Acquire) && !self.pending.swap(true, Ordering::AcqRel) {
            unsafe { (self.callback)() };
        }
    }

    fn fail(&self, errno: i32) {
        self.error.store(if errno == 0 { libc::EIO } else { errno }, Ordering::Release);
        self.notify();
    }
}

pub struct Reactor {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
}

impl Reactor {
    pub fn open(callback: unsafe extern "C" fn()) -> io::Result<Self> {
        let queue = unsafe { libc::kqueue() };
        if queue < 0 {
            return Err(io::Error::last_os_error());
        }
        let shared = Arc::new(Shared {
            queue: unsafe { OwnedFd::from_raw_fd(queue) },
            callback,
            ready: Mutex::new(Vec::new()),
            pending: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            error: AtomicI32::new(0),
        });
        if unsafe { libc::fcntl(queue, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
        shared.change(&[event(WAKE, libc::EVFILT_USER, libc::EV_ADD | libc::EV_CLEAR, 0, 0)])?;
        let worker = Arc::clone(&shared);
        let worker = thread::Builder::new().name("execution-reactor".into()).spawn(move || {
            let mut events = [event(0, 0, 0, 0, 0); 64];
            loop {
                let count = unsafe {
                    libc::kevent(worker.queue.as_raw_fd(), std::ptr::null(), 0, events.as_mut_ptr(), events.len() as i32, std::ptr::null())
                };
                if worker.stop.load(Ordering::Acquire) {
                    break;
                }
                if count < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    worker.fail(error.raw_os_error().unwrap_or(0));
                    break;
                }
                let mut posted = false;
                let Ok(mut ready) = worker.ready.lock() else {
                    worker.fail(libc::EIO);
                    break;
                };
                for item in &events[..count as usize] {
                    if item.filter == libc::EVFILT_USER {
                        continue;
                    }
                    let mut flags = if item.filter == libc::EVFILT_READ { READ } else { WRITE };
                    if item.flags & libc::EV_EOF != 0 {
                        flags |= EOF;
                    }
                    if item.flags & libc::EV_ERROR != 0 {
                        flags |= ERROR;
                    }
                    ready.push((item.udata as usize as u64, flags));
                    posted = true;
                }
                drop(ready);
                if posted {
                    worker.notify();
                }
            }
        })?;
        Ok(Self { shared, worker: Some(worker) })
    }

    pub fn arm(&self, fd: i32, token: u64, read: bool, write: bool) -> io::Result<()> {
        if self.shared.stop.load(Ordering::Acquire) {
            return Err(io::Error::other("the reactor is retired"));
        }
        self.failure()?;
        let mut changes = Vec::with_capacity(2);
        if read {
            changes.push(event(fd as usize, libc::EVFILT_READ, libc::EV_ADD | libc::EV_ONESHOT, 0, token));
        }
        if write {
            changes.push(event(fd as usize, libc::EVFILT_WRITE, libc::EV_ADD | libc::EV_ONESHOT, 0, token));
        }
        self.shared.change(&changes)
    }

    fn failure(&self) -> io::Result<()> {
        match self.shared.error.load(Ordering::Acquire) {
            0 => Ok(()),
            errno => Err(io::Error::other(format!("the reactor worker stopped: {}", io::Error::from_raw_os_error(errno)))),
        }
    }

    pub fn take(&self, out: &mut [u64]) -> io::Result<usize> {
        self.shared.pending.store(false, Ordering::Release);
        let mut ready = self.shared.ready.lock().map_err(|_| io::Error::other("the reactor queue was poisoned"))?;
        let count = ready.len().min(out.len() / 2);
        for (index, (token, flags)) in ready.drain(..count).enumerate() {
            out[index * 2] = token;
            out[index * 2 + 1] = flags;
        }
        if count == 0 {
            self.failure()?;
        }
        Ok(count)
    }

    pub fn stop(&self) -> io::Result<()> {
        self.shared.stop.store(true, Ordering::Release);
        self.shared.change(&[event(WAKE, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER, 0)])
    }

    pub fn finish(&mut self) -> Result<bool, String> {
        if self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) || self.shared.pending.load(Ordering::Acquire) {
            return Ok(false);
        }
        if let Some(worker) = self.worker.take() {
            worker.join().map_err(|_| "the reactor worker panicked")?;
        }
        Ok(true)
    }

    pub fn finished(&self) -> bool {
        self.worker.is_none()
    }
}
