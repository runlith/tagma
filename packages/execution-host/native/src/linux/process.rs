use super::{Identity, Selection};
use crate::{procfs, refusal::Refusal};
use std::fs;
use std::os::unix::ffi::OsStrExt;

pub fn identity(pid: i32) -> Result<Identity, i32> {
    procfs::stat(pid).map(|read| Identity { parent: read.parent, group: read.group, seconds: read.started, micros: 0, zombie: read.zombie })
}

pub fn descriptors(pid: i32) -> Result<usize, Refusal> {
    let count = fs::read_dir(format!("/proc/{pid}/fd")).map_err(|error| Refusal::Failed(error.to_string()))?
        .try_fold(0usize, |count, entry| entry.map(|_| count + 1).map_err(|error| Refusal::Failed(error.to_string())))?;
    Ok(count - usize::from(pid == std::process::id() as i32))
}

pub fn selected(selection: Selection<'_>, mut visit: impl FnMut(i32, &Identity)) -> Result<(), Refusal> {
    let terminal = match &selection {
        Selection::Terminal(path) => {
            let mut status: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::stat(path.as_ptr(), &mut status) } < 0 { return Err(std::io::Error::last_os_error().into()); }
            if status.st_mode & libc::S_IFMT != libc::S_IFCHR { return Err(Refusal::Invalid("the terminal must be a character device".into())); }
            Some(status.st_rdev)
        }
        _ => None,
    };
    let listed = match selection { Selection::Pids(pids) => pids.to_vec(), _ => procfs::pids().map_err(|code| Refusal::Failed(std::io::Error::from_raw_os_error(code).to_string()))? };
    for pid in listed {
        let read = match procfs::stat(pid) {
            Ok(read) => read,
            Err(libc::ESRCH) => continue,
            Err(code) => return Err(Refusal::Failed(format!("reading pid {pid}: {}", std::io::Error::from_raw_os_error(code)))),
        };
        if terminal.is_some_and(|terminal| read.terminal != terminal) { continue; }
        visit(pid, &Identity { parent: read.parent, group: read.group, seconds: read.started, micros: 0, zombie: read.zombie });
    }
    Ok(())
}

pub fn arguments(pid: i32, visit: impl FnOnce(&[&[u8]])) -> Result<(), i32> {
    let mut bytes = fs::read(format!("/proc/{pid}/cmdline")).map_err(procfs::error)?;
    if bytes.is_empty() { visit(&[]); return Ok(()); }
    if bytes.pop() != Some(0) { return Err(libc::EBADMSG); }
    let arguments = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    visit(&arguments);
    Ok(())
}

fn link(pid: i32, name: &str) -> Result<Vec<u8>, i32> {
    fs::read_link(format!("/proc/{pid}/{name}")).map(|path| path.as_os_str().as_bytes().to_vec()).map_err(procfs::error)
}

pub fn executable(pid: i32) -> Result<Vec<u8>, i32> { link(pid, "exe") }
pub fn folder(pid: i32) -> Result<Vec<u8>, i32> { link(pid, "cwd") }
