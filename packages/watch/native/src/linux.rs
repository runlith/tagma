use crate::batch::{self, Change, Presence};
use crate::engine::Watch;
use crate::scope::{Scope, joined};
use crate::shared::Sink;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::{CStr, CString};
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

const MASK: u32 = libc::IN_ATTRIB
    | libc::IN_CREATE
    | libc::IN_DELETE
    | libc::IN_DELETE_SELF
    | libc::IN_MODIFY
    | libc::IN_MOVE_SELF
    | libc::IN_MOVED_FROM
    | libc::IN_MOVED_TO
    | libc::IN_DONT_FOLLOW
    | libc::IN_ONLYDIR
    | libc::IN_EXCL_UNLINK;

const ABOVE: u32 = libc::IN_DELETE
    | libc::IN_DELETE_SELF
    | libc::IN_MOVE_SELF
    | libc::IN_MOVED_FROM
    | libc::IN_DONT_FOLLOW
    | libc::IN_ONLYDIR
    | libc::IN_MASK_ADD;

const GONE: &str = "the watched directory, or one above it, was deleted or moved";

const READ_BYTES: usize = 64 * 1024;

struct Entry {
    path: String,
    sink: Sink,
    guards: Option<String>,
}

#[derive(Default)]
struct Table {
    watched: HashMap<i32, Vec<Entry>>,
    paths: HashMap<u32, BTreeMap<String, i32>>,
}

impl Table {
    fn detach(&mut self, wd: i32, id: u32) -> bool {
        let Some(entries) = self.watched.get_mut(&wd) else { return false };
        entries.retain(|entry| entry.sink.id() != id);
        if !entries.is_empty() {
            return false;
        }
        self.watched.remove(&wd);
        true
    }
}

struct Inotify {
    fd: OwnedFd,
    table: Mutex<Table>,
}

fn locked(table: &Mutex<Table>) -> MutexGuard<'_, Table> {
    table.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn limit(path: &str) -> String {
    format!(
        "{path} cannot be watched: the inotify watch limit is reached (raise fs.inotify.max_user_watches, or keep more directories out of the watch)"
    )
}

impl Inotify {
    fn open() -> Result<Arc<Inotify>, String> {
        let fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC) };
        if fd < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EMFILE) {
                return Err("inotify could not be opened: the inotify instance limit is reached (raise fs.inotify.max_user_instances)".into());
            }
            return Err(format!("inotify could not be opened: {error}"));
        }
        let inotify = Arc::new(Inotify { fd: unsafe { OwnedFd::from_raw_fd(fd) }, table: Mutex::default() });
        let reader = Arc::clone(&inotify);
        thread::Builder::new()
            .name("watch-inotify".into())
            .spawn(move || reader.read())
            .map_err(|error| format!("the inotify reader could not start: {error}"))?;
        Ok(inotify)
    }

    fn add(&self, table: &mut Table, sink: &Sink, path: &str, guards: Option<&str>) -> Result<(), i32> {
        let encoded = CString::new(path).map_err(|_| libc::EINVAL)?;
        let mask = if guards.is_some() { ABOVE } else { MASK };
        let wd = unsafe { libc::inotify_add_watch(self.fd.as_raw_fd(), encoded.as_ptr(), mask) };
        if wd < 0 {
            return Err(io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
        }
        let displaced = table.paths.get(&sink.id()).and_then(|paths| paths.get(path)).copied().filter(|old| *old != wd);
        let entries = table.watched.entry(wd).or_default();
        let paths = table.paths.entry(sink.id()).or_default();
        match entries.iter_mut().find(|entry| entry.sink.id() == sink.id()) {
            Some(entry) => {
                if paths.get(&entry.path) == Some(&wd) {
                    paths.remove(&entry.path);
                }
                entry.path = path.to_owned();
                entry.guards = guards.map(str::to_owned);
            }
            None => entries.push(Entry { path: path.to_owned(), sink: sink.clone(), guards: guards.map(str::to_owned) }),
        }
        paths.insert(path.to_owned(), wd);
        if let Some(old) = displaced
            && table.detach(old, sink.id())
        {
            unsafe { libc::inotify_rm_watch(self.fd.as_raw_fd(), old) };
        }
        Ok(())
    }

    fn guard(&self, sink: &Sink, covered: &mut HashSet<String>) -> Result<(), String> {
        let root = Path::new(&sink.scope().root);
        let mut unreadable: Option<String> = None;
        for below in root.ancestors().take_while(|path| path.parent().is_some()) {
            let (Some(directory), Some(name)) = (below.parent(), below.file_name()) else { continue };
            let directory = directory.to_string_lossy();
            match self.add(&mut locked(&self.table), sink, &directory, Some(&name.to_string_lossy())) {
                Ok(()) => {
                    covered.insert(directory.into_owned());
                    unreadable = None;
                }
                Err(libc::ENOSPC) => return Err(limit(&directory)),
                Err(libc::EACCES) => {
                    if let Some(neighbour) = unreadable {
                        return Err(format!(
                            "{neighbour} and {directory} cannot be watched: neither can be read, so moving {neighbour} within {directory} cannot be observed (grant read access to one of every two adjacent directories above the watched root)"
                        ));
                    }
                    unreadable = Some(directory.into_owned());
                }
                Err(errno) => return Err(format!("{directory} cannot be watched: {}", io::Error::from_raw_os_error(errno))),
            }
        }
        Ok(())
    }

    fn refresh(&self, sink: &Sink) -> Result<(), String> {
        let mut covered = HashSet::new();
        self.cover_into(sink, &sink.scope().root.clone(), false, &mut covered)?;
        self.guard(sink, &mut covered)?;
        let mut table = locked(&self.table);
        let stale: Vec<(String, i32)> = match table.paths.get(&sink.id()) {
            Some(paths) => paths.iter().filter(|(path, _)| !covered.contains(*path)).map(|(path, wd)| (path.clone(), *wd)).collect(),
            None => Vec::new(),
        };
        for (path, wd) in stale {
            if let Some(paths) = table.paths.get_mut(&sink.id()) {
                paths.remove(&path);
            }
            if table.detach(wd, sink.id()) {
                unsafe { libc::inotify_rm_watch(self.fd.as_raw_fd(), wd) };
            }
        }
        Ok(())
    }

    fn cover(&self, sink: &Sink, from: &str, announce: bool) -> Result<(), String> {
        self.cover_into(sink, from, announce, &mut HashSet::new())
    }

    fn cover_into(&self, sink: &Sink, from: &str, announce: bool, covered: &mut HashSet<String>) -> Result<(), String> {
        let scope = sink.scope();
        let mut created = Vec::new();
        let mut pending = vec![from.to_owned()];
        while let Some(directory) = pending.pop() {
            let added = self.add(&mut locked(&self.table), sink, &directory, None);
            match added {
                Ok(()) => {
                    covered.insert(directory.clone());
                }
                Err(libc::ENOSPC) => return Err(limit(&directory)),
                Err(errno) if directory == scope.root => {
                    return Err(format!("{directory} cannot be watched: {}", io::Error::from_raw_os_error(errno)));
                }
                Err(_) => continue,
            }
            let Ok(entries) = fs::read_dir(&directory) else { continue };
            for entry in entries.flatten() {
                let path = joined(&directory, &entry.file_name().to_string_lossy());
                let Some(relative) = scope.kept(&path) else { continue };
                if relative.is_empty() {
                    continue;
                }
                let directory = entry.file_type().is_ok_and(|kind| kind.is_dir());
                if announce {
                    created.push((path.clone(), batch::CREATED));
                }
                if directory && scope.recursive {
                    pending.push(path);
                }
            }
        }
        if !created.is_empty() {
            sink.events(created);
        }
        Ok(())
    }

    fn forget(&self, table: &mut Table, id: u32, under: Option<&str>) -> Vec<String> {
        let Some(paths) = table.paths.get_mut(&id) else { return Vec::new() };
        let forgotten: Vec<(String, i32)> = match under {
            None => std::mem::take(paths).into_iter().collect(),
            Some(under) => {
                let mut taken: Vec<String> = paths.range(format!("{under}/")..format!("{under}0")).map(|(path, _)| path.clone()).collect();
                if paths.contains_key(under) {
                    taken.push(under.to_owned());
                }
                taken.into_iter().filter_map(|path| paths.remove(&path).map(|wd| (path, wd))).collect()
            }
        };
        if under.is_none() {
            table.paths.remove(&id);
        }
        let mut named = Vec::with_capacity(forgotten.len());
        for (path, wd) in forgotten {
            if table.detach(wd, id) {
                unsafe { libc::inotify_rm_watch(self.fd.as_raw_fd(), wd) };
            }
            named.push(path);
        }
        named
    }

    fn read(&self) {
        let mut buffer = vec![0u8; READ_BYTES];
        loop {
            let read = unsafe { libc::read(self.fd.as_raw_fd(), buffer.as_mut_ptr().cast(), buffer.len()) };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                self.fail(&format!("inotify could not be read: {error}"));
                return;
            }
            self.heard(&buffer[..read as usize]);
        }
    }

    fn fail(&self, reason: &str) {
        let table = locked(&self.table);
        for entries in table.watched.values() {
            for entry in entries {
                entry.sink.ended(reason);
            }
        }
    }

    fn heard(&self, bytes: &[u8]) {
        let mut batches: HashMap<u32, (Sink, Vec<(String, u8)>)> = HashMap::new();
        let header = std::mem::size_of::<libc::inotify_event>();
        let mut at = 0;
        while at + header <= bytes.len() {
            let event: libc::inotify_event = unsafe { std::ptr::read_unaligned(bytes[at..].as_ptr().cast()) };
            let name_bytes = &bytes[at + header..at + header + event.len as usize];
            at += header + event.len as usize;
            let name = CStr::from_bytes_until_nul(name_bytes).map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            if event.mask & libc::IN_Q_OVERFLOW != 0 {
                let mut sinks: HashMap<u32, Sink> = HashMap::new();
                for entry in locked(&self.table).watched.values().flatten() {
                    sinks.entry(entry.sink.id()).or_insert_with(|| entry.sink.clone());
                }
                for sink in sinks.into_values() {
                    match self.refresh(&sink) {
                        Ok(()) => sink.dropped(&sink.scope().root, "the inotify event queue overflowed"),
                        Err(reason) => sink.ended(&reason),
                    }
                }
                continue;
            }
            if event.mask & libc::IN_IGNORED != 0 {
                let mut table = locked(&self.table);
                for entry in table.watched.remove(&event.wd).unwrap_or_default() {
                    if let Some(paths) = table.paths.get_mut(&entry.sink.id())
                        && paths.get(&entry.path) == Some(&event.wd)
                    {
                        paths.remove(&entry.path);
                    }
                    if entry.guards.is_some() || entry.path == entry.sink.scope().root {
                        entry.sink.ended(GONE);
                    }
                }
                continue;
            }
            let targets: Vec<(String, Sink, Option<String>)> = match locked(&self.table).watched.get(&event.wd) {
                Some(entries) => entries.iter().map(|entry| (entry.path.clone(), entry.sink.clone(), entry.guards.clone())).collect(),
                None => continue,
            };
            for (directory, sink, guards) in targets {
                if let Some(child) = guards {
                    let named = event.mask & (libc::IN_DELETE | libc::IN_MOVED_FROM) != 0 && name == child;
                    if named || event.mask & (libc::IN_DELETE_SELF | libc::IN_MOVE_SELF) != 0 {
                        sink.ended(GONE);
                    }
                    continue;
                }
                let path = if name.is_empty() { directory.clone() } else { joined(&directory, &name) };
                let (_, events) = batches.entry(sink.id()).or_insert_with(|| (sink.clone(), Vec::new()));
                let is_directory = event.mask & libc::IN_ISDIR != 0;
                if event.mask & (libc::IN_CREATE | libc::IN_MOVED_TO) != 0 {
                    events.push((path.clone(), if event.mask & libc::IN_CREATE != 0 { batch::CREATED } else { batch::RENAMED }));
                    if is_directory && sink.scope().recursive && sink.scope().kept(&path).is_some() {
                        if let Err(reason) = self.cover(&sink, &path, true) {
                            sink.ended(&reason);
                        }
                    }
                } else if event.mask & (libc::IN_DELETE | libc::IN_MOVED_FROM) != 0 {
                    events.push((path.clone(), batch::DELETED));
                    if is_directory {
                        let forgotten = self.forget(&mut locked(&self.table), sink.id(), Some(&path));
                        events.extend(forgotten.into_iter().filter(|one| *one != path).map(|one| (one, batch::DELETED)));
                    }
                } else if event.mask & libc::IN_UNMOUNT != 0 {
                    sink.dropped(&directory, "a file system was unmounted under this directory");
                    if let Err(reason) = self.cover(&sink, &directory, false) {
                        sink.ended(&reason);
                    }
                } else if event.mask & (libc::IN_MODIFY | libc::IN_ATTRIB) != 0 {
                    events.push((path, batch::UPDATED));
                } else if event.mask & (libc::IN_DELETE_SELF | libc::IN_MOVE_SELF) != 0 && directory == sink.scope().root {
                    sink.ended(GONE);
                }
            }
        }
        for (_, (sink, events)) in batches {
            sink.events(events);
        }
    }
}

struct Covered {
    inotify: Arc<Inotify>,
    id: u32,
}

impl Watch for Covered {
    fn stop(self: Box<Self>) {
        let inotify = &self.inotify;
        inotify.forget(&mut locked(&inotify.table), self.id, None);
    }
}

#[derive(Default)]
pub struct Platform {
    inotify: Mutex<Option<Arc<Inotify>>>,
}

impl Platform {
    fn inotify(&self) -> Result<Arc<Inotify>, String> {
        let mut held = self.inotify.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(inotify) = held.as_ref() {
            return Ok(Arc::clone(inotify));
        }
        let opened = Inotify::open()?;
        *held = Some(Arc::clone(&opened));
        Ok(opened)
    }

    pub fn watch(&self, sink: Sink) -> Result<Box<dyn Watch>, String> {
        let inotify = self.inotify()?;
        match fs::symlink_metadata(&sink.scope().root) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => return Err(format!("{} is not a directory", sink.scope().root)),
            Err(error) => return Err(format!("{} cannot be watched: {error}", sink.scope().root)),
        }
        let root = sink.scope().root.clone();
        if let Err(reason) = inotify.guard(&sink, &mut HashSet::new()).and_then(|()| inotify.cover(&sink, &root, false)) {
            inotify.forget(&mut locked(&inotify.table), sink.id(), None);
            return Err(reason);
        }
        Ok(Box::new(Covered { inotify, id: sink.id() }))
    }
}

pub fn presence(path: &str) -> Presence {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => Presence::Directory,
        Ok(_) => Presence::File,
        Err(_) => Presence::Missing,
    }
}

pub fn snapshot(scope: &Scope, file: &str) -> Result<(), String> {
    crate::snapshot::write(scope, file)
}

pub fn since(scope: &Scope, file: &str) -> Result<Option<Vec<Change>>, String> {
    crate::snapshot::since(scope, file)
}
