#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Frame { body: Vec<u8>, handles: Vec<OwnedFd> }
struct Reader<'a> { bytes: &'a [u8], at: usize }
impl<'a> Reader<'a> {
    fn byte(&mut self) -> u8 { let byte = self.bytes[self.at]; self.at += 1; byte }
    fn word(&mut self) -> u32 { let word = u32::from_le_bytes(self.bytes[self.at..self.at + 4].try_into().unwrap()); self.at += 4; word }
    fn long(&mut self) -> u64 { let word = u64::from_le_bytes(self.bytes[self.at..self.at + 8].try_into().unwrap()); self.at += 8; word }
    fn data(&mut self) -> &'a [u8] { let length = self.word() as usize; let bytes = &self.bytes[self.at..self.at + length]; self.at += length; bytes }
    fn exit(&mut self) -> Option<Result<i32, String>> {
        match self.byte() { 0 => None, 1 => Some(Ok(self.word() as i32)), 2 => Some(Err(String::from_utf8(self.data().to_vec()).unwrap())), _ => panic!("invalid exit") }
    }
}

fn data(bytes: &mut Vec<u8>, value: &[u8]) { bytes.extend((value.len() as u32).to_le_bytes()); bytes.extend(value); }
fn texts(bytes: &mut Vec<u8>, values: &[&str]) { bytes.extend((values.len() as u32).to_le_bytes()); for value in values { data(bytes, value.as_bytes()); } }

fn receive(fd: RawFd, into: &mut [u8], handles: &mut Vec<OwnedFd>) -> usize {
    let mut control = vec![0u8; unsafe { libc::CMSG_SPACE(64) } as usize];
    let mut part = libc::iovec { iov_base: into.as_mut_ptr().cast(), iov_len: into.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut part;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as _;
    let count = loop {
        let count = unsafe { libc::recvmsg(fd, &mut message, 0) };
        if count < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted { continue; }
        assert!(count > 0, "the native channel ended: {}", std::io::Error::last_os_error());
        break count as usize;
    };
    assert_eq!(message.msg_flags & libc::MSG_CTRUNC, 0);
    let mut header = unsafe { libc::CMSG_FIRSTHDR(&message) };
    while !header.is_null() {
        unsafe {
            if (*header).cmsg_level == libc::SOL_SOCKET && (*header).cmsg_type == libc::SCM_RIGHTS {
                let count = ((*header).cmsg_len as usize - libc::CMSG_LEN(0) as usize) / size_of::<RawFd>();
                for index in 0..count {
                    let fd = libc::CMSG_DATA(header).cast::<RawFd>().add(index).read_unaligned();
                    assert!(libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) >= 0);
                    handles.push(OwnedFd::from_raw_fd(fd));
                }
            }
            header = libc::CMSG_NXTHDR(&message, header);
        }
    }
    count
}

struct Channel { stream: UnixStream, serial: u32, exits: HashMap<Vec<u8>, Result<i32, String>> }
impl Channel {
    fn connect(peer: &UnixStream) -> Self {
        let mut marker = [0];
        let mut handles = Vec::new();
        assert_eq!(receive(peer.as_raw_fd(), &mut marker, &mut handles), 1);
        assert_eq!(marker, [b'r']);
        assert_eq!(handles.len(), 1);
        let stream = UnixStream::from(handles.remove(0));
        stream.set_nonblocking(false).unwrap();
        Self { stream, serial: 0, exits: HashMap::new() }
    }
    fn frame(&mut self) -> Frame {
        let mut prefix = [0; 4];
        let mut handles = Vec::new();
        let mut at = 0;
        while at < 4 { at += receive(self.stream.as_raw_fd(), &mut prefix[at..], &mut handles); }
        let mut body = vec![0; u32::from_le_bytes(prefix) as usize];
        at = 0;
        while at < body.len() { at += receive(self.stream.as_raw_fd(), &mut body[at..], &mut handles); }
        Frame { body, handles }
    }
    fn notice(&mut self, frame: &Frame) {
        assert_eq!(frame.body[0], 134);
        let mut reader = Reader { bytes: &frame.body, at: 5 };
        let key = reader.data().to_vec();
        self.exits.insert(key, reader.exit().unwrap());
    }
    fn call(&mut self, kind: u8, fields: Vec<u8>) -> Frame {
        self.serial += 1;
        let mut body = vec![kind];
        body.extend(self.serial.to_le_bytes());
        body.extend(fields);
        self.stream.write_all(&(body.len() as u32).to_le_bytes()).unwrap();
        self.stream.write_all(&body).unwrap();
        loop {
            let frame = self.frame();
            if frame.body[0] == 134 { self.notice(&frame); continue; }
            assert_eq!(u32::from_le_bytes(frame.body[1..5].try_into().unwrap()), self.serial);
            return frame;
        }
    }
    fn done(&mut self, kind: u8, fields: Vec<u8>) { let frame = self.call(kind, fields); assert_eq!(frame.body[0], 131, "{:?}", frame.body); }
    fn exited(&mut self, key: &[u8]) -> Result<i32, String> {
        loop {
            if let Some(exit) = self.exits.remove(key) { return exit; }
            let frame = self.frame();
            self.notice(&frame);
        }
    }
    fn break_link(&mut self) { self.stream.write_all(&0u32.to_le_bytes()).unwrap(); }
}

struct Record { key: Vec<u8>, pid: i32, birth: String, pace: u8, handles: Vec<OwnedFd> }
impl Record {
    fn read(frame: Frame) -> Self {
        assert!([129, 130].contains(&frame.body[0]), "{:?}", frame.body);
        let mut reader = Reader { bytes: &frame.body, at: 5 };
        let key = reader.data().to_vec();
        let pid = reader.word() as i32;
        assert_eq!(reader.word(), pid as u32);
        reader.data();
        let birth = String::from_utf8(reader.data().to_vec()).unwrap();
        reader.byte();
        let pace = reader.byte();
        reader.byte();
        reader.exit();
        if reader.byte() != 0 { reader.long(); reader.long(); reader.long(); }
        let mask = reader.byte();
        assert_eq!(frame.handles.len(), mask.count_ones() as usize);
        assert_eq!(reader.word(), 0);
        assert_eq!(reader.at, frame.body.len());
        Self { key, pid, birth, pace, handles: frame.handles }
    }
}

fn hello(frame: Frame, pid: u32, count: u32, generation: Option<u64>) -> bool {
    assert_eq!(frame.body[0], 128);
    assert_eq!(frame.handles.len(), 1);
    let mut reader = Reader { bytes: &frame.body, at: 5 };
    assert_eq!(reader.word(), pid);
    assert_eq!(reader.word(), count);
    if reader.byte() != 0 { assert!(reader.long() > 0); }
    reader.byte();
    reader.byte();
    let capabilities = reader.word();
    let mut replacement = false;
    let mut raises = false;
    for _ in 0..capabilities {
        let capability = reader.data();
        replacement |= capability == b"holder-replaces-itself";
        raises |= capability == b"pace-raise";
    }
    assert!(replacement);
    assert_eq!(reader.word(), 0);
    let read_generation = if reader.byte() == 0 { None } else { Some(reader.long()) };
    assert_eq!(read_generation, generation);
    assert_eq!(reader.at, frame.body.len());
    raises
}

struct Holder { process: Child, peer: UnixStream, channel: Channel, state: PathBuf, children: Vec<i32>, raises: bool }
impl Holder {
    fn start(priority: Option<i32>) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let state = std::env::temp_dir().join(format!("execution-holder-native-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&state).unwrap();
        std::fs::create_dir(state.join("bundle")).unwrap();
        std::fs::copy(env!("CARGO_BIN_EXE_execution-holder"), state.join("bundle/holder")).unwrap();
        let (peer, inherited) = UnixStream::pair().unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_execution-holder"));
        command.arg(&state).arg(env!("CARGO_BIN_EXE_execution-holder-relay"))
            .stdin(Stdio::from(OwnedFd::from(inherited))).stdout(Stdio::null()).stderr(Stdio::inherit());
        if let Some(priority) = priority { unsafe { command.pre_exec(move || {
            if libc::setpriority(libc::PRIO_PROCESS, 0, priority) < 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
        }); } }
        let process = command.spawn().unwrap();
        let mut channel = Channel::connect(&peer);
        let raises = hello(channel.frame(), process.id(), 0, None);
        channel.done(7, vec![]);
        channel.done(12, 123u64.to_le_bytes().to_vec());
        Self { process, peer, channel, state, children: Vec::new(), raises }
    }
    fn launch(&mut self, key: &str, script: &str, terminal: bool, pace: u8) -> Record {
        let mut fields = Vec::new();
        data(&mut fields, key.as_bytes());
        data(&mut fields, b"/bin/sh");
        texts(&mut fields, &["/bin/sh", "-c", script]);
        texts(&mut fields, &["PATH=/usr/bin:/bin", "TERM=xterm"]);
        fields.push(0);
        if terminal { fields.push(1); fields.extend(24u16.to_le_bytes()); fields.extend(80u16.to_le_bytes()); }
        else { fields.extend([2, 2]); }
        fields.push(pace);
        let record = Record::read(self.channel.call(1, fields));
        self.children.push(record.pid);
        assert_eq!(unsafe { libc::getsid(record.pid) }, record.pid);
        assert_eq!(unsafe { libc::getpgid(record.pid) }, record.pid);
        #[cfg(target_os = "linux")]
        assert!(record.birth.ends_with(":0"));
        record
    }
    #[cfg(target_os = "linux")]
    fn pace(&mut self, record: &Record, initial: u8, next: u8) -> Result<bool, u8> {
        let mut fields = 1u32.to_le_bytes().to_vec();
        fields.extend((record.pid as u32).to_le_bytes());
        data(&mut fields, record.birth.as_bytes());
        fields.extend([initial, next]);
        let frame = self.channel.call(11, fields);
        assert_eq!(frame.body[0], 135);
        let mut reader = Reader { bytes: &frame.body, at: 5 };
        assert_eq!(reader.word(), 1);
        let outcome = match reader.byte() {
            0 => Ok(false),
            1 => Ok(true),
            2 => { let reason = reader.byte(); reader.data(); Err(reason) },
            _ => panic!("invalid pace outcome"),
        };
        assert_eq!(reader.at, frame.body.len());
        outcome
    }
    fn renew(&mut self, count: u32) -> Vec<Record> {
        self.channel.break_link();
        let mut channel = Channel::connect(&self.peer);
        hello(channel.frame(), self.process.id(), count, Some(123));
        let records = (0..count).map(|_| Record::read(channel.frame())).collect();
        channel.done(7, vec![]);
        self.channel = channel;
        records
    }
    fn stage(&self, valid: bool) {
        use std::os::unix::fs::PermissionsExt;
        let directory = self.state.join("bundle.next");
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("holder");
        if valid {
            std::fs::copy(env!("CARGO_BIN_EXE_execution-holder"), &path).unwrap();
            std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"native-succession").unwrap();
        } else {
            std::fs::write(&path, b"#!/bin/sh\nexit 1\n").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
    }
    fn prepare(&mut self) -> Frame {
        let mut fields = Vec::new();
        data(&mut fields, b"holder");
        texts(&mut fields, &[env!("CARGO_BIN_EXE_execution-holder-relay")]);
        self.channel.call(13, fields)
    }
    fn finish(mut self) {
        self.channel.done(6, vec![]);
        self.peer.shutdown(std::net::Shutdown::Both).unwrap();
        assert!(self.process.wait().unwrap().success());
        self.children.clear();
        std::fs::remove_dir_all(&self.state).unwrap();
    }
}
impl Drop for Holder {
    fn drop(&mut self) {
        for &pid in &self.children { unsafe { libc::kill(-pid, libc::SIGKILL); libc::kill(pid, libc::SIGKILL); } }
        let _ = self.process.kill();
        let _ = self.process.wait();
        let _ = std::fs::remove_dir_all(&self.state);
    }
}

fn keyed(key: &[u8]) -> Vec<u8> { let mut fields = Vec::new(); data(&mut fields, key); fields }
fn blocking(handle: OwnedFd) -> File {
    let fd = handle.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    assert!(flags >= 0);
    assert!(unsafe { libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK) } >= 0);
    File::from(handle)
}
fn line(reader: &mut impl BufRead) -> String { let mut line = String::new(); assert!(reader.read_line(&mut line).unwrap() > 0); line.trim_end_matches(['\r', '\n']).to_string() }

#[cfg(target_os = "linux")]
fn priority(pid: i32) -> i32 {
    unsafe { *libc::__errno_location() = 0; }
    let priority = unsafe { libc::getpriority(libc::PRIO_PROCESS, pid as libc::id_t) };
    assert!(priority != -1 || unsafe { *libc::__errno_location() } == 0);
    priority
}

#[cfg(target_os = "linux")]
fn threads(pid: i32) -> Vec<i32> {
    std::fs::read_dir(format!("/proc/{pid}/task")).unwrap().map(|task| priority(task.unwrap().file_name().to_str().unwrap().parse().unwrap())).collect()
}

#[cfg(target_os = "linux")]
#[test]
fn linux_pacing_keeps_the_inherited_priority_and_restores_it_after_lowest() {
    let baseline = priority(0).max(10);
    let mut holder = Holder::start(Some(baseline));
    eprintln!("holder baseline nice={baseline}, pace-raise={}", holder.raises);
    assert_eq!(priority(holder.process.id() as i32), baseline);
    let low = holder.launch("low", "read stop", false, 1);
    assert_eq!(low.pace, 1);
    assert_eq!(priority(low.pid), baseline);
    assert_eq!(holder.pace(&low, 1, 1), Ok(false));
    let full = holder.launch("full", "read stop", false, 0);
    assert_eq!(full.pace, 0);
    assert_eq!(priority(full.pid), baseline);
    assert_eq!(holder.pace(&full, 0, 0), Ok(false));
    if holder.raises {
        for (record, initial) in [(&full, 0), (&low, 1)] {
            assert_eq!(holder.pace(record, initial, 2), Ok(baseline != 19));
            assert_eq!(priority(record.pid), 19);
            assert_eq!(holder.pace(record, initial, initial), Ok(baseline != 19));
            assert_eq!(priority(record.pid), baseline);
        }
        let mut threaded = holder.launch("threaded", "exec python3 -c 'import sys, threading; event = threading.Event(); [threading.Thread(target=event.wait, daemon=True).start() for _ in range(3)]; print(\"ready\", flush=True); sys.stdin.read()'", false, 0);
        let _input = blocking(threaded.handles.pop().unwrap());
        let _errors = blocking(threaded.handles.pop().unwrap());
        let mut output = BufReader::new(blocking(threaded.handles.pop().unwrap()));
        assert_eq!(line(&mut output), "ready");
        assert_eq!(threads(threaded.pid).len(), 4);
        assert_eq!(holder.pace(&threaded, 0, 2), Ok(baseline != 19));
        assert!(threads(threaded.pid).into_iter().all(|nice| nice == 19));
        assert_eq!(holder.pace(&threaded, 0, 0), Ok(baseline != 19));
        assert!(threads(threaded.pid).into_iter().all(|nice| nice == baseline));
    } else if baseline < 19 {
        assert_eq!(holder.pace(&full, 0, 2), Err(8));
        assert_eq!(priority(full.pid), baseline);
        assert_eq!(unsafe { libc::setpriority(libc::PRIO_PROCESS, full.pid as libc::id_t, 19) }, 0);
        assert_eq!(holder.pace(&full, 0, 0), Err(8));
        assert_eq!(priority(full.pid), 19);
    }
    holder.finish();
}

#[test]
fn native_holder_keeps_custody_through_logic_and_image_replacement() {
    let mut holder = Holder::start(None);
    let mut pipe = holder.launch("pipes", "printf 'ready\\n'; read first; printf 'first:%s\\n' \"$first\"; read last; printf 'last:%s\\n' \"$last\"; exit 7", false, 0);
    let mut input = blocking(pipe.handles.pop().unwrap());
    let _stderr = blocking(pipe.handles.pop().unwrap());
    let mut output = BufReader::new(blocking(pipe.handles.pop().unwrap()));
    assert_eq!(line(&mut output), "ready");
    let mut terminal = holder.launch("terminal", "stty -echo; trap 'exit 99' HUP; printf 'ready\\n'; read first; printf 'first:%s\\n' \"$first\"; read last; printf 'last:%s\\n' \"$last\"; exit 9", true, 0);
    let master = blocking(terminal.handles.pop().unwrap());
    assert_eq!(unsafe { libc::tcgetpgrp(master.as_raw_fd()) }, terminal.pid);
    let mut terminal_input = master.try_clone().unwrap();
    let mut terminal_output = BufReader::new(master);
    assert_eq!(line(&mut terminal_output), "ready");
    let records = holder.renew(2);
    for record in records {
        let original = if record.key == b"pipes" { &pipe } else { &terminal };
        assert_eq!((record.pid, &record.birth), (original.pid, &original.birth));
    }
    input.write_all(b"one\n").unwrap();
    terminal_input.write_all(b"one\n").unwrap();
    assert_eq!(line(&mut output), "first:one");
    assert_eq!(line(&mut terminal_output), "first:one");
    let mut early = holder.launch("early", "read stop; exit 5", false, 0);
    blocking(early.handles.pop().unwrap()).write_all(b"go\n").unwrap();
    assert_eq!(holder.channel.exited(b"early"), Ok(5));
    holder.stage(false);
    let refused = holder.prepare();
    assert_eq!(refused.body[0], 133);
    std::fs::remove_dir_all(holder.state.join("bundle.next")).unwrap();
    holder.stage(true);
    let prepared = holder.prepare();
    assert_eq!(prepared.body[0], 131, "{:?}", prepared.body);
    holder.channel.done(14, vec![]);
    let records = holder.renew(3);
    assert!(holder.state.join("bundle.prior/holder").is_file());
    assert!(std::fs::read(holder.state.join("bundle/holder")).unwrap().ends_with(b"native-succession"));
    for record in records {
        let original = [&pipe, &terminal, &early].into_iter().find(|original| original.key == record.key).unwrap();
        assert_eq!((record.pid, &record.birth), (original.pid, &original.birth));
    }
    let mut late = holder.launch("late", "read stop; exit 6", false, 0);
    blocking(late.handles.pop().unwrap()).write_all(b"go\n").unwrap();
    assert_eq!(holder.channel.exited(b"late"), Ok(6));
    let reaped = holder.channel.call(4, keyed(b"early"));
    assert_eq!(reaped.body[0], 132, "{:?}", reaped.body);
    assert_eq!(Reader { bytes: &reaped.body, at: 5 }.exit(), Some(Ok(5)));
    holder.channel.done(5, keyed(b"early"));
    input.write_all(b"two\n").unwrap();
    terminal_input.write_all(b"two\n").unwrap();
    assert_eq!(line(&mut output), "last:two");
    assert_eq!(line(&mut terminal_output), "last:two");
    assert_eq!(holder.channel.exited(b"pipes"), Ok(7));
    assert_eq!(holder.channel.exited(b"terminal"), Ok(9));
    for (key, code) in [(b"pipes".as_slice(), 7), (b"terminal".as_slice(), 9)] {
        let mut stop = keyed(key);
        stop.extend([2, 3]);
        let stopped = holder.channel.call(2, stop.clone());
        assert!([131, 133].contains(&stopped.body[0]));
        let reaped = holder.channel.call(4, keyed(key));
        assert_eq!(reaped.body[0], 132, "{:?}", reaped.body);
        let mut reader = Reader { bytes: &reaped.body, at: 5 };
        assert_eq!(reader.exit(), Some(Ok(code)));
        reader.long(); reader.long();
        assert!(reader.long() > 0);
        let after = holder.channel.call(2, stop);
        assert_eq!(after.body[0], 133);
        assert_eq!(after.body[5], 3);
        holder.channel.done(5, keyed(key));
    }
    let mut group = holder.launch("group", "/bin/sh -c 'read stop' <&0 & printf '%s\\n' \"$!\"; exit 11", false, 0);
    let _group_input = blocking(group.handles.pop().unwrap());
    let _group_errors = blocking(group.handles.pop().unwrap());
    let mut group_output = BufReader::new(blocking(group.handles.pop().unwrap()));
    let descendant = line(&mut group_output).parse::<i32>().unwrap();
    assert_eq!(holder.channel.exited(b"group"), Ok(11));
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{descendant}/stat")).unwrap();
        let fields = stat.rsplit_once(')').unwrap().1.split_whitespace().collect::<Vec<_>>();
        assert_eq!(fields[1].parse::<u32>().unwrap(), holder.process.id());
    }
    assert_eq!(unsafe { libc::getpgid(descendant) }, group.pid);
    let mut signal = keyed(b"group");
    signal.push(2);
    data(&mut signal, b"SIGKILL");
    holder.channel.done(8, signal);
    let mut tail = Vec::new();
    group_output.read_to_end(&mut tail).unwrap();
    assert!(tail.is_empty());
    let reaped = holder.channel.call(4, keyed(b"group"));
    assert_eq!(reaped.body[0], 132);
    holder.channel.done(5, keyed(b"group"));
    let mut missing = Vec::new();
    data(&mut missing, b"missing"); data(&mut missing, b"/no/such/native-program"); texts(&mut missing, &[]); texts(&mut missing, &[]); missing.extend([0, 2, 0, 0]);
    let refused = holder.channel.call(1, missing);
    assert_eq!((refused.body[0], refused.body[5]), (133, 12));
    holder.finish();
}
