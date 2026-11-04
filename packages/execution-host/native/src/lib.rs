#![allow(clippy::missing_safety_doc)]
mod usage;
#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod testing;
#[cfg(any(target_os = "linux", test))]
#[path = "linux/procfs.rs"]
mod procfs;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod channel;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod clock;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod identity;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod limits;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod process;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod reactor;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod refusal;

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod abi {
use crate::{channel, clock, identity, limits, process};
use crate::reactor::Reactor;
use crate::refusal::Refusal;
use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;

const FAILED: i32 = -1;
const WOULD_BLOCK: i32 = -2;
const CLOSED: i32 = -3;
const INVALID: i32 = -5;
const GONE: i32 = -7;

pub const READ_LIMIT: i32 = 16384;
pub const WRITE_LIMIT: i32 = 16384;

thread_local! {
    static ERROR: RefCell<CString> = RefCell::new(CString::default());
    static HOME: RefCell<CString> = RefCell::new(CString::default());
}

fn record(message: &str) {
    ERROR.with(|slot| *slot.borrow_mut() = CString::new(message.replace('\0', "?")).unwrap_or_default());
}

fn code(refusal: &Refusal) -> i32 {
    match refusal {
        Refusal::Failed(message) => {
            record(message);
            FAILED
        }
        Refusal::WouldBlock => WOULD_BLOCK,
        Refusal::Closed => CLOSED,
        Refusal::Invalid(message) => {
            record(message);
            INVALID
        }
        Refusal::Gone => GONE,
    }
}

fn pointer<T>(fallback: *mut T, action: impl FnOnce() -> Result<*mut T, Refusal>) -> *mut T {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(Ok(value)) => value,
        Ok(Err(refusal)) => {
            code(&refusal);
            fallback
        }
        Err(_) => {
            record("panic contained at the execution_platform ABI");
            fallback
        }
    }
}

fn answer(action: impl FnOnce() -> Result<i32, Refusal>) -> i32 {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(Ok(value)) => value,
        Ok(Err(refusal)) => code(&refusal),
        Err(_) => {
            record("panic contained at the execution_platform ABI");
            FAILED
        }
    }
}

fn status(action: impl FnOnce() -> Result<(), Refusal>) -> i32 {
    answer(|| action().map(|()| 0))
}

fn count(action: impl FnOnce() -> Result<usize, Refusal>) -> i32 {
    answer(|| action().map(|n| n as i32))
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_identity() -> *const c_char {
    identity::identity()
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_error() -> *const c_char {
    ERROR.with(|slot| slot.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_uptime_nanos() -> u64 {
    clock::uptime_nanos()
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_clock_ticks() -> u64 {
    clock::ticks().unwrap_or_else(|errno| { record(&format!("clock ticks: {}", std::io::Error::from_raw_os_error(errno))); 0 })
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_boot_nanos() -> u64 {
    clock::boot_nanos().unwrap_or_else(|errno| { record(&format!("boot instant: {}", std::io::Error::from_raw_os_error(errno))); 0 })
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_thread_interactive() -> i32 {
    status(|| Err(Refusal::Failed("Linux grants an unprivileged thread no interactive scheduling class".into())))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_limits(values: *mut u64) -> i32 {
    status(|| {
        if values.is_null() {
            return Err(Refusal::Invalid("null limits buffer".into()));
        }
        let fields = limits::platform()?;
        unsafe { ptr::copy_nonoverlapping(fields.as_ptr(), values, fields.len()) };
        Ok(())
    })
}

unsafe fn hand(encoded: Vec<u8>, out: *mut *mut u8, length: *mut u64) {
    let boxed = encoded.into_boxed_slice();
    unsafe {
        *length = boxed.len() as u64;
        *out = Box::into_raw(boxed).cast::<u8>();
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_process_table(kind: i32, pids: *const i32, pid_count: i32, terminal: *const c_char, out: *mut *mut u8, length: *mut u64) -> i32 {
    answer(|| {
        if out.is_null() || length.is_null() {
            return Err(Refusal::Invalid("null answer slot".into()));
        }
        let selection = match kind {
            0 => process::Selection::Table,
            1 => {
                if pid_count < 0 || (pid_count > 0 && pids.is_null()) {
                    return Err(Refusal::Invalid("the pids must be a list".into()));
                }
                let listed = if pid_count == 0 { &[][..] } else { unsafe { std::slice::from_raw_parts(pids, pid_count as usize) } };
                if listed.iter().any(|&pid| pid <= 0) {
                    return Err(Refusal::Invalid("a pid must be positive".into()));
                }
                process::Selection::Pids(listed)
            }
            2 if !terminal.is_null() => process::Selection::Terminal(unsafe { CStr::from_ptr(terminal) }),
            _ => return Err(Refusal::Invalid("the process selection is not known".into())),
        };
        let (encoded, count) = process::table(selection)?;
        unsafe { hand(encoded, out, length) };
        Ok(count as i32)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_process_facts(pids: *const i32, pid_count: i32, out: *mut *mut u8, length: *mut u64) -> i32 {
    answer(|| {
        if out.is_null() || length.is_null() {
            return Err(Refusal::Invalid("null answer slot".into()));
        }
        if pid_count < 0 || (pid_count > 0 && pids.is_null()) {
            return Err(Refusal::Invalid("the pids must be a list".into()));
        }
        let pids = if pid_count == 0 { &[][..] } else { unsafe { std::slice::from_raw_parts(pids, pid_count as usize) } };
        if pids.iter().any(|&pid| pid <= 0) {
            return Err(Refusal::Invalid("a pid must be positive".into()));
        }
        unsafe { hand(process::facts(pids), out, length) };
        Ok(pid_count)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_processes_release(answer: *mut u8, length: u64) -> i32 {
    status(|| {
        if answer.is_null() {
            return Err(Refusal::Invalid("null answer".into()));
        }
        unsafe { drop(Box::from_raw(ptr::slice_from_raw_parts_mut(answer, length as usize))) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_process_descriptors(pid: i32) -> i32 {
    count(|| {
        if pid <= 0 {
            return Err(Refusal::Invalid("the pid must be positive".into()));
        }
        process::descriptors(pid)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_process_identity(pid: i32, values: *mut u64) -> i32 {
    answer(|| {
        if values.is_null() {
            return Err(Refusal::Invalid("null identity buffer".into()));
        }
        if pid <= 0 {
            return Err(Refusal::Invalid("the pid must be positive".into()));
        }
        Ok(match process::identity(pid) {
            Ok(read) => {
                let fields = [read.parent as u64, read.group as u64, read.seconds, read.micros, u64::from(read.zombie)];
                unsafe { ptr::copy_nonoverlapping(fields.as_ptr(), values, fields.len()) };
                0
            }
            Err(code) => code,
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_user_home() -> *const c_char {
    pointer(ptr::null_mut(), || {
        let home = channel::home()?;
        Ok(HOME.with(|slot| {
            *slot.borrow_mut() = home;
            slot.borrow().as_ptr().cast_mut()
        }))
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_read(fd: i32, bytes: *mut u8, size: i32) -> i32 {
    count(|| {
        if bytes.is_null() || !(1..=READ_LIMIT).contains(&size) {
            return Err(Refusal::Invalid("read buffer must hold 1..=16384 bytes".into()));
        }
        channel::read(fd, unsafe { std::slice::from_raw_parts_mut(bytes, size as usize) })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_write(fd: i32, bytes: *const u8, size: i32) -> i32 {
    count(|| {
        if bytes.is_null() || !(1..=WRITE_LIMIT).contains(&size) {
            return Err(Refusal::Invalid("write buffer must hold 1..=16384 bytes".into()));
        }
        channel::write(fd, unsafe { std::slice::from_raw_parts(bytes, size as usize) })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_fd_close(fd: i32) -> i32 {
    status(|| channel::close(fd))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_pair(ends: *mut i32) -> i32 {
    status(|| {
        if ends.is_null() {
            return Err(Refusal::Invalid("null descriptor pair slot".into()));
        }
        let pair = channel::pair()?;
        unsafe { ptr::copy_nonoverlapping(pair.as_ptr(), ends, 2) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_receive(fd: i32, bytes: *mut u8, size: i32, fds: *mut i32, capacity: i32, received: *mut i32) -> i32 {
    count(|| {
        if bytes.is_null() || size < 1 || fds.is_null() || capacity < 1 || received.is_null() {
            return Err(Refusal::Invalid("receive needs a byte buffer, a descriptor buffer and a count slot".into()));
        }
        let buffer = unsafe { std::slice::from_raw_parts_mut(bytes, size as usize) };
        let slots = unsafe { std::slice::from_raw_parts_mut(fds, capacity as usize) };
        let (read, carried, exhausted) = channel::receive(fd, buffer, slots)?;
        unsafe {
            *received = carried as i32;
            *received.add(1) = i32::from(exhausted);
        }
        Ok(read)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_group_state(group: i32, leader: i32, leader_exited: i32) -> i32 {
    answer(|| {
        if group <= 0 || leader <= 0 {
            return Err(Refusal::Invalid("a group and its leader are positive ids".into()));
        }
        Ok(match channel::group(group, leader, leader_exited != 0)? {
            channel::Group::Ended => 0,
            channel::Group::Standing => 1,
            channel::Group::Unmeasured => 2,
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_fd_resize(fd: i32, rows: i32, cols: i32) -> i32 {
    status(|| channel::resize(fd, rows, cols))
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_fd_interrupt(fd: i32) -> i32 {
    count(|| channel::interrupt(fd))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_terminal(fd: i32, pid: i32, values: *mut u64) -> i32 {
    status(|| {
        if values.is_null() {
            return Err(Refusal::Invalid("null info buffer".into()));
        }
        let fields = channel::terminal(fd, pid)?;
        unsafe { ptr::copy_nonoverlapping(fields.as_ptr(), values, fields.len()) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_fd_foreground(fd: i32, values: *mut u64) -> i32 {
    status(|| {
        if values.is_null() {
            return Err(Refusal::Invalid("null foreground buffer".into()));
        }
        let fields = channel::foreground(fd)?;
        unsafe { ptr::copy_nonoverlapping(fields.as_ptr(), values, fields.len()) };
        Ok(())
    })
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn pthread_set_qos_class_self_np(class: u32, relative: i32) -> i32;
}

#[cfg(target_os = "macos")]
const QOS_CLASS_USER_INTERACTIVE: u32 = 0x21;

#[unsafe(no_mangle)]
#[cfg(target_os = "macos")]
pub extern "C" fn execution_platform_thread_interactive() -> i32 {
    status(|| match unsafe { pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0) } {
        0 => Ok(()),
        errno => Err(Refusal::Failed(format!("pthread_set_qos_class_self_np: {}", std::io::Error::from_raw_os_error(errno)))),
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execution_platform_reactor_open(callback: Option<unsafe extern "C" fn()>) -> *mut Reactor {
    pointer(ptr::null_mut(), || {
        let callback = callback.ok_or_else(|| Refusal::Invalid("null readiness callback".into()))?;
        Ok(Box::into_raw(Box::new(Reactor::open(callback)?)))
    })
}

unsafe fn reactor<'a>(handle: *mut Reactor) -> Result<&'a mut Reactor, Refusal> {
    unsafe { handle.as_mut() }.ok_or_else(|| Refusal::Invalid("null reactor handle".into()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_reactor_arm(handle: *mut Reactor, fd: i32, token: u64, read: i32, write: i32) -> i32 {
    status(|| unsafe { reactor(handle)? }.arm(fd, token, read != 0, write != 0).map_err(|error| match error.raw_os_error() {
        Some(libc::EBADF) => Refusal::Closed,
        _ => Refusal::Failed(error.to_string()),
    }))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_reactor_take(handle: *mut Reactor, out: *mut u64, capacity: i32) -> i32 {
    count(|| {
        if out.is_null() || capacity < 2 {
            return Err(Refusal::Invalid("the readiness buffer must hold at least one pair".into()));
        }
        let slots = unsafe { std::slice::from_raw_parts_mut(out, capacity as usize) };
        Ok(unsafe { reactor(handle)? }.take(slots)?)
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_reactor_close(handle: *mut Reactor) -> i32 {
    answer(|| {
        let owner = unsafe { reactor(handle)? };
        if !owner.finished() {
            owner.stop()?;
        }
        Ok(if owner.finish().map_err(Refusal::Failed)? { 0 } else { 1 })
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_platform_reactor_dispose(handle: *mut Reactor) -> i32 {
    status(|| {
        if !unsafe { reactor(handle)? }.finished() {
            return Err(Refusal::Invalid("dispose requires a closed reactor".into()));
        }
        unsafe { drop(Box::from_raw(handle)) };
        Ok(())
    })
}
}
