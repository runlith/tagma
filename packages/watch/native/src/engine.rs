use crate::batch::Change;
use crate::os;
use crate::scope::Scope;
use crate::shared::{Note, Shared};
use crate::wake::Wake;
use std::collections::HashMap;
use std::io;
use std::sync::{Arc, Mutex};
use std::thread;

pub trait Watch: Send {
    fn stop(self: Box<Self>);
}

struct Inner {
    shared: Arc<Shared>,
    watches: Mutex<HashMap<u32, Box<dyn Watch>>>,
    platform: os::Platform,
}

pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    pub fn open() -> io::Result<Engine> {
        let shared = Arc::new(Shared::new(Wake::new()?));
        Ok(Engine { inner: Arc::new(Inner { shared, watches: Mutex::default(), platform: os::Platform::default() }) })
    }

    pub fn wake_handle(&self) -> i32 {
        self.inner.shared.wake_handle()
    }

    fn work(&self, name: &str, job: impl FnOnce(&Inner) + Send + 'static) -> io::Result<()> {
        let inner = Arc::clone(&self.inner);
        thread::Builder::new().name(format!("watch-{name}")).spawn(move || job(&inner)).map(drop)
    }

    pub fn subscribe(&self, id: u32, scope: Scope) -> io::Result<()> {
        self.work("subscribe", move |inner| {
            let sink = inner.shared.open(id, Arc::new(scope));
            match inner.platform.watch(sink) {
                Ok(watch) => {
                    inner.watches.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(id, watch);
                    inner.shared.note(Note::Subscribed(id));
                }
                Err(reason) => {
                    inner.shared.forget(id);
                    inner.shared.note(Note::Refused(id, reason));
                }
            }
        })
    }

    pub fn unsubscribe(&self, id: u32) -> io::Result<()> {
        self.work("unsubscribe", move |inner| {
            let watch = inner.watches.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&id);
            if let Some(watch) = watch {
                watch.stop();
            }
            inner.shared.forget(id);
            inner.shared.note(Note::Unsubscribed(id));
        })
    }

    pub fn snapshot(&self, id: u32, scope: Scope, file: String) -> io::Result<()> {
        self.work("snapshot", move |inner| {
            inner.shared.note(match os::snapshot(&scope, &file) {
                Ok(()) => Note::Written(id),
                Err(reason) => Note::Refused(id, reason),
            });
        })
    }

    pub fn since(&self, id: u32, scope: Scope, file: String) -> io::Result<()> {
        self.work("since", move |inner| {
            let settled: Result<Option<Vec<Change>>, String> = os::since(&scope, &file);
            inner.shared.note(Note::Settled(id, settled));
        })
    }

    pub fn take(&self, out: &mut [u8]) -> usize {
        self.inner.shared.take(out, &os::presence)
    }
}
