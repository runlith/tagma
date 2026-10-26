use crate::batch::{Batch, Change, Presence};
use crate::scope::Scope;
use crate::wake::Wake;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CREATED: u8 = 1;
pub const UPDATED: u8 = 2;
pub const DELETED: u8 = 3;
pub const DROPPED: u8 = 4;
pub const ENDED: u8 = 5;
pub const SUBSCRIBED: u8 = 6;
pub const REFUSED: u8 = 7;
pub const UNSUBSCRIBED: u8 = 8;
pub const WRITTEN: u8 = 9;
pub const SETTLED: u8 = 10;

pub enum Note {
    Subscribed(u32),
    Refused(u32, String),
    Unsubscribed(u32),
    Written(u32),
    Settled(u32, Result<Option<Vec<Change>>, String>),
}

struct Watched {
    scope: Arc<Scope>,
    batch: Batch,
    heard: Option<(u64, u64)>,
    ended: Option<String>,
    alive: bool,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_millis() as u64)
}

#[derive(Default)]
struct Pending {
    watched: HashMap<u32, Watched>,
    notes: Vec<Note>,
}

#[derive(Default)]
struct Ready {
    bytes: Vec<u8>,
    ends: VecDeque<usize>,
    at: usize,
}

pub struct Shared {
    wake: Wake,
    signalled: AtomicBool,
    pending: Mutex<Pending>,
    ready: Mutex<Ready>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Shared {
    pub fn new(wake: Wake) -> Shared {
        Shared { wake, signalled: AtomicBool::new(false), pending: Mutex::default(), ready: Mutex::default() }
    }

    pub fn wake_handle(&self) -> i32 {
        self.wake.handle()
    }

    fn signal(&self) {
        if !self.signalled.swap(true, Ordering::AcqRel) {
            self.wake.signal();
        }
    }

    pub fn note(&self, note: Note) {
        locked(&self.pending).notes.push(note);
        self.signal();
    }

    pub fn open(self: &Arc<Self>, id: u32, scope: Arc<Scope>) -> Sink {
        locked(&self.pending).watched.insert(id, Watched { scope: Arc::clone(&scope), batch: Batch::default(), heard: None, ended: None, alive: true });
        Sink { shared: Arc::clone(self), id, scope }
    }

    pub fn forget(&self, id: u32) {
        locked(&self.pending).watched.remove(&id);
    }

    fn with(&self, id: u32, work: impl FnOnce(&mut Watched)) {
        let mut pending = locked(&self.pending);
        let Some(watched) = pending.watched.get_mut(&id).filter(|watched| watched.alive) else { return };
        work(watched);
        drop(pending);
        self.signal();
    }

    pub fn take(&self, out: &mut [u8], presence: &dyn Fn(&str) -> Presence) -> usize {
        let mut ready = locked(&self.ready);
        if ready.at >= ready.bytes.len() {
            ready.bytes.clear();
            ready.ends.clear();
            ready.at = 0;
            self.signalled.store(false, Ordering::Release);
            let (notes, batches) = {
                let mut pending = locked(&self.pending);
                let notes = std::mem::take(&mut pending.notes);
                let mut batches = Vec::new();
                for (id, watched) in pending.watched.iter_mut() {
                    if watched.batch.is_empty() && watched.ended.is_none() {
                        continue;
                    }
                    let heard = watched.heard.take();
                    batches.push((*id, Arc::clone(&watched.scope), std::mem::take(&mut watched.batch), heard, watched.ended.take()));
                }
                (notes, batches)
            };
            let mut encoder = Encoder { ready: &mut ready };
            for note in notes {
                encoder.note(note);
            }
            let mut gone = Vec::new();
            for (id, scope, batch, heard, ended) in batches {
                let dropped = batch.dropped.clone();
                let changes = batch.resolve(|relative| presence(&scope.absolute(relative)));
                for change in &changes {
                    encoder.change(id, change, heard);
                }
                for (subtree, reason) in dropped {
                    encoder.record(id, DROPPED, 0, subtree.as_bytes(), reason.as_bytes());
                }
                let reason = ended.or_else(|| {
                    (presence(&scope.root) != Presence::Directory).then(|| "the watched directory was deleted".to_owned())
                });
                if let Some(reason) = reason {
                    encoder.record(id, ENDED, 0, b"", reason.as_bytes());
                    gone.push(id);
                }
            }
            if !gone.is_empty() {
                let mut pending = locked(&self.pending);
                for id in gone {
                    if let Some(watched) = pending.watched.get_mut(&id) {
                        watched.alive = false;
                    }
                }
            }
        }
        let start = ready.at;
        let mut end = start;
        while let Some(&next) = ready.ends.front() {
            if next - start > out.len() {
                break;
            }
            end = next;
            ready.ends.pop_front();
        }
        out[..end - start].copy_from_slice(&ready.bytes[start..end]);
        ready.at = end;
        end - start
    }
}

struct Encoder<'a> {
    ready: &'a mut Ready,
}

impl Encoder<'_> {
    fn record(&mut self, id: u32, kind: u8, flag: u8, path: &[u8], text: &[u8]) {
        let bytes = &mut self.ready.bytes;
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.push(kind);
        bytes.push(flag);
        bytes.extend_from_slice(&(path.len() as u32).to_le_bytes());
        bytes.extend_from_slice(path);
        bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
        bytes.extend_from_slice(text);
        let end = bytes.len();
        self.ready.ends.push_back(end);
    }

    fn change(&mut self, id: u32, change: &Change, heard: Option<(u64, u64)>) {
        let mut stamp = [0u8; 16];
        let text: &[u8] = match heard {
            Some((first, last)) => {
                stamp[..8].copy_from_slice(&first.to_le_bytes());
                stamp[8..].copy_from_slice(&last.to_le_bytes());
                &stamp
            }
            None => b"",
        };
        match change {
            Change::Created { path, directory } => self.record(id, CREATED, u8::from(*directory), path.as_bytes(), text),
            Change::Updated { path } => self.record(id, UPDATED, 0, path.as_bytes(), text),
            Change::Deleted { path } => self.record(id, DELETED, 0, path.as_bytes(), text),
        }
    }

    fn note(&mut self, note: Note) {
        match note {
            Note::Subscribed(id) => self.record(id, SUBSCRIBED, 0, b"", b""),
            Note::Refused(id, reason) => self.record(id, REFUSED, 0, b"", reason.as_bytes()),
            Note::Unsubscribed(id) => self.record(id, UNSUBSCRIBED, 0, b"", b""),
            Note::Written(id) => self.record(id, WRITTEN, 0, b"", b""),
            Note::Settled(id, Ok(Some(changes))) => {
                for change in &changes {
                    self.change(id, change, None);
                }
                self.record(id, SETTLED, 1, b"", b"");
            }
            Note::Settled(id, Ok(None)) => self.record(id, SETTLED, 0, b"", b""),
            Note::Settled(id, Err(reason)) => self.record(id, REFUSED, 0, b"", reason.as_bytes()),
        }
    }
}

#[derive(Clone)]
pub struct Sink {
    shared: Arc<Shared>,
    id: u32,
    scope: Arc<Scope>,
}

impl Sink {
    pub fn scope(&self) -> &Scope {
        &self.scope
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn events(&self, events: impl IntoIterator<Item = (String, u8)>) {
        let scope = Arc::clone(&self.scope);
        let now = now_ms();
        self.shared.with(self.id, |watched| {
            let mut kept = false;
            for (path, kind) in events {
                if let Some(relative) = scope.kept(&path) {
                    watched.batch.add(relative, kind);
                    kept = true;
                }
            }
            if kept {
                watched.heard = Some(watched.heard.map_or((now, now), |(first, _)| (first, now)));
            }
        });
    }

    pub fn dropped(&self, path: &str, reason: &str) {
        let relative = self.scope.relative(path).filter(|relative| !self.scope.excludes(relative)).unwrap_or_default();
        self.shared.with(self.id, |watched| watched.batch.drop_subtree(relative, reason.to_owned()));
    }

    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn ended(&self, reason: &str) {
        self.shared.with(self.id, |watched| {
            watched.ended.get_or_insert_with(|| reason.to_owned());
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{DELETED, DROPPED, ENDED, Shared, UPDATED};
    use crate::batch::{self, Presence};
    use crate::scope::Scope;
    use crate::wake::Wake;
    use std::sync::Arc;

    fn records(bytes: &[u8]) -> Vec<(u32, u8, String, String)> {
        let mut out = Vec::new();
        let mut at = 0;
        let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        while at < bytes.len() {
            let id = word(at) as u32;
            let kind = bytes[at + 4];
            let path_len = word(at + 6);
            let path = String::from_utf8(bytes[at + 10..at + 10 + path_len].to_vec()).unwrap();
            let text_at = at + 10 + path_len;
            let text_len = word(text_at);
            let text = if (1..=3).contains(&kind) {
                assert_eq!(text_len, 16);
                String::new()
            } else {
                String::from_utf8(bytes[text_at + 4..text_at + 4 + text_len].to_vec()).unwrap()
            };
            out.push((id, kind, path, text));
            at = text_at + 4 + text_len;
        }
        out
    }

    #[test]
    fn a_backend_drop_reaches_the_reader_as_its_subtree_after_the_changes_before_it_and_a_vanished_root_ends_the_watch() {
        let shared = Arc::new(Shared::new(Wake::new().unwrap()));
        let sink = shared.open(7, Arc::new(Scope::new("/w".into(), true, vec!["skip".into()])));
        sink.events([("/w/a/file".to_owned(), batch::UPDATED), ("/w/skip/x".to_owned(), batch::CREATED)]);
        sink.dropped("/w/a/deep", "events were dropped");
        sink.dropped("/elsewhere", "events were dropped");
        let mut out = vec![0u8; 4096];
        let standing = |path: &str| if path == "/w" { Presence::Directory } else { Presence::File };
        let first = shared.take(&mut out, &standing);
        let heard = records(&out[..first]);
        sink.events([("/w/b".to_owned(), batch::CREATED)]);
        let second = shared.take(&mut out, &|_| Presence::Missing);
        let after = records(&out[..second]);
        sink.events([("/w/c".to_owned(), batch::CREATED)]);
        let ended = shared.take(&mut out, &|_| Presence::Missing);
        assert_eq!(
            (heard, after, ended),
            (
                vec![
                    (7, UPDATED, "a/file".to_owned(), String::new()),
                    (7, DROPPED, "a/deep".to_owned(), "events were dropped".to_owned()),
                    (7, DROPPED, String::new(), "events were dropped".to_owned()),
                ],
                vec![(7, DELETED, "b".to_owned(), String::new()), (7, ENDED, String::new(), "the watched directory was deleted".to_owned())],
                0,
            )
        );
    }
}
