#![allow(clippy::missing_safety_doc)]

mod batch;
mod engine;
mod scope;
mod shared;
mod walk;
mod wake;
#[cfg(not(target_os = "macos"))]
mod snapshot;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod os;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod os;
#[cfg(windows)]
#[path = "windows.rs"]
mod os;

use engine::Engine;
use scope::Scope;
use std::cell::RefCell;
use std::ffi::{CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};

thread_local! {
    static ERROR: RefCell<CString> = RefCell::new(CString::default());
}

fn record(message: &str) -> i32 {
    ERROR.with(|slot| *slot.borrow_mut() = CString::new(message.replace('\0', "?")).unwrap_or_default());
    -1
}

fn answer(action: impl FnOnce() -> Result<i32, String>) -> i32 {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(Ok(value)) => value,
        Ok(Err(message)) => record(&message),
        Err(_) => record("a panic was contained at the watch engine boundary"),
    }
}

unsafe fn text(bytes: *const u8, length: usize) -> Result<String, String> {
    if length == 0 {
        return Ok(String::new());
    }
    let bytes = unsafe { std::slice::from_raw_parts(bytes, length) };
    String::from_utf8(bytes.to_vec()).map_err(|_| "a path handed to the watch engine is not UTF-8".to_owned())
}

unsafe fn scope(root: *const u8, root_length: usize, recursive: i32, exclusions: *const u8, exclusions_length: usize) -> Result<Scope, String> {
    let root = unsafe { text(root, root_length) }?;
    let exclusions = unsafe { text(exclusions, exclusions_length) }?;
    let exclusions = exclusions.split('\0').filter(|one| !one.is_empty()).map(str::to_owned).collect();
    Ok(Scope::new(root, recursive != 0, exclusions))
}

unsafe fn engine<'a>(engine: *mut Engine) -> Result<&'a Engine, String> {
    unsafe { engine.as_ref() }.ok_or_else(|| "no watch engine was handed over".to_owned())
}

#[unsafe(no_mangle)]
pub extern "C" fn watch_error() -> *const c_char {
    ERROR.with(|slot| slot.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn watch_open() -> *mut Engine {
    match catch_unwind(Engine::open) {
        Ok(Ok(engine)) => Box::into_raw(Box::new(engine)),
        Ok(Err(error)) => {
            record(&format!("the watch engine could not open its wake channel: {error}"));
            std::ptr::null_mut()
        }
        Err(_) => {
            record("a panic was contained at the watch engine boundary");
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_wake(handle: *mut Engine) -> i32 {
    answer(|| Ok(unsafe { engine(handle) }?.wake_handle()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_subscribe(
    handle: *mut Engine,
    id: u32,
    root: *const u8,
    root_length: usize,
    recursive: i32,
    exclusions: *const u8,
    exclusions_length: usize,
) -> i32 {
    answer(|| {
        let scope = unsafe { scope(root, root_length, recursive, exclusions, exclusions_length) }?;
        unsafe { engine(handle) }?.subscribe(id, scope).map_err(|error| error.to_string())?;
        Ok(0)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_unsubscribe(handle: *mut Engine, id: u32) -> i32 {
    answer(|| {
        unsafe { engine(handle) }?.unsubscribe(id).map_err(|error| error.to_string())?;
        Ok(0)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_snapshot(
    handle: *mut Engine,
    id: u32,
    root: *const u8,
    root_length: usize,
    exclusions: *const u8,
    exclusions_length: usize,
    file: *const u8,
    file_length: usize,
) -> i32 {
    answer(|| {
        let scope = unsafe { scope(root, root_length, 1, exclusions, exclusions_length) }?;
        let file = unsafe { text(file, file_length) }?;
        unsafe { engine(handle) }?.snapshot(id, scope, file).map_err(|error| error.to_string())?;
        Ok(0)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_since(
    handle: *mut Engine,
    id: u32,
    root: *const u8,
    root_length: usize,
    exclusions: *const u8,
    exclusions_length: usize,
    file: *const u8,
    file_length: usize,
) -> i32 {
    answer(|| {
        let scope = unsafe { scope(root, root_length, 1, exclusions, exclusions_length) }?;
        let file = unsafe { text(file, file_length) }?;
        unsafe { engine(handle) }?.since(id, scope, file).map_err(|error| error.to_string())?;
        Ok(0)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn watch_take(handle: *mut Engine, out: *mut u8, capacity: usize) -> i32 {
    answer(|| {
        let out = unsafe { std::slice::from_raw_parts_mut(out, capacity) };
        Ok(unsafe { engine(handle) }?.take(out) as i32)
    })
}
