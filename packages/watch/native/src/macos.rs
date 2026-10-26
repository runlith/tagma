use crate::batch::{self, Batch, Change, Presence};
use crate::engine::Watch;
use crate::scope::Scope;
use crate::shared::Sink;
use crate::walk::walk;
use std::ffi::{CStr, c_char, c_void};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::sync::{Arc, Condvar, Mutex};

type CFRef = *const c_void;
type Callback = extern "C" fn(*const c_void, *mut c_void, usize, *mut c_void, *const u32, *const u64);

#[repr(C)]
struct Context {
    version: isize,
    info: *mut c_void,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
}

#[repr(C)]
struct ArrayCallBacks {
    fields: [usize; 6],
}

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn FSEventStreamCreate(alloc: CFRef, callback: Callback, context: *const Context, paths: CFRef, since: u64, latency: f64, flags: u32) -> *mut c_void;
    fn FSEventStreamSetDispatchQueue(stream: *mut c_void, queue: *mut c_void);
    fn FSEventStreamSetExclusionPaths(stream: *mut c_void, paths: CFRef) -> u8;
    fn FSEventStreamStart(stream: *mut c_void) -> u8;
    fn FSEventStreamStop(stream: *mut c_void);
    fn FSEventStreamInvalidate(stream: *mut c_void);
    fn FSEventStreamRelease(stream: *mut c_void);
    fn FSEventsGetCurrentEventId() -> u64;
    fn FSEventsCopyUUIDForDevice(device: i32) -> CFRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFTypeArrayCallBacks: ArrayCallBacks;
    fn CFStringCreateWithBytes(alloc: CFRef, bytes: *const u8, length: isize, encoding: u32, external: u8) -> CFRef;
    fn CFArrayCreate(alloc: CFRef, values: *const CFRef, count: isize, callbacks: *const ArrayCallBacks) -> CFRef;
    fn CFRelease(value: CFRef);
    fn CFUUIDCreateString(alloc: CFRef, uuid: CFRef) -> CFRef;
    fn CFStringGetCString(string: CFRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
}

unsafe extern "C" {
    fn dispatch_queue_create(label: *const c_char, attributes: *const c_void) -> *mut c_void;
    fn dispatch_queue_attr_make_with_qos_class(attributes: *const c_void, class: u32, priority: i32) -> *const c_void;
    fn dispatch_release(object: *mut c_void);
    fn dispatch_sync_f(queue: *mut c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
}

const UTF8: u32 = 0x0800_0100;
const SINCE_NOW: u64 = u64::MAX;
const FILE_EVENTS: u32 = 0x10;
const WATCH_ROOT: u32 = 0x04;
const NO_DEFER: u32 = 0x02;
const LATENCY: f64 = 0.01;
const OS_EXCLUSIONS: usize = 8;
const QOS_USER_INTERACTIVE: u32 = 0x21;

const MUST_SCAN_SUB_DIRS: u32 = 0x1;
const USER_DROPPED: u32 = 0x2;
const KERNEL_DROPPED: u32 = 0x4;
const IDS_WRAPPED: u32 = 0x8;
const HISTORY_DONE: u32 = 0x10;
const ROOT_CHANGED: u32 = 0x20;
const MOUNT: u32 = 0x40;
const UNMOUNT: u32 = 0x80;
const ITEM_CREATED: u32 = 0x100;
const ITEM_REMOVED: u32 = 0x200;
const ITEM_INODE_META_MOD: u32 = 0x400;
const ITEM_RENAMED: u32 = 0x800;
const ITEM_MODIFIED: u32 = 0x1000;
const ITEM_FINDER_INFO_MOD: u32 = 0x2000;
const ITEM_CHANGE_OWNER: u32 = 0x4000;
const ITEM_XATTR_MOD: u32 = 0x8000;
const ITEM_IS_DIR: u32 = 0x20000;
const ITEM_UPDATED: u32 = ITEM_MODIFIED | ITEM_INODE_META_MOD | ITEM_FINDER_INFO_MOD | ITEM_CHANGE_OWNER | ITEM_XATTR_MOD;

const SNAPSHOT: &str = "fsevents";

fn kind_of(flags: u32) -> u8 {
    let mut kind = 0;
    if flags & ITEM_CREATED != 0 {
        kind |= batch::CREATED;
    }
    if flags & ITEM_REMOVED != 0 {
        kind |= batch::DELETED;
    }
    if flags & ITEM_UPDATED != 0 {
        kind |= batch::UPDATED;
    }
    if flags & ITEM_RENAMED != 0 {
        kind |= batch::RENAMED;
    }
    kind
}

fn dropped_reason(flags: u32) -> &'static str {
    if flags & USER_DROPPED != 0 {
        "FSEvents dropped events its client did not take in time"
    } else if flags & KERNEL_DROPPED != 0 {
        "the kernel dropped file system events"
    } else {
        "FSEvents coalesced too many events under this directory"
    }
}

fn moved_in(scope: &Scope, path: &str, flags: u32, kind: u8, into: &mut Vec<(String, u8)>) {
    if kind & batch::RENAMED == 0 || flags & ITEM_IS_DIR == 0 || !scope.recursive || presence(path) != Presence::Directory {
        return;
    }
    walk(scope, path, &mut |entry| into.push((entry.path.to_owned(), batch::CREATED)));
}

enum Handler {
    Live(Sink),
    History(Arc<Scope>, Arc<(Mutex<History>, Condvar)>),
}

#[derive(Default)]
struct History {
    batch: Batch,
    unknown: Option<&'static str>,
    done: bool,
}

impl Handler {
    fn heard(&self, events: &[(String, u32)]) {
        match self {
            Handler::Live(sink) => {
                let scope = sink.scope();
                let mut changes = Vec::with_capacity(events.len());
                for (path, flags) in events {
                    if flags & MUST_SCAN_SUB_DIRS != 0 {
                        sink.dropped(path, dropped_reason(*flags));
                    }
                    if flags & (MOUNT | UNMOUNT) != 0 {
                        sink.dropped(path, "a volume was mounted or unmounted under this directory");
                        continue;
                    }
                    if flags & ROOT_CHANGED != 0 {
                        changes.push((scope.root.clone(), batch::UPDATED));
                        continue;
                    }
                    let kind = kind_of(*flags);
                    if kind == 0 {
                        continue;
                    }
                    changes.push((path.clone(), kind));
                    moved_in(scope, path, *flags, kind, &mut changes);
                }
                sink.events(changes);
            }
            Handler::History(scope, history) => {
                let (state, done) = &**history;
                let mut state = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let mut moved = Vec::new();
                for (path, flags) in events {
                    if flags & HISTORY_DONE != 0 {
                        state.done = true;
                        done.notify_all();
                        break;
                    }
                    if flags & (MUST_SCAN_SUB_DIRS | USER_DROPPED | KERNEL_DROPPED) != 0 {
                        state.unknown.get_or_insert(dropped_reason(*flags));
                    }
                    if flags & (IDS_WRAPPED | ROOT_CHANGED | MOUNT | UNMOUNT) != 0 {
                        state.unknown.get_or_insert("the watched volume or directory changed under the journal");
                        continue;
                    }
                    let kind = kind_of(*flags);
                    if kind == 0 {
                        continue;
                    }
                    moved.push((path.clone(), kind));
                    moved_in(scope, path, *flags, kind, &mut moved);
                }
                for (path, kind) in moved {
                    if let Some(relative) = scope.kept(&path) {
                        state.batch.add(relative, kind);
                    }
                }
            }
        }
    }
}

extern "C" fn heard(_stream: *const c_void, info: *mut c_void, count: usize, paths: *mut c_void, flags: *const u32, _ids: *const u64) {
    let handler = unsafe { &*(info as *const Handler) };
    let paths = unsafe { std::slice::from_raw_parts(paths as *const *const c_char, count) };
    let flags = unsafe { std::slice::from_raw_parts(flags, count) };
    let events: Vec<(String, u32)> = paths
        .iter()
        .zip(flags)
        .map(|(path, flags)| {
            let mut path = unsafe { CStr::from_ptr(*path) }.to_string_lossy().into_owned();
            while path.len() > 1 && path.ends_with('/') {
                path.pop();
            }
            (path, *flags)
        })
        .collect();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler.heard(&events)));
}

extern "C" fn nothing(_: *mut c_void) {}

fn text(value: &str) -> CFRef {
    unsafe { CFStringCreateWithBytes(std::ptr::null(), value.as_ptr(), value.len() as isize, UTF8, 0) }
}

fn array(values: &[CFRef]) -> CFRef {
    unsafe { CFArrayCreate(std::ptr::null(), values.as_ptr(), values.len() as isize, &kCFTypeArrayCallBacks) }
}

struct Stream {
    stream: *mut c_void,
    queue: *mut c_void,
    handler: *mut Handler,
}

unsafe impl Send for Stream {}

impl Stream {
    fn open(scope: &Scope, since: u64, handler: Handler) -> Result<Stream, String> {
        match fs::symlink_metadata(&scope.root) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => return Err(format!("{} is not a directory", scope.root)),
            Err(error) => return Err(format!("{} cannot be watched: {error}", scope.root)),
        }
        let handler = Box::into_raw(Box::new(handler));
        let context = Context {
            version: 0,
            info: handler.cast(),
            retain: std::ptr::null(),
            release: std::ptr::null(),
            copy_description: std::ptr::null(),
        };
        let root = text(&scope.root);
        let paths = array(&[root]);
        let stream = unsafe { FSEventStreamCreate(std::ptr::null(), heard, &context, paths, since, LATENCY, FILE_EVENTS | WATCH_ROOT | NO_DEFER) };
        unsafe {
            CFRelease(paths);
            CFRelease(root);
        }
        if stream.is_null() {
            drop(unsafe { Box::from_raw(handler) });
            return Err(format!("FSEvents made no stream for {}", scope.root));
        }
        let excluded: Vec<CFRef> = scope.exclusions.iter().take(OS_EXCLUSIONS).map(|relative| text(&scope.absolute(relative))).collect();
        if !excluded.is_empty() {
            let list = array(&excluded);
            unsafe { FSEventStreamSetExclusionPaths(stream, list) };
            unsafe { CFRelease(list) };
        }
        for one in excluded {
            unsafe { CFRelease(one) };
        }
        let attributes = unsafe { dispatch_queue_attr_make_with_qos_class(std::ptr::null(), QOS_USER_INTERACTIVE, 0) };
        let queue = unsafe { dispatch_queue_create(c"watch".as_ptr(), attributes) };
        unsafe { FSEventStreamSetDispatchQueue(stream, queue) };
        let opened = Stream { stream, queue, handler };
        if unsafe { FSEventStreamStart(stream) } == 0 {
            opened.close();
            return Err(format!("FSEvents did not start a stream for {}", scope.root));
        }
        Ok(opened)
    }

    fn close(self) {
        unsafe {
            FSEventStreamStop(self.stream);
            FSEventStreamInvalidate(self.stream);
            dispatch_sync_f(self.queue, std::ptr::null_mut(), nothing);
            FSEventStreamRelease(self.stream);
            dispatch_release(self.queue);
            drop(Box::from_raw(self.handler));
        }
    }
}

struct Live(Stream);

impl Watch for Live {
    fn stop(self: Box<Self>) {
        self.0.close();
    }
}

#[derive(Default)]
pub struct Platform;

impl Platform {
    pub fn watch(&self, sink: Sink) -> Result<Box<dyn Watch>, String> {
        let held = sink.clone();
        Ok(Box::new(Live(Stream::open(held.scope(), SINCE_NOW, Handler::Live(sink))?)))
    }
}

fn stored_name(path: &str) -> Option<String> {
    let encoded = std::ffi::CString::new(path).ok()?;
    let mut asked: libc::attrlist = unsafe { std::mem::zeroed() };
    asked.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    asked.commonattr = libc::ATTR_CMN_NAME;
    let mut buffer = [0u32; 320];
    let read = unsafe {
        libc::getattrlist(
            encoded.as_ptr(),
            (&mut asked as *mut libc::attrlist).cast(),
            buffer.as_mut_ptr().cast(),
            std::mem::size_of_val(&buffer),
            libc::FSOPT_NOFOLLOW,
        )
    };
    if read < 0 {
        return None;
    }
    let bytes: &[u8] = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast(), std::mem::size_of_val(&buffer)) };
    let offset = i32::from_ne_bytes(bytes[4..8].try_into().ok()?) as usize;
    let length = u32::from_ne_bytes(bytes[8..12].try_into().ok()?) as usize;
    let name = bytes.get(4 + offset..4 + offset + length)?;
    Some(CStr::from_bytes_until_nul(name).ok()?.to_string_lossy().into_owned())
}

pub fn presence(path: &str) -> Presence {
    let Ok(metadata) = fs::symlink_metadata(path) else { return Presence::Missing };
    let asked = path.rsplit('/').next().unwrap_or_default();
    if stored_name(path).is_some_and(|stored| stored != asked) {
        return Presence::Missing;
    }
    if metadata.is_dir() { Presence::Directory } else { Presence::File }
}

fn journal(root: &str) -> Result<Option<String>, String> {
    let device = fs::metadata(root).map_err(|error| format!("{root} cannot be read: {error}"))?.dev();
    let uuid = unsafe { FSEventsCopyUUIDForDevice(device as i32) };
    if uuid.is_null() {
        return Ok(None);
    }
    let string = unsafe { CFUUIDCreateString(std::ptr::null(), uuid) };
    unsafe { CFRelease(uuid) };
    if string.is_null() {
        return Ok(None);
    }
    let mut buffer = [0 as c_char; 64];
    let read = unsafe { CFStringGetCString(string, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) };
    unsafe { CFRelease(string) };
    Ok((read != 0).then(|| unsafe { CStr::from_ptr(buffer.as_ptr()) }.to_string_lossy().into_owned()))
}

pub fn snapshot(scope: &Scope, file: &str) -> Result<(), String> {
    let at = unsafe { FSEventsGetCurrentEventId() };
    let journal = journal(&scope.root)?.unwrap_or_default();
    fs::write(file, format!("{SNAPSHOT}\n{at}\n{journal}\n")).map_err(|error| format!("the snapshot {file} could not be written: {error}"))
}

pub fn since(scope: &Scope, file: &str) -> Result<Option<Vec<Change>>, String> {
    let Ok(written) = fs::read_to_string(file) else { return Ok(None) };
    let mut lines = written.lines();
    let (Some(SNAPSHOT), Some(at), Some(held)) = (lines.next(), lines.next().and_then(|at| at.parse::<u64>().ok()), lines.next()) else {
        return Ok(None);
    };
    if held.is_empty() || journal(&scope.root)?.as_deref() != Some(held) {
        return Ok(None);
    }
    let shared = Arc::new(Scope::new(scope.root.clone(), true, scope.exclusions.clone()));
    let history = Arc::new((Mutex::new(History::default()), Condvar::new()));
    let stream = Stream::open(scope, at, Handler::History(shared, Arc::clone(&history)))?;
    let (state, done) = &*history;
    let mut held = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    while !held.done {
        held = done.wait(held).unwrap_or_else(|poisoned| poisoned.into_inner());
    }
    let finished = std::mem::take(&mut *held);
    drop(held);
    stream.close();
    if finished.unknown.is_some() {
        return Ok(None);
    }
    Ok(Some(finished.batch.resolve(|relative| presence(&scope.absolute(relative)))))
}
