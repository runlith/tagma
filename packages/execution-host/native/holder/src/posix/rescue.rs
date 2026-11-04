use super::succession::{self, Inherited};
use super::backend::Backend;
use crate::handover;
use std::ffi::{CString, c_char, c_int};
use std::os::fd::RawFd;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

const FATAL: [c_int; 6] = [libc::SIGABRT, libc::SIGSEGV, libc::SIGBUS, libc::SIGILL, libc::SIGFPE, libc::SIGTRAP];
const SAID: &[u8] = b"execution-holder: the successor crashed before its logic started; the prior holder returns\n";

struct Plan {
    exchange: unsafe fn(*const c_char, *const c_char) -> i32,
    standing: CString,
    next: CString,
    prior: CString,
    descriptors: Vec<RawFd>,
    returned: Vec<CString>,
    fallen: Vec<CString>,
    returning: Vec<*const c_char>,
    falling: Vec<*const c_char>,
}

static PLAN: AtomicPtr<Plan> = AtomicPtr::new(std::ptr::null_mut());
static ARMED: AtomicBool = AtomicBool::new(false);

fn path(path: &Path) -> Option<CString> {
    CString::new(path.as_os_str().as_bytes()).ok()
}

fn pointers(argv: &[CString]) -> Vec<*const c_char> {
    argv.iter().map(|arg| arg.as_ptr()).chain(std::iter::once(std::ptr::null())).collect()
}

pub fn arm<B: Backend>(inherited: &Inherited) {
    let handles = succession::table(inherited.table)
        .ok()
        .and_then(|bytes| handover::decode(&bytes).ok())
        .map(|carried| carried.handles())
        .unwrap_or_default();
    let (standing_image, prior_image) = inherited.images();
    let [standing, next, prior] = inherited.bundles();
    let (Ok(returned), Ok(fallen), Some(standing), Some(next), Some(prior)) = (
        inherited.argv(&standing_image, succession::RETURNED),
        inherited.argv(&prior_image, succession::RETURNED),
        path(&standing),
        path(&next),
        path(&prior),
    ) else {
        return;
    };
    let descriptors = [inherited.claim, inherited.table].into_iter().chain(handles.into_iter().map(|value| value as RawFd)).collect();
    let (returning, falling) = (pointers(&returned), pointers(&fallen));
    let plan = Box::new(Plan { exchange: B::exchange, standing, next, prior, descriptors, returned, fallen, returning, falling });
    PLAN.store(Box::into_raw(plan), Ordering::SeqCst);
    ARMED.store(true, Ordering::SeqCst);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        previous(info);
        fire();
    }));
    for signal in FATAL {
        let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
        action.sa_sigaction = caught as extern "C" fn(c_int) as usize;
        unsafe {
            libc::sigemptyset(&mut action.sa_mask);
            libc::sigaction(signal, &action, std::ptr::null_mut());
        }
    }
}

pub fn disarm() {
    ARMED.store(false, Ordering::SeqCst);
}

fn fire() {
    if !ARMED.swap(false, Ordering::SeqCst) {
        return;
    }
    let plan = PLAN.load(Ordering::SeqCst);
    if plan.is_null() {
        return;
    }
    let plan = unsafe { &*plan };
    unsafe {
        libc::write(2, SAID.as_ptr().cast(), SAID.len());
        let argv = if (plan.exchange)(plan.prior.as_ptr(), plan.standing.as_ptr()) == 0 {
            libc::rename(plan.prior.as_ptr(), plan.next.as_ptr());
            (&plan.returned, &plan.returning)
        } else {
            (&plan.fallen, &plan.falling)
        };
        for fd in &plan.descriptors {
            libc::fcntl(*fd, libc::F_SETFD, 0);
        }
        libc::execv(argv.0[0].as_ptr(), argv.1.as_ptr());
    }
}

extern "C" fn caught(signal: c_int) {
    fire();
    unsafe {
        libc::signal(signal, libc::SIG_DFL);
        libc::raise(signal);
    }
}
