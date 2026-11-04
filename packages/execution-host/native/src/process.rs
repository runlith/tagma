use crate::refusal::Refusal;
use std::ffi::CStr;

#[cfg(target_os = "macos")]
#[path = "macos/process.rs"]
mod native;
#[cfg(target_os = "linux")]
#[path = "linux/process.rs"]
mod native;

pub use native::{descriptors, identity};
#[cfg(target_os = "macos")]
pub use native::each;

pub struct Identity {
    pub parent: u32,
    pub group: u32,
    pub seconds: u64,
    pub micros: u64,
    pub zombie: bool,
}

impl Identity {
    fn witness(&self) -> (u64, u64) { (self.seconds, self.micros) }
}

pub enum Selection<'a> {
    Table,
    Pids(&'a [i32]),
    Terminal(&'a CStr),
}

fn half(out: &mut Vec<u8>, value: u32) { out.extend_from_slice(&value.to_le_bytes()); }
fn word(out: &mut Vec<u8>, value: u64) { out.extend_from_slice(&value.to_le_bytes()); }
fn bytes(out: &mut Vec<u8>, value: &[u8]) { word(out, value.len() as u64); out.extend_from_slice(value); }

pub fn table(selection: Selection<'_>) -> Result<(Vec<u8>, u32), Refusal> {
    let mut out = vec![0; 4];
    let mut count = 0u32;
    native::selected(selection, |pid, read| {
        half(&mut out, pid as u32);
        half(&mut out, read.parent);
        half(&mut out, read.group);
        half(&mut out, read.seconds as u32);
        half(&mut out, (read.seconds >> 32) as u32);
        half(&mut out, read.micros as u32);
        half(&mut out, u32::from(read.zombie));
        count += 1;
    })?;
    out[..4].copy_from_slice(&count.to_le_bytes());
    Ok((out, count))
}

fn fields(out: &mut Vec<u8>, pid: i32) {
    if let Err(code) = native::arguments(pid, |arguments| {
        word(out, 0);
        word(out, arguments.len() as u64);
        for argument in arguments { bytes(out, argument); }
    }) { word(out, code as u64); }
    for field in [native::executable(pid), native::folder(pid)] {
        match field {
            Ok(value) => { word(out, 0); bytes(out, &value); }
            Err(code) => word(out, code as u64),
        }
    }
}

pub fn facts(pids: &[i32]) -> Vec<u8> {
    let mut out = Vec::new();
    word(&mut out, pids.len() as u64);
    for &pid in pids {
        word(&mut out, pid as u64);
        let before = match identity(pid) {
            Ok(read) => read,
            Err(code) => { word(&mut out, code as u64); continue; }
        };
        let mut read = Vec::new();
        fields(&mut read, pid);
        let after = match identity(pid) {
            Ok(after) if after.witness() == before.witness() => after,
            Ok(_) => { word(&mut out, libc::ESRCH as u64); continue; }
            Err(code) => { word(&mut out, code as u64); continue; }
        };
        for field in [0, after.parent as u64, after.group as u64, after.seconds, after.micros, u64::from(after.zombie)] { word(&mut out, field); }
        out.extend_from_slice(&read);
    }
    out
}
