use crate::abi;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

struct Wire<'a> { bytes: &'a [u8], at: usize }
impl<'a> Wire<'a> {
    fn word(&mut self) -> u64 { let value = u64::from_le_bytes(self.bytes[self.at..self.at + 8].try_into().unwrap()); self.at += 8; value }
    fn bytes(&mut self) -> &'a [u8] { let length = self.word() as usize; let bytes = &self.bytes[self.at..self.at + length]; self.at += length; bytes }
}

fn identity(pid: i32) -> (i32, [u64; 5]) {
    let mut fields = [0; 5];
    (unsafe { abi::execution_platform_process_identity(pid, fields.as_mut_ptr()) }, fields)
}

fn facts(pid: i32) -> Vec<u8> {
    let mut pointer = std::ptr::null_mut();
    let mut length = 0;
    assert_eq!(unsafe { abi::execution_platform_process_facts(&pid, 1, &mut pointer, &mut length) }, 1);
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec();
    assert_eq!(unsafe { abi::execution_platform_processes_release(pointer, length) }, 0);
    bytes
}

fn table(kind: i32, pids: &[i32]) -> Vec<u8> {
    let mut pointer = std::ptr::null_mut();
    let mut length = 0;
    let count = unsafe { abi::execution_platform_process_table(kind, pids.as_ptr(), pids.len() as i32, std::ptr::null(), &mut pointer, &mut length) };
    assert!(count >= 0);
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec();
    assert_eq!(bytes.len(), 4 + count as usize * 28);
    assert_eq!(unsafe { abi::execution_platform_processes_release(pointer, length) }, 0);
    bytes
}

#[test]
fn process_abi_keeps_arguments_identity_folder_and_zombie_until_reaped() {
    let home = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let script = "printf 'ready\\n'; read release";
    let mut child = ChildGuard(Command::new("/bin/sh").arg0("").args(["-c", script, "two words", "a\nnewline"])
        .current_dir(&home).env("PROBE_SECRET", "not-an-argument").process_group(0).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap());
    let mut ready = String::new();
    BufReader::new(child.0.stdout.take().unwrap()).read_line(&mut ready).unwrap();
    assert_eq!(ready, "ready\n");
    let pid = child.0.id() as i32;
    let (status, first) = identity(pid);
    assert_eq!(status, 0);
    assert_eq!(first[0], std::process::id() as u64);
    assert_eq!(first[1], pid as u64);
    assert_eq!(first[4], 0);
    assert_eq!(identity(pid), (0, first));
    assert!(abi::execution_platform_process_descriptors(pid) >= 3);
    let selected = table(1, &[pid]);
    let half = |at| u32::from_le_bytes(selected[at..at + 4].try_into().unwrap());
    assert_eq!(half(0), 1);
    assert_eq!(half(4), pid as u32);
    assert_eq!((half(8) as u64, half(12) as u64), (first[0], first[1]));
    assert_eq!(half(16) as u64 | (half(20) as u64) << 32, first[2]);
    assert_eq!(half(24) as u64, first[3]);
    let all = table(0, &[]);
    assert!(all[4..].chunks_exact(28).any(|row| row == &selected[4..]));
    let encoded = facts(pid);
    let mut wire = Wire { bytes: &encoded, at: 0 };
    assert_eq!((wire.word(), wire.word(), wire.word()), (1, pid as u64, 0));
    for expected in first { assert_eq!(wire.word(), expected); }
    assert_eq!(wire.word(), 0);
    assert_eq!(wire.word(), 5);
    for expected in ["", "-c", script, "two words", "a\nnewline"] { assert_eq!(wire.bytes(), expected.as_bytes()); }
    assert_eq!(wire.word(), 0);
    let executable = wire.bytes();
    assert!(!executable.is_empty());
    assert_eq!(wire.word(), 0);
    assert_eq!(wire.bytes(), home.as_os_str().as_encoded_bytes());
    assert_eq!(wire.at, encoded.len());
    child.0.stdin.as_mut().unwrap().write_all(b"done\n").unwrap();
    let mut observed: libc::siginfo_t = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::waitid(libc::P_PID, pid as libc::id_t, &mut observed, libc::WEXITED | libc::WNOWAIT) }, 0);
    assert_eq!(identity(pid).1[4], 1);
    let zombie = facts(pid);
    assert_eq!(u64::from_le_bytes(zombie[56..64].try_into().unwrap()), 1);
    assert!(child.0.wait().unwrap().success());
    assert_eq!(identity(pid).0, libc::ESRCH);
    let gone = facts(pid);
    assert_eq!(gone.len(), 24);
    assert_eq!(u64::from_le_bytes(gone[16..24].try_into().unwrap()), libc::ESRCH as u64);
    let init = identity(1);
    assert_eq!(init.0, 0);
    assert_eq!(init.1[0], 0);
}

#[cfg(target_os = "linux")]
#[test]
fn process_descriptor_census_excludes_its_own_probe() {
    if std::env::var_os("DESCRIPTOR_CENSUS_CHILD").is_some() {
        let input = std::io::stdin();
        println!("\nfd-count={}", abi::execution_platform_process_descriptors(std::process::id() as i32));
        std::io::stdout().flush().unwrap();
        input.read_line(&mut String::new()).unwrap();
        return;
    }
    let mut child = ChildGuard(Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "testing::process_descriptor_census_excludes_its_own_probe", "--nocapture", "--test-threads=1"])
        .env("DESCRIPTOR_CENSUS_CHILD", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap());
    let mut output = BufReader::new(child.0.stdout.take().unwrap());
    let own = loop {
        let mut line = String::new();
        assert!(output.read_line(&mut line).unwrap() > 0);
        if let Some(count) = line.trim_end().strip_prefix("fd-count=") { break count.parse::<i32>().unwrap(); }
    };
    let observed = abi::execution_platform_process_descriptors(child.0.id() as i32);
    child.0.stdin.take().unwrap().write_all(b"done\n").unwrap();
    assert!(child.0.wait().unwrap().success());
    assert!(observed >= 3);
    assert_eq!(own, observed, "self and external census must count the same standing descriptors");
}

#[test]
fn resource_abi_reports_process_and_machine_counters_in_platform_units() {
    let mut limits = [0; 3];
    assert_eq!(unsafe { abi::execution_platform_limits(limits.as_mut_ptr()) }, 0);
    assert!(limits.iter().all(|value| *value > 0));
    let first = abi::execution_platform_uptime_nanos();
    assert!(first > 0);
    assert!(abi::execution_platform_uptime_nanos() >= first);
    let mut machine = [0; 12];
    assert_eq!(unsafe { crate::usage::execution_usage_machine(machine.as_mut_ptr()) }, 0);
    assert!(machine[0] <= machine[1]);
    assert!(machine[2] > 0);
    assert_eq!(machine[4] + machine[5], machine[3]);
    assert_eq!(machine[11], 1);
    #[cfg(target_os = "linux")]
    let before = crate::procfs::stat(std::process::id() as i32).unwrap();
    let mut rows = vec![0; 1024 * crate::usage::ROW];
    let count = loop {
        let capacity = rows.len() / crate::usage::ROW;
        let count = unsafe { crate::usage::execution_usage_all(rows.as_mut_ptr(), capacity as i32) };
        assert!(count > 0);
        if count as usize <= capacity { break count; }
        rows.resize((count as usize + count as usize / 4 + 64) * crate::usage::ROW, 0);
    };
    let own = rows[..count as usize * crate::usage::ROW].chunks_exact(crate::usage::ROW).find(|row| row[0] == std::process::id() as u64).unwrap();
    assert_eq!(own[1], 0);
    let (_, identity) = identity(std::process::id() as i32);
    assert_eq!((own[4], own[5]), (identity[2], identity[3]));
    assert!(own[9] > 0);
    #[cfg(target_os = "linux")]
    {
        assert_eq!(machine[10], 2);
        assert_eq!(own[5], 0);
        let ticks = abi::execution_platform_clock_ticks();
        let boot = abi::execution_platform_boot_nanos();
        assert!(ticks > 0 && boot > 0);
        let after = crate::procfs::stat(std::process::id() as i32).unwrap();
        assert!(crate::clock::micros(before.own, ticks) <= own[7] && own[7] <= crate::clock::micros(after.own, ticks));
        assert!(crate::clock::micros(before.children, ticks) <= own[8] && own[8] <= crate::clock::micros(after.children, ticks));
        let started = boot / 1_000_000 + own[4] * 1000 / ticks;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        assert!(started <= now);
        assert_eq!(unsafe { crate::usage::execution_usage_gpu(std::ptr::null_mut(), 0) }, -libc::ENOTSUP);
    }
    #[cfg(target_os = "macos")]
    assert_eq!(machine[10], 1);
}

use std::sync::{Mutex, OnceLock, mpsc};
static READY: OnceLock<Mutex<Option<mpsc::Sender<()>>>> = OnceLock::new();
unsafe extern "C" fn ready() { if let Some(sender) = READY.get().unwrap().lock().unwrap().as_ref() { let _ = sender.send(()); } }

#[test]
fn readiness_keeps_independent_read_and_write_interest_and_reports_eof() {
    let (sender, receiver) = mpsc::channel();
    *READY.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(sender);
    let reactor = abi::execution_platform_reactor_open(Some(ready));
    assert!(!reactor.is_null());
    let mut pair = [0; 2];
    assert_eq!(unsafe { abi::execution_platform_fd_pair(pair.as_mut_ptr()) }, 0);
    for fd in pair { assert!(unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) } >= 0); }
    let bytes = [b'x'; 16384];
    let mut filled = 0;
    loop {
        let count = unsafe { abi::execution_platform_fd_write(pair[0], bytes.as_ptr(), bytes.len() as i32) };
        if count == -2 { break; }
        assert!(count > 0);
        filled += count as usize;
    }
    assert_eq!(unsafe { abi::execution_platform_reactor_arm(reactor, pair[0], 42, 0, 1) }, 0);
    assert_eq!(unsafe { abi::execution_platform_reactor_arm(reactor, pair[0], 42, 1, 0) }, 0);
    assert_eq!(unsafe { abi::execution_platform_fd_write(pair[1], bytes.as_ptr(), 1) }, 1);
    let mut out = [0; 128];
    let mut read = false;
    while !read {
        receiver.recv().unwrap();
        let count = unsafe { abi::execution_platform_reactor_take(reactor, out.as_mut_ptr(), out.len() as i32) };
        assert!(count >= 0);
        read = out[..count as usize * 2].chunks_exact(2).any(|event| event == [42, 1]);
    }
    let mut landing = [0; 16384];
    let mut drained = 0;
    while drained < filled {
        let count = unsafe { abi::execution_platform_fd_read(pair[1], landing.as_mut_ptr(), landing.len() as i32) };
        assert!(count > 0);
        drained += count as usize;
    }
    let mut writable = false;
    while !writable {
        receiver.recv().unwrap();
        let count = unsafe { abi::execution_platform_reactor_take(reactor, out.as_mut_ptr(), out.len() as i32) };
        assert!(count >= 0);
        writable = out[..count as usize * 2].chunks_exact(2).any(|event| event[0] == 42 && event[1] & 2 != 0);
    }
    assert_eq!(unsafe { abi::execution_platform_fd_read(pair[0], landing.as_mut_ptr(), landing.len() as i32) }, 1);
    assert_eq!(unsafe { abi::execution_platform_reactor_arm(reactor, pair[0], 42, 1, 0) }, 0);
    assert_eq!(abi::execution_platform_fd_close(pair[1]), 0);
    let mut eof = false;
    while !eof {
        receiver.recv().unwrap();
        let count = unsafe { abi::execution_platform_reactor_take(reactor, out.as_mut_ptr(), out.len() as i32) };
        assert!(count >= 0);
        eof = out[..count as usize * 2].chunks_exact(2).any(|event| event[0] == 42 && event[1] & 4 != 0);
    }
    assert_eq!(abi::execution_platform_fd_close(pair[0]), 0);
    loop {
        let answer = unsafe { abi::execution_platform_reactor_close(reactor) };
        assert!(answer == 0 || answer == 1);
        if answer == 0 { break; }
        unsafe { abi::execution_platform_reactor_take(reactor, out.as_mut_ptr(), out.len() as i32) };
        std::thread::yield_now();
    }
    assert_eq!(unsafe { abi::execution_platform_reactor_dispose(reactor) }, 0);
    *READY.get().unwrap().lock().unwrap() = None;
}

fn send_handles(fd: i32, bytes: &[u8], handles: &[i32]) {
    let length = size_of_val(handles) as u32;
    let mut control = vec![0; unsafe { libc::CMSG_SPACE(length) } as usize];
    let mut part = libc::iovec { iov_base: bytes.as_ptr().cast_mut().cast(), iov_len: bytes.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut part;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as _;
    unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(length) as _;
        std::ptr::copy_nonoverlapping(handles.as_ptr().cast::<u8>(), libc::CMSG_DATA(header), length as usize);
        assert_eq!(libc::sendmsg(fd, &message, 0), bytes.len() as isize);
    }
}

#[test]
fn descriptor_receive_preserves_the_payload_on_capacity_refusal_and_keeps_the_channel() {
    let input = unsafe { libc::fcntl(0, libc::F_GETFD) };
    assert!(input >= 0);
    let mut pair = [0; 2];
    assert_eq!(unsafe { abi::execution_platform_fd_pair(pair.as_mut_ptr()) }, 0);
    send_handles(pair[0], b"first", &pair);
    send_handles(pair[0], b"second", &pair[..1]);
    let mut bytes = [0; 6];
    let mut handles = [0];
    let mut received = [0; 2];
    assert_eq!(unsafe { abi::execution_platform_fd_receive(pair[1], bytes.as_mut_ptr(), 5, handles.as_mut_ptr(), 1, received.as_mut_ptr()) }, 5);
    assert_eq!(&bytes[..5], b"first");
    assert_eq!(received, [0, 1]);
    assert_eq!(unsafe { libc::fcntl(0, libc::F_GETFD) }, input, "receiving rights must keep unrelated descriptors open");
    assert_eq!(unsafe { abi::execution_platform_fd_receive(pair[1], bytes.as_mut_ptr(), 6, handles.as_mut_ptr(), 1, received.as_mut_ptr()) }, 6);
    assert_eq!(&bytes, b"second");
    assert_eq!(received, [1, 0]);
    assert!(unsafe { libc::fcntl(handles[0], libc::F_GETFD) } & libc::FD_CLOEXEC != 0);
    assert_eq!(abi::execution_platform_fd_close(handles[0]), 0);
    for fd in pair { assert_eq!(abi::execution_platform_fd_close(fd), 0); }
}
