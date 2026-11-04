use crate::{channel, control::Interruption, refusal::Refusal};
use std::io;

pub const CONTROL_DESCRIPTORS: i32 = 0;

pub fn interrupt(fd: i32, character: u8, no_flush: bool, external: bool, outcome: &mut Interruption) -> Result<(), Refusal> {
    if !external {
        match channel::write(fd, &[character]) {
            Ok(1) => { outcome.flushed = !no_flush; return Ok(()); }
            Ok(_) | Err(Refusal::WouldBlock) => {},
            Err(failure) => return Err(failure),
        }
    }
    let mut pending: libc::c_int = 0;
    if unsafe { libc::ioctl(fd, libc::TIOCOUTQ, &mut pending) } < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
    if pending < 0 { return Err(Refusal::Failed("the terminal reported a negative output queue".into())); }
    if unsafe { libc::ioctl(fd, libc::TIOCSIG as libc::c_ulong, libc::SIGINT) } < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
    outcome.pending = pending as usize;
    outcome.synthetic = true;
    outcome.flushed = !no_flush;
    Ok(())
}
