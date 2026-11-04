use crate::{channel, control::Interruption, refusal::Refusal};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub const CONTROL_DESCRIPTORS: i32 = 1;

pub fn interrupt(fd: i32, _: u8, no_flush: bool, _: bool, outcome: &mut Interruption) -> Result<(), Refusal> {
    let foreground = unsafe { libc::tcgetpgrp(fd) };
    if foreground < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
    if foreground == 0 { return Err(Refusal::Gone); }
    if no_flush {
        let mut ready = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
        loop {
            if unsafe { libc::poll(&mut ready, 1, 0) } >= 0 { break; }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted { return Err(channel::refusal(error)); }
        }
        let mut pending: libc::c_int = 0;
        if unsafe { libc::ioctl(fd, libc::FIONREAD, &mut pending) } < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
        if pending < 0 { return Err(Refusal::Failed("the terminal reported a negative output queue".into())); }
        outcome.pending = pending as usize;
    } else {
        let peer = unsafe { libc::ioctl(fd, libc::TIOCGPTPEER as libc::c_ulong, libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC | libc::O_NONBLOCK) };
        if peer < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
        let peer = unsafe { OwnedFd::from_raw_fd(peer) };
        if unsafe { libc::tcflush(peer.as_raw_fd(), libc::TCIOFLUSH) } < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
        outcome.flushed = true;
    }
    if unsafe { libc::ioctl(fd, libc::TIOCSIG as libc::c_ulong, libc::SIGINT) } < 0 { return Err(channel::refusal(io::Error::last_os_error())); }
    outcome.synthetic = true;
    Ok(())
}
