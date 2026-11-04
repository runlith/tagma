use super::{Identity, Selection};
use crate::refusal::Refusal;
use std::cell::RefCell;
use std::io;
use std::sync::OnceLock;

const KINFO_SIZE: usize = 648;
const WORD: usize = size_of::<usize>();

fn errno() -> i32 { io::Error::last_os_error().raw_os_error().filter(|code| *code > 0).unwrap_or(libc::EIO) }
fn int(bytes: &[u8], at: usize) -> i32 { i32::from_ne_bytes(bytes[at..at + 4].try_into().unwrap()) }

fn row(bytes: &[u8]) -> (i32, Identity) {
    (int(bytes, 40), Identity {
        parent: int(bytes, 560) as u32,
        group: int(bytes, 564) as u32,
        seconds: i64::from_ne_bytes(bytes[..8].try_into().unwrap()) as u64,
        micros: int(bytes, 8) as u64,
        zombie: bytes[36] == 5,
    })
}

pub fn identity(pid: i32) -> Result<Identity, i32> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid];
    let mut buffer = [0u8; KINFO_SIZE];
    let mut size = KINFO_SIZE;
    if unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) } != 0 { return Err(errno()); }
    if size == 0 { return Err(libc::ESRCH); }
    if size != KINFO_SIZE { return Err(libc::EBADMSG); }
    let (read_pid, identity) = row(&buffer);
    if read_pid != pid { return Err(libc::EBADMSG); }
    Ok(identity)
}

pub fn descriptors(pid: i32) -> Result<usize, Refusal> {
    let size = size_of::<libc::proc_fdinfo>();
    let required = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
    if required <= 0 { return Err(Refusal::Failed(format!("sizing descriptors of {pid}: {}", io::Error::last_os_error()))); }
    let mut bytes = required as usize + size;
    loop {
        let limit = i32::try_from(bytes).map_err(|_| Refusal::Failed(format!("the descriptors of {pid} exceed the native buffer range")))?;
        let mut buffer = vec![0u8; bytes];
        let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, buffer.as_mut_ptr().cast(), limit) };
        if read <= 0 { return Err(Refusal::Failed(format!("reading descriptors of {pid}: {}", io::Error::last_os_error()))); }
        if !(read as usize).is_multiple_of(size) { return Err(Refusal::Failed(format!("the descriptors of {pid} did not contain whole entries"))); }
        if (read as usize) < bytes { return Ok(read as usize / size); }
        bytes = bytes.checked_mul(2).ok_or_else(|| Refusal::Failed(format!("the descriptors of {pid} exceed the native buffer range")))?;
    }
}

thread_local! { static TABLE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }

fn listed(buffer: &mut Vec<u8>, mut mib: [i32; 4]) -> Result<usize, Refusal> {
    for _ in 0..4 {
        if buffer.len() < KINFO_SIZE * 64 { buffer.resize(KINFO_SIZE * 64, 0); }
        let mut size = buffer.len();
        let read = unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
        if read == 0 {
            if !size.is_multiple_of(KINFO_SIZE) { return Err(Refusal::Failed(format!("the process table answered {size} bytes, not whole {KINFO_SIZE}-byte entries"))); }
            return Ok(size);
        }
        let code = errno();
        if code != libc::ENOMEM { return Err(Refusal::Failed(format!("reading the process table: {}", io::Error::from_raw_os_error(code)))); }
        let mut needed = 0usize;
        if unsafe { libc::sysctl(mib.as_mut_ptr(), 4, std::ptr::null_mut(), &mut needed, std::ptr::null_mut(), 0) } != 0 { return Err(Refusal::Failed(format!("sizing the process table: {}", io::Error::last_os_error()))); }
        buffer.resize(needed + needed / 4 + KINFO_SIZE * 16, 0);
    }
    Err(Refusal::Failed("the process table outgrew every buffer offered".into()))
}

pub fn each(visit: impl FnMut(i32, &Identity)) -> Result<(), Refusal> { selected(Selection::Table, visit) }

pub fn selected(selection: Selection<'_>, mut visit: impl FnMut(i32, &Identity)) -> Result<(), Refusal> {
    let mib = match selection {
        Selection::Pids(pids) => {
            for &pid in pids {
                match identity(pid) {
                    Ok(read) => visit(pid, &read),
                    Err(libc::ESRCH) => {},
                    Err(code) => return Err(Refusal::Failed(format!("reading pid {pid}: {}", io::Error::from_raw_os_error(code)))),
                }
            }
            return Ok(());
        }
        Selection::Table => [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_ALL, 0],
        Selection::Terminal(path) => {
            let mut info: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::stat(path.as_ptr(), &mut info) } != 0 { return Err(Refusal::Failed(format!("reading terminal {}: {}", path.to_string_lossy(), io::Error::last_os_error()))); }
            if info.st_mode & libc::S_IFMT != libc::S_IFCHR { return Err(Refusal::Invalid(format!("{} is not a terminal device", path.to_string_lossy()))); }
            [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_TTY, info.st_rdev]
        }
    };
    TABLE.with(|slot| {
        let mut buffer = slot.borrow_mut();
        let size = listed(&mut buffer, mib)?;
        for entry in buffer[..size].chunks_exact(KINFO_SIZE) {
            let (pid, read) = row(entry);
            if pid > 0 { visit(pid, &read); }
        }
        Ok(())
    })
}

fn argmax() -> usize {
    static ARGMAX: OnceLock<usize> = OnceLock::new();
    *ARGMAX.get_or_init(|| {
        let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
        let mut value = 0i32;
        let mut size = size_of::<i32>();
        let read = unsafe { libc::sysctl(mib.as_mut_ptr(), 2, (&mut value as *mut i32).cast(), &mut size, std::ptr::null_mut(), 0) };
        if read == 0 && value > 0 { value as usize } else { 1 << 20 }
    })
}

thread_local! { static ARGUMENTS: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }

pub fn arguments(pid: i32, visit: impl FnOnce(&[&[u8]])) -> Result<(), i32> {
    ARGUMENTS.with(|slot| {
        let mut buffer = slot.borrow_mut();
        if buffer.len() < argmax() { buffer.resize(argmax(), 0); }
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size = buffer.len();
        if unsafe { libc::sysctl(mib.as_mut_ptr(), 3, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) } != 0 { return Err(errno()); }
        let answer = &buffer[..size.min(buffer.len())];
        if answer.len() < 4 { return Err(libc::EBADMSG); }
        let count = int(answer, 0);
        if count < 0 { return Err(libc::EBADMSG); }
        let path = 4 + answer[4..].iter().position(|byte| *byte == 0).ok_or(libc::EBADMSG)?;
        let mut at = 4 + (path - 4 + 1).div_ceil(WORD) * WORD;
        if at > answer.len() || answer[path..at].iter().any(|byte| *byte != 0) { return Err(libc::EBADMSG); }
        let mut out = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let end = at + answer.get(at..).ok_or(libc::EBADMSG)?.iter().position(|byte| *byte == 0).ok_or(libc::EBADMSG)?;
            out.push(&answer[at..end]);
            at = end + 1;
        }
        visit(&out);
        Ok(())
    })
}

pub fn executable(pid: i32) -> Result<Vec<u8>, i32> {
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let read = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if read <= 0 { return Err(errno()); }
    path.truncate(read as usize);
    Ok(path)
}

pub fn folder(pid: i32) -> Result<Vec<u8>, i32> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = size_of::<libc::proc_vnodepathinfo>() as i32;
    if unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, (&mut info as *mut libc::proc_vnodepathinfo).cast(), size) } != size { return Err(errno()); }
    let path = info.pvi_cdir.vip_path.as_flattened();
    let end = path.iter().position(|byte| *byte == 0).unwrap_or(path.len());
    Ok(path[..end].iter().map(|byte| *byte as u8).collect())
}
