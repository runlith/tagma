use std::io;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

#[cfg(target_os = "macos")]
#[path = "macos/readiness.rs"]
mod readiness;
#[cfg(target_os = "linux")]
#[path = "linux/readiness.rs"]
mod readiness;

pub const READ: u64 = 1;
pub const WRITE: u64 = 2;
pub const EOF: u64 = 4;
pub const ERROR: u64 = 8;

struct Shared {
    queue: readiness::Queue,
    callback: unsafe extern "C" fn(),
    ready: Mutex<Vec<(u64, u64)>>,
    pending: AtomicBool,
    stop: AtomicBool,
    error: AtomicI32,
}

impl Shared {
    fn notify(&self) {
        if !self.stop.load(Ordering::Acquire) && !self.pending.swap(true, Ordering::AcqRel) { unsafe { (self.callback)() }; }
    }

    fn fail(&self, errno: i32) {
        self.error.store(if errno == 0 { libc::EIO } else { errno }, Ordering::Release);
        self.notify();
    }
}

pub struct Reactor { shared: Arc<Shared>, worker: Option<JoinHandle<()>> }

impl Reactor {
    pub fn open(callback: unsafe extern "C" fn()) -> io::Result<Self> {
        let shared = Arc::new(Shared {
            queue: readiness::Queue::open()?, callback, ready: Mutex::new(Vec::new()), pending: AtomicBool::new(false), stop: AtomicBool::new(false), error: AtomicI32::new(0),
        });
        let worker = Arc::clone(&shared);
        let worker = thread::Builder::new().name("execution-reactor".into()).spawn(move || loop {
            let events = worker.queue.wait();
            if worker.stop.load(Ordering::Acquire) { break; }
            let events = match events {
                Ok(events) => events,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => { worker.fail(error.raw_os_error().unwrap_or(0)); break; }
            };
            let Ok(mut ready) = worker.ready.lock() else { worker.fail(libc::EIO); break; };
            let posted = !events.is_empty();
            ready.extend(events.into_iter().map(|event| (event.token, event.flags)));
            drop(ready);
            if posted { worker.notify(); }
        })?;
        Ok(Self { shared, worker: Some(worker) })
    }

    pub fn arm(&self, fd: i32, token: u64, read: bool, write: bool) -> io::Result<()> {
        if self.shared.stop.load(Ordering::Acquire) { return Err(io::Error::other("the reactor is retired")); }
        self.failure()?;
        self.shared.queue.arm(fd, token, read, write)
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
        for (index, (token, flags)) in ready.drain(..count).enumerate() { out[index * 2] = token; out[index * 2 + 1] = flags; }
        if count == 0 { self.failure()?; }
        Ok(count)
    }

    pub fn stop(&self) -> io::Result<()> {
        self.shared.stop.store(true, Ordering::Release);
        self.shared.queue.wake()
    }

    pub fn finish(&mut self) -> Result<bool, String> {
        if self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) || self.shared.pending.load(Ordering::Acquire) { return Ok(false); }
        if let Some(worker) = self.worker.take() { worker.join().map_err(|_| "the reactor worker panicked")?; }
        Ok(true)
    }

    pub fn finished(&self) -> bool { self.worker.is_none() }
}
