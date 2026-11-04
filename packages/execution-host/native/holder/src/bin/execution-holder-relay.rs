use std::io;

const PEER: i32 = 0;

fn control() -> Result<i32, String> {
    std::env::var("EXECUTION_HOLDER_FD")
        .map_err(|_| "EXECUTION_HOLDER_FD names no descriptor; the relay runs as a holder's logic".to_string())?
        .parse::<i32>()
        .map_err(|e| format!("EXECUTION_HOLDER_FD: {e}"))
}

fn hand(fd: i32) -> Result<(), String> {
    let length = size_of::<i32>() as u32;
    let mut room = vec![0u8; unsafe { libc::CMSG_SPACE(length) } as usize];
    let byte = [b'r'];
    let mut part = libc::iovec { iov_base: byte.as_ptr().cast_mut().cast(), iov_len: 1 };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut part;
    message.msg_iovlen = 1;
    message.msg_control = room.as_mut_ptr().cast();
    message.msg_controllen = room.len() as _;
    let sent = unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(length) as _;
        std::ptr::copy_nonoverlapping((&fd as *const i32).cast::<u8>(), libc::CMSG_DATA(header), length as usize);
        libc::sendmsg(PEER, &message, 0)
    };
    if sent != 1 {
        return Err(format!("the control descriptor could not be handed on: {}", io::Error::last_os_error()));
    }
    Ok(())
}

fn main() {
    let handed = control().and_then(|fd| {
        let flags = unsafe { libc::fcntl(PEER, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(PEER, libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0 {
            return Err(format!("the peer could not be made blocking: {}", io::Error::last_os_error()));
        }
        hand(fd)?;
        Ok(())
    });
    if let Err(message) = handed {
        eprintln!("execution-holder-relay: {message}");
        std::process::exit(1);
    }
    let mut byte = [0u8; 1];
    loop {
        let read = unsafe { libc::read(PEER, byte.as_mut_ptr().cast(), 1) };
        if read > 0 { continue; }
        if read == 0 { break; }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EINTR) { continue; }
        eprintln!("execution-holder-relay: the peer refused a read: {error}");
        std::process::exit(1);
    }
}
