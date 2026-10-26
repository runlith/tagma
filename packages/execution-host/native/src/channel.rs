use crate::refusal::Refusal;
use std::io;
use std::ffi::{CStr, CString};

pub fn home() -> Result<CString, Refusal> {
    let user = unsafe { libc::getpwuid(libc::getuid()) };
    if user.is_null() || unsafe { (*user).pw_dir }.is_null() {
        return Err(Refusal::Failed("the user database names no home directory".into()));
    }
    let home = unsafe { CStr::from_ptr((*user).pw_dir) };
    if home.to_bytes().is_empty() {
        return Err(Refusal::Failed("the user database names an empty home directory".into()));
    }
    Ok(home.to_owned())
}

fn refusal(error: io::Error) -> Refusal {
    match error.raw_os_error() {
        Some(libc::EAGAIN) | Some(libc::EINTR) => Refusal::WouldBlock,
        Some(libc::EBADF) => Refusal::Closed,
        Some(libc::EPIPE) | Some(libc::EIO) => Refusal::Gone,
        _ => Refusal::Failed(error.to_string()),
    }
}

pub fn read(fd: i32, buffer: &mut [u8]) -> Result<usize, Refusal> {
    let read = unsafe { libc::read(fd, buffer.as_mut_ptr().cast(), buffer.len()) };
    if read >= 0 {
        return Ok(read as usize);
    }
    match refusal(io::Error::last_os_error()) {
        Refusal::Gone => Ok(0),
        other => Err(other),
    }
}

pub fn write(fd: i32, bytes: &[u8]) -> Result<usize, Refusal> {
    let written = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
    if written >= 0 { Ok(written as usize) } else { Err(refusal(io::Error::last_os_error())) }
}

pub fn pair() -> Result<[i32; 2], Refusal> {
    let mut ends = [0i32; 2];
    if unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, ends.as_mut_ptr()) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    for fd in ends {
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            let error = io::Error::last_os_error();
            for fd in ends {
                unsafe { libc::close(fd) };
            }
            return Err(refusal(error));
        }
    }
    Ok(ends)
}

pub fn close(fd: i32) -> Result<(), Refusal> {
    if unsafe { libc::close(fd) } < 0 { Err(refusal(io::Error::last_os_error())) } else { Ok(()) }
}

pub fn receive(fd: i32, buffer: &mut [u8], fds: &mut [i32]) -> Result<(usize, usize, bool), Refusal> {
    let room = size_of_val(fds) as u32;
    let mut control = vec![0u8; unsafe { libc::CMSG_SPACE(room) } as usize];
    let mut part = libc::iovec { iov_base: buffer.as_mut_ptr().cast(), iov_len: buffer.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut part;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as libc::socklen_t;
    let read = unsafe { libc::recvmsg(fd, &mut message, libc::MSG_DONTWAIT) };
    if read < 0 {
        let error = io::Error::last_os_error();
        if matches!(error.raw_os_error(), Some(libc::EMFILE) | Some(libc::ENFILE) | Some(libc::EMSGSIZE)) {
            let payload = unsafe { libc::recv(fd, buffer.as_mut_ptr().cast(), buffer.len(), libc::MSG_DONTWAIT) };
            return if payload < 0 { Err(refusal(io::Error::last_os_error())) } else { Ok((payload as usize, 0, true)) };
        }
        return Err(refusal(error));
    }
    let mut count = 0;
    let mut overflow = false;
    let mut header = unsafe { libc::CMSG_FIRSTHDR(&message) };
    while !header.is_null() {
        let item = unsafe { &*header };
        if item.cmsg_level == libc::SOL_SOCKET && item.cmsg_type == libc::SCM_RIGHTS {
            let carried = (item.cmsg_len as usize - unsafe { libc::CMSG_LEN(0) } as usize) / size_of::<i32>();
            let data = unsafe { libc::CMSG_DATA(header) }.cast::<i32>();
            for index in 0..carried {
                let received = unsafe { data.add(index).read_unaligned() };
                if count < fds.len() {
                    fds[count] = received;
                    count += 1;
                } else {
                    overflow = true;
                    unsafe { libc::close(received) };
                }
            }
        }
        header = unsafe { libc::CMSG_NXTHDR(&message, header) };
    }
    if overflow || message.msg_flags & libc::MSG_CTRUNC != 0 {
        for received in &fds[..count] {
            unsafe { libc::close(*received) };
        }
        return Ok((read as usize, 0, true));
    }
    for received in &fds[..count] {
        if unsafe { libc::fcntl(*received, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            let error = io::Error::last_os_error();
            for received in &fds[..count] {
                unsafe { libc::close(*received) };
            }
            return Err(Refusal::Failed(error.to_string()));
        }
    }
    Ok((read as usize, count, false))
}

pub enum Group {
    Ended,
    Standing,
    Unmeasured,
}

pub fn group(group: i32, leader: i32, leader_exited: bool) -> Result<Group, Refusal> {
    let mut members = vec![0i32; 64];
    loop {
        let room = size_of_val(members.as_slice()) as i32;
        let count = unsafe { libc::proc_listpgrppids(group, members.as_mut_ptr().cast(), room) };
        if count < 0 {
            return Err(refusal(io::Error::last_os_error()));
        }
        if count as usize == members.len() {
            if members.len() >= 65_536 {
                return Ok(Group::Unmeasured);
            }
            members.resize(members.len() * 4, 0);
            continue;
        }
        let listed = &members[..count as usize];
        for &member in listed {
            if member == 0 || (member == leader && leader_exited) {
                continue;
            }
            match crate::process::identity(member) {
                Ok(identity) if !identity.zombie => return Ok(Group::Standing),
                Ok(_) => {},
                Err(errno) if errno == libc::ESRCH => {},
                Err(_) => return Ok(Group::Unmeasured),
            }
        }
        return Ok(Group::Ended);
    }
}

pub fn resize(fd: i32, rows: i32, cols: i32) -> Result<(), Refusal> {
    if !(1..=65535).contains(&rows) || !(1..=65535).contains(&cols) {
        return Err(Refusal::Invalid("terminal geometry must be within 1..=65535".into()));
    }
    let size = libc::winsize { ws_row: rows as u16, ws_col: cols as u16, ws_xpixel: 0, ws_ypixel: 0 };
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    Ok(())
}

pub fn foreground(fd: i32) -> Result<[u64; 3], Refusal> {
    let pid = unsafe { libc::tcgetpgrp(fd) };
    if pid < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    if pid == 0 {
        return Err(Refusal::Failed("the terminal has no foreground process".into()));
    }
    let identity = crate::process::identity(pid).map_err(|errno| Refusal::Failed(io::Error::from_raw_os_error(errno).to_string()))?;
    if identity.zombie || identity.group != pid as u32 || unsafe { libc::tcgetpgrp(fd) } != pid {
        return Err(Refusal::Failed("the terminal's foreground changed while its process was read".into()));
    }
    Ok([pid as u64, identity.seconds, identity.micros])
}

pub fn interrupt(fd: i32) -> Result<usize, Refusal> {
    let mut pending: libc::c_int = 0;
    if unsafe { libc::ioctl(fd, libc::TIOCOUTQ, &mut pending) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    if unsafe { libc::ioctl(fd, libc::TIOCSIG as libc::c_ulong, libc::SIGINT) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    Ok(pending.max(0) as usize)
}

pub fn terminal(fd: i32, pid: i32) -> Result<[u64; 13], Refusal> {
    let mut size: libc::winsize = unsafe { std::mem::zeroed() };
    if unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, &mut size) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    let mut modes: libc::termios = unsafe { std::mem::zeroed() };
    if unsafe { libc::tcgetattr(fd, &mut modes) } < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    let foreground = unsafe { libc::tcgetpgrp(fd) };
    let pgid = unsafe { libc::getpgid(pid) };
    let sid = unsafe { libc::getsid(pid) };
    if pgid < 0 || sid < 0 {
        return Err(refusal(io::Error::last_os_error()));
    }
    Ok([
        pid as u64,
        pgid as u64,
        sid as u64,
        foreground.max(0) as u64,
        u64::from(size.ws_row),
        u64::from(size.ws_col),
        u64::from(modes.c_cc[libc::VINTR]),
        u64::from(modes.c_lflag & libc::ISIG != 0),
        u64::from(modes.c_lflag & libc::ICANON != 0),
        u64::from(modes.c_lflag & libc::ECHO != 0),
        u64::from(modes.c_lflag & libc::ECHOCTL != 0),
        u64::from(modes.c_lflag & libc::NOFLSH != 0),
        u64::from(modes.c_lflag & libc::EXTPROC != 0),
    ])
}
