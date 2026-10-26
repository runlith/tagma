use crate::batch::{self, Change, Presence};
use crate::engine::Watch;
use crate::scope::{Scope, joined};
use crate::shared::Sink;
use std::fs;
use std::sync::mpsc;
use std::os::windows::ffi::OsStrExt;
use std::thread::{self, JoinHandle};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, ERROR_IO_PENDING, ERROR_NOTIFY_ENUM_DIR, ERROR_OPERATION_ABORTED,
    GetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ACTION_ADDED, FILE_ACTION_MODIFIED, FILE_ACTION_REMOVED, FILE_ACTION_RENAMED_NEW_NAME, FILE_ACTION_RENAMED_OLD_NAME,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED, FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_ATTRIBUTES, FILE_NOTIFY_CHANGE_DIR_NAME,
    FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE, FILE_NOTIFY_INFORMATION, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, ReadDirectoryChangesW,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::Threading::{CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects};

const BUFFER_BYTES: usize = 1024 * 1024;
const NETWORK_BUFFER_BYTES: usize = 64 * 1024;
const NAME_AT: usize = std::mem::offset_of!(FILE_NOTIFY_INFORMATION, FileName);
const FILTER: u32 = FILE_NOTIFY_CHANGE_FILE_NAME
    | FILE_NOTIFY_CHANGE_DIR_NAME
    | FILE_NOTIFY_CHANGE_ATTRIBUTES
    | FILE_NOTIFY_CHANGE_SIZE
    | FILE_NOTIFY_CHANGE_LAST_WRITE;

struct Handle(HANDLE);

unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(path: &str) -> Vec<u16> {
    let long = if path.starts_with(r"\\") { path.to_owned() } else { format!(r"\\?\{path}") };
    std::ffi::OsStr::new(&long).encode_wide().chain(Some(0)).collect()
}

struct Reader {
    stop: std::sync::Arc<Handle>,
    thread: JoinHandle<()>,
}

impl Watch for Reader {
    fn stop(self: Box<Self>) {
        unsafe { SetEvent(self.stop.0) };
        let _ = self.thread.join();
    }
}

fn read(sink: Sink, directory: Handle, stop: std::sync::Arc<Handle>, armed: mpsc::Sender<Result<(), String>>) {
    let scope = sink.scope();
    let event = Handle(unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) });
    let mut buffer = vec![0u64; BUFFER_BYTES / 8];
    let mut bytes = BUFFER_BYTES;
    let mut armed = Some(armed);
    loop {
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        overlapped.hEvent = event.0;
        let asked = unsafe {
            ReadDirectoryChangesW(
                directory.0,
                buffer.as_mut_ptr().cast(),
                bytes as u32,
                i32::from(scope.recursive),
                FILTER,
                std::ptr::null_mut(),
                &mut overlapped,
                None,
            )
        };
        if asked == 0 {
            let code = unsafe { GetLastError() };
            if code == ERROR_INVALID_PARAMETER && bytes != NETWORK_BUFFER_BYTES {
                bytes = NETWORK_BUFFER_BYTES;
                continue;
            }
            if code != ERROR_IO_PENDING {
                let reason = format!("ReadDirectoryChangesW refused to read changes of {} with error {code}", scope.root);
                match armed.take() {
                    Some(waiting) => drop(waiting.send(Err(reason))),
                    None => sink.ended(&reason),
                }
                return;
            }
        }
        if let Some(waiting) = armed.take() {
            drop(waiting.send(Ok(())));
        }
        let waits = [event.0, stop.0];
        let woke = unsafe { WaitForMultipleObjects(2, waits.as_ptr(), 0, INFINITE) };
        if woke != WAIT_OBJECT_0 {
            unsafe { CancelIoEx(directory.0, &overlapped) };
            let mut ignored = 0u32;
            unsafe { GetOverlappedResult(directory.0, &overlapped, &mut ignored, 1) };
            return;
        }
        let mut read = 0u32;
        if unsafe { GetOverlappedResult(directory.0, &overlapped, &mut read, 0) } == 0 {
            match unsafe { GetLastError() } {
                ERROR_OPERATION_ABORTED => return,
                ERROR_INVALID_PARAMETER if bytes != NETWORK_BUFFER_BYTES => {
                    bytes = NETWORK_BUFFER_BYTES;
                    continue;
                }
                ERROR_NOTIFY_ENUM_DIR => {
                    sink.dropped(&scope.root, "the change buffer overflowed");
                    continue;
                }
                ERROR_ACCESS_DENIED if presence(&scope.root) != Presence::Directory => {
                    sink.events([(scope.root.clone(), batch::UPDATED)]);
                    return;
                }
                code => {
                    sink.ended(&format!("ReadDirectoryChangesW failed with error {code}"));
                    return;
                }
            }
        }
        if read == 0 {
            sink.dropped(&scope.root, "the change buffer overflowed");
            continue;
        }
        let mut events = Vec::new();
        let base = buffer.as_ptr() as *const u8;
        let mut offset = 0usize;
        loop {
            let word = |at: usize| unsafe { std::ptr::read_unaligned(base.add(offset + at) as *const u32) };
            let (next, action, length) = (word(0), word(4), word(8) as usize / 2);
            let name: Vec<u16> = (0..length)
                .map(|at| unsafe { std::ptr::read_unaligned(base.add(offset + NAME_AT + at * 2) as *const u16) })
                .collect();
            let path = joined(&scope.root, &String::from_utf16_lossy(&name));
            let kind = match action {
                FILE_ACTION_ADDED => batch::CREATED,
                FILE_ACTION_RENAMED_NEW_NAME => batch::RENAMED,
                FILE_ACTION_MODIFIED => batch::UPDATED,
                FILE_ACTION_REMOVED | FILE_ACTION_RENAMED_OLD_NAME => batch::DELETED,
                _ => 0,
            };
            if kind != 0 {
                events.push((path, kind));
            }
            if next == 0 {
                break;
            }
            offset += next as usize;
        }
        sink.events(events);
    }
}

#[derive(Default)]
pub struct Platform;

impl Platform {
    pub fn watch(&self, sink: Sink) -> Result<Box<dyn Watch>, String> {
        let root = sink.scope().root.clone();
        if presence(&root) != Presence::Directory {
            return Err(format!("{root} is not a directory"));
        }
        let path = wide(&root);
        let directory = unsafe {
            CreateFileW(
                path.as_ptr(),
                FILE_LIST_DIRECTORY,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
                std::ptr::null_mut(),
            )
        };
        if directory == INVALID_HANDLE_VALUE {
            return Err(format!("{root} could not be opened for watching: {}", std::io::Error::last_os_error()));
        }
        let directory = Handle(directory);
        let stop = std::sync::Arc::new(Handle(unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) }));
        let held = std::sync::Arc::clone(&stop);
        let (armed, arming) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("watch-directory".into())
            .spawn(move || read(sink, directory, held, armed))
            .map_err(|error| format!("the watch thread could not start: {error}"))?;
        match arming.recv() {
            Ok(Ok(())) => Ok(Box::new(Reader { stop, thread })),
            Ok(Err(reason)) => {
                let _ = thread.join();
                Err(reason)
            }
            Err(_) => {
                let _ = thread.join();
                Err(format!("the watch thread of {root} ended before it read any change"))
            }
        }
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
