use crate::refusal::Refusal;
use std::cell::RefCell;
use std::ffi::CStr;
use std::io;
use std::sync::OnceLock;

const KINFO_SIZE: usize = 648;
const START_SECONDS: usize = 0;
const START_MICROS: usize = 8;
const STATE: usize = 36;
const PID: usize = 40;
const PARENT: usize = 560;
const GROUP: usize = 564;
const ZOMBIE: u8 = 5;
const WORD: usize = size_of::<usize>();

pub struct Identity {
    pub parent: u32,
    pub group: u32,
    pub seconds: u64,
    pub micros: u64,
    pub zombie: bool,
}

impl Identity {
    fn witness(&self) -> (u64, u64) {
        (self.seconds, self.micros)
    }
}

fn errno() -> i32 {
    match io::Error::last_os_error().raw_os_error() {
        Some(0) | None => libc::EIO,
        Some(code) => code,
    }
}

fn int(bytes: &[u8], at: usize) -> i32 {
    i32::from_ne_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

fn row(bytes: &[u8]) -> (i32, Identity) {
    let mut seconds = [0u8; 8];
    seconds.copy_from_slice(&bytes[START_SECONDS..START_SECONDS + 8]);
    let identity = Identity {
        parent: int(bytes, PARENT) as u32,
        group: int(bytes, GROUP) as u32,
        seconds: i64::from_ne_bytes(seconds) as u64,
        micros: int(bytes, START_MICROS) as u64,
        zombie: bytes[STATE] == ZOMBIE,
    };
    (int(bytes, PID), identity)
}

pub fn identity(pid: i32) -> Result<Identity, i32> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid];
    let mut buffer = [0u8; KINFO_SIZE];
    let mut size = KINFO_SIZE;
    let read = unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
    if read != 0 {
        return Err(errno());
    }
    if size == 0 {
        return Err(libc::ESRCH);
    }
    if size != KINFO_SIZE {
        return Err(libc::EBADMSG);
    }
    let (read_pid, identity) = row(&buffer);
    if read_pid != pid {
        return Err(libc::EBADMSG);
    }
    Ok(identity)
}

pub fn descriptors(pid: i32) -> Result<usize, Refusal> {
    let size = size_of::<libc::proc_fdinfo>();
    let required = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
    if required <= 0 {
        return Err(Refusal::Failed(format!("sizing descriptors of {pid}: {}", io::Error::last_os_error())));
    }
    let mut bytes = required as usize + size;
    loop {
        let limit = i32::try_from(bytes).map_err(|_| Refusal::Failed(format!("the descriptors of {pid} exceed the native buffer range")))?;
        let mut buffer = vec![0u8; bytes];
        let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, buffer.as_mut_ptr().cast(), limit) };
        if read <= 0 {
            return Err(Refusal::Failed(format!("reading descriptors of {pid}: {}", io::Error::last_os_error())));
        }
        if !(read as usize).is_multiple_of(size) {
            return Err(Refusal::Failed(format!("the descriptors of {pid} did not contain whole entries")));
        }
        if (read as usize) < bytes {
            return Ok(read as usize / size);
        }
        bytes = bytes.checked_mul(2).ok_or_else(|| Refusal::Failed(format!("the descriptors of {pid} exceed the native buffer range")))?;
    }
}

fn half(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

thread_local! {
    static TABLE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn listed(buffer: &mut Vec<u8>, mut mib: [i32; 4]) -> Result<usize, Refusal> {
    for _ in 0..4 {
        if buffer.len() < KINFO_SIZE * 64 {
            buffer.resize(KINFO_SIZE * 64, 0);
        }
        let mut size = buffer.len();
        let read = unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
        if read == 0 {
            if !size.is_multiple_of(KINFO_SIZE) {
                return Err(Refusal::Failed(format!("the process table answered {size} bytes, not whole {KINFO_SIZE}-byte entries")));
            }
            return Ok(size);
        }
        let code = errno();
        if code != libc::ENOMEM {
            return Err(Refusal::Failed(format!("reading the process table: {}", io::Error::from_raw_os_error(code))));
        }
        let mut needed = 0usize;
        let asked = unsafe { libc::sysctl(mib.as_mut_ptr(), 4, std::ptr::null_mut(), &mut needed, std::ptr::null_mut(), 0) };
        if asked != 0 {
            return Err(Refusal::Failed(format!("sizing the process table: {}", io::Error::last_os_error())));
        }
        buffer.resize(needed + needed / 4 + KINFO_SIZE * 16, 0);
    }
    Err(Refusal::Failed("the process table outgrew every buffer offered".into()))
}

pub fn each(mut visit: impl FnMut(i32, &Identity)) -> Result<(), Refusal> {
    TABLE.with(|slot| {
        let mut buffer = slot.borrow_mut();
        let size = listed(&mut buffer, [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_ALL, 0])?;
        for entry in buffer[..size].chunks_exact(KINFO_SIZE) {
            let (pid, identity) = row(entry);
            if pid > 0 {
                visit(pid, &identity);
            }
        }
        Ok(())
    })
}

pub enum Selection<'a> {
    Table,
    Pids(&'a [i32]),
    Terminal(&'a CStr),
}

fn table_row(out: &mut Vec<u8>, pid: i32, identity: Identity) {
    half(out, pid as u32);
    half(out, identity.parent);
    half(out, identity.group);
    half(out, identity.seconds as u32);
    half(out, (identity.seconds >> 32) as u32);
    half(out, identity.micros as u32);
    half(out, u32::from(identity.zombie));
}

pub fn table(selection: Selection<'_>) -> Result<(Vec<u8>, u32), Refusal> {
    let mib = match selection {
        Selection::Pids(pids) => {
            let mut out = Vec::with_capacity(4 + pids.len() * 28);
            half(&mut out, 0);
            let mut count = 0u32;
            for &pid in pids {
                match identity(pid) {
                    Ok(read) => { table_row(&mut out, pid, read); count += 1; }
                    Err(libc::ESRCH) => {}
                    Err(code) => return Err(Refusal::Failed(format!("reading pid {pid}: {}", io::Error::from_raw_os_error(code)))),
                }
            }
            out[..4].copy_from_slice(&count.to_le_bytes());
            return Ok((out, count));
        }
        Selection::Table => [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_ALL, 0],
        Selection::Terminal(path) => {
            let mut info: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::stat(path.as_ptr(), &mut info) } != 0 {
                return Err(Refusal::Failed(format!("reading terminal {}: {}", path.to_string_lossy(), io::Error::last_os_error())));
            }
            if info.st_mode & libc::S_IFMT != libc::S_IFCHR {
                return Err(Refusal::Invalid(format!("{} is not a terminal device", path.to_string_lossy())));
            }
            [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_TTY, info.st_rdev]
        }
    };
    TABLE.with(|slot| {
        let mut buffer = slot.borrow_mut();
        let size = listed(&mut buffer, mib)?;
        let mut out = Vec::with_capacity(4 + size / KINFO_SIZE * 28);
        half(&mut out, 0);
        let mut count = 0u32;
        for entry in buffer[..size].chunks_exact(KINFO_SIZE) {
            let (pid, identity) = row(entry);
            if pid <= 0 {
                continue;
            }
            table_row(&mut out, pid, identity);
            count += 1;
        }
        out[..4].copy_from_slice(&count.to_le_bytes());
        Ok((out, count))
    })
}

fn argmax() -> usize {
    static ARGMAX: OnceLock<usize> = OnceLock::new();
    *ARGMAX.get_or_init(|| {
        let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
        let mut value: libc::c_int = 0;
        let mut size = size_of::<libc::c_int>();
        let read = unsafe {
            libc::sysctl(mib.as_mut_ptr(), 2, (&mut value as *mut libc::c_int).cast(), &mut size, std::ptr::null_mut(), 0)
        };
        if read == 0 && value > 0 { value as usize } else { 1 << 20 }
    })
}

fn arguments(pid: i32, buffer: &mut [u8]) -> Result<Vec<&[u8]>, i32> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size = buffer.len();
    let read = unsafe { libc::sysctl(mib.as_mut_ptr(), 3, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
    if read != 0 {
        return Err(errno());
    }
    let answer = &buffer[..size.min(buffer.len())];
    if answer.len() < 4 {
        return Err(libc::EBADMSG);
    }
    let count = i32::from_ne_bytes([answer[0], answer[1], answer[2], answer[3]]);
    if count < 0 {
        return Err(libc::EBADMSG);
    }
    let path = 4 + answer[4..].iter().position(|&byte| byte == 0).ok_or(libc::EBADMSG)?;
    let mut at = 4 + (path - 4 + 1).div_ceil(WORD) * WORD;
    if at > answer.len() || answer[path..at].iter().any(|&byte| byte != 0) {
        return Err(libc::EBADMSG);
    }
    let mut out = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let end = at + answer.get(at..).ok_or(libc::EBADMSG)?.iter().position(|&byte| byte == 0).ok_or(libc::EBADMSG)?;
        out.push(&answer[at..end]);
        at = end + 1;
    }
    Ok(out)
}

fn executable(pid: i32) -> Result<Vec<u8>, i32> {
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let read = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if read <= 0 {
        return Err(errno());
    }
    path.truncate(read as usize);
    Ok(path)
}

fn folder(pid: i32) -> Result<Vec<u8>, i32> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = size_of::<libc::proc_vnodepathinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, (&mut info as *mut libc::proc_vnodepathinfo).cast(), size)
    };
    if read != size {
        return Err(errno());
    }
    let path = info.pvi_cdir.vip_path.as_flattened();
    let end = path.iter().position(|&byte| byte == 0).unwrap_or(path.len());
    Ok(path[..end].iter().map(|&byte| byte as u8).collect())
}

fn word(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn bytes(out: &mut Vec<u8>, value: &[u8]) {
    word(out, value.len() as u64);
    out.extend_from_slice(value);
}

fn fields(out: &mut Vec<u8>, pid: i32, buffer: &mut [u8]) {
    match arguments(pid, buffer) {
        Ok(listed) => {
            word(out, 0);
            word(out, listed.len() as u64);
            for argument in listed {
                bytes(out, argument);
            }
        }
        Err(code) => word(out, code as u64),
    }
    for field in [executable(pid), folder(pid)] {
        match field {
            Ok(value) => {
                word(out, 0);
                bytes(out, &value);
            }
            Err(code) => word(out, code as u64),
        }
    }
}

fn encode(out: &mut Vec<u8>, pid: i32, buffer: &mut [u8]) {
    word(out, pid as u64);
    let before = match identity(pid) {
        Ok(identity) => identity,
        Err(code) => {
            word(out, code as u64);
            return;
        }
    };
    let mut read = Vec::new();
    fields(&mut read, pid, buffer);
    let after = match identity(pid) {
        Ok(identity) if identity.witness() == before.witness() => identity,
        Ok(_) => {
            word(out, libc::ESRCH as u64);
            return;
        }
        Err(code) => {
            word(out, code as u64);
            return;
        }
    };
    word(out, 0);
    word(out, after.parent as u64);
    word(out, after.group as u64);
    word(out, after.seconds);
    word(out, after.micros);
    word(out, u64::from(after.zombie));
    out.extend_from_slice(&read);
}

thread_local! {
    static ARGUMENTS: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

pub fn facts(pids: &[i32]) -> Vec<u8> {
    ARGUMENTS.with(|slot| {
        let mut buffer = slot.borrow_mut();
        if buffer.len() < argmax() {
            buffer.resize(argmax(), 0);
        }
        let mut out = Vec::new();
        word(&mut out, pids.len() as u64);
        for &pid in pids {
            encode(&mut out, pid, &mut buffer);
        }
        out
    })
}

#[cfg(test)]
mod tests {
    use super::{Selection, facts, identity, table};
    use std::os::unix::process::CommandExt;
    use std::path::Path;
    use std::process::{Child, Command, Stdio};
    use std::time::Duration;

    struct Reaped(Child, bool);

    impl Reaped {
        fn pid(&self) -> i32 {
            self.0.id() as i32
        }

        fn reap(&mut self) {
            self.0.wait().unwrap();
            self.1 = true;
        }
    }

    impl Drop for Reaped {
        fn drop(&mut self) {
            if !self.1 {
                unsafe { libc::kill(-self.pid(), libc::SIGKILL) };
                let _ = self.0.wait();
            }
        }
    }

    fn started(program: &str, args: &[&str], folder: &Path) -> Reaped {
        Reaped(
            Command::new(program)
                .args(args)
                .current_dir(folder)
                .env("PROBE_SECRET", "hunter2")
                .process_group(0)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()
                .unwrap(),
            false,
        )
    }

    struct Row {
        pid: i32,
        parent: u32,
        group: u32,
        started: (u64, u64),
        zombie: bool,
    }

    fn rows() -> Vec<Row> {
        let (blob, count) = table(Selection::Table).map_err(|_| "the table refused").unwrap();
        let half = |at: usize| u32::from_le_bytes(blob[at..at + 4].try_into().unwrap());
        assert_eq!(half(0), count);
        assert_eq!(blob.len(), 4 + count as usize * 28);
        (0..count as usize)
            .map(|index| {
                let at = 4 + index * 28;
                Row {
                    pid: half(at) as i32,
                    parent: half(at + 4),
                    group: half(at + 8),
                    started: (half(at + 12) as u64 | (half(at + 16) as u64) << 32, half(at + 20) as u64),
                    zombie: half(at + 24) != 0,
                }
            })
            .collect()
    }

    struct Answer {
        pid: i32,
        errno: u64,
        started: Option<(u64, u64)>,
        zombie: bool,
        arguments: Option<Vec<Vec<u8>>>,
        folder: Option<Vec<u8>>,
    }

    fn decode(blob: &[u8]) -> Vec<Answer> {
        let mut at = 0;
        let word = |at: &mut usize| {
            let value = u64::from_le_bytes(blob[*at..*at + 8].try_into().unwrap());
            *at += 8;
            value
        };
        let take = |at: &mut usize| {
            let length = word(at) as usize;
            let value = blob[*at..*at + length].to_vec();
            *at += length;
            value
        };
        let count = word(&mut at);
        let mut out = Vec::new();
        for _ in 0..count {
            let pid = word(&mut at) as i32;
            let errno = word(&mut at);
            if errno != 0 {
                out.push(Answer { pid, errno, started: None, zombie: false, arguments: None, folder: None });
                continue;
            }
            let _parent = word(&mut at);
            let _group = word(&mut at);
            let started = Some((word(&mut at), word(&mut at)));
            let zombie = word(&mut at) != 0;
            let arguments = if word(&mut at) == 0 {
                let count = word(&mut at);
                Some((0..count).map(|_| take(&mut at)).collect())
            } else {
                None
            };
            if word(&mut at) == 0 {
                take(&mut at);
            }
            let folder = if word(&mut at) == 0 { Some(take(&mut at)) } else { None };
            out.push(Answer { pid, errno, started, zombie, arguments, folder });
        }
        assert_eq!(at, blob.len(), "the answer holds nothing past its last process");
        out
    }

    fn settled(pid: i32, done: impl Fn(&Answer) -> bool) -> Answer {
        for _ in 0..200 {
            let answer = decode(&facts(&[pid])).remove(0);
            if done(&answer) {
                return answer;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("pid {pid} never answered what the case waits for");
    }

    #[test]
    fn a_live_child_answers_its_arguments_folder_and_a_witness_the_table_agrees_with() {
        let home = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let child = started("/usr/bin/perl", &["-e", "sleep 30", "two words", "a\nnewline"], &home);
        let pid = child.pid();
        let answer = settled(pid, |answer| answer.arguments.as_ref().is_some_and(|listed| listed.len() == 5));
        let first = identity(pid).unwrap();
        let second = identity(pid).unwrap();
        let own = rows().into_iter().find(|row| row.pid == pid).unwrap();
        assert_eq!(
            answer.arguments.unwrap(),
            vec![b"/usr/bin/perl".to_vec(), b"-e".to_vec(), b"sleep 30".to_vec(), b"two words".to_vec(), b"a\nnewline".to_vec()]
        );
        assert_eq!(answer.folder.as_deref(), Some(home.as_os_str().as_encoded_bytes()));
        assert_eq!((first.seconds, first.micros), (second.seconds, second.micros));
        assert_eq!(answer.started, Some((first.seconds, first.micros)));
        assert_eq!(own.started, (first.seconds, first.micros));
        assert_eq!(own.parent, std::process::id());
        assert!(!own.zombie);
    }

    #[test]
    fn the_table_reads_this_process_as_the_kernel_names_it() {
        let own = rows().into_iter().find(|row| row.pid == std::process::id() as i32).unwrap();
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = size_of::<libc::proc_bsdinfo>() as i32;
        let read = unsafe {
            libc::proc_pidinfo(own.pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size)
        };
        assert_eq!(read, size);
        assert_eq!(own.parent, unsafe { libc::getppid() } as u32);
        assert_eq!(own.group, unsafe { libc::getpgrp() } as u32);
        assert_eq!(own.started, (info.pbi_start_tvsec, info.pbi_start_tvusec));
    }

    #[test]
    fn another_users_process_is_in_the_table_and_its_witness_reads() {
        let launchd = rows().into_iter().find(|row| row.pid == 1).unwrap();
        let read = identity(1).unwrap();
        assert_eq!(launchd.started, (read.seconds, read.micros));
        assert_eq!(read.parent, 0);
    }

    #[test]
    fn an_empty_first_argument_keeps_its_place_and_no_environment_is_read_as_one() {
        let child = started("/usr/bin/perl", &["-e", "exec {q{/bin/sleep}} q{}, q{7}"], Path::new("/"));
        let answer = settled(child.pid(), |answer| answer.arguments.as_ref().is_some_and(|listed| listed.last() == Some(&b"7".to_vec())));
        assert_eq!(answer.arguments.unwrap(), vec![Vec::new(), b"7".to_vec()]);
    }

    #[test]
    fn an_exited_pid_is_answered_as_not_read_and_an_unreaped_one_as_a_zombie() {
        let mut ended = started("/bin/sh", &["-c", "exit 0"], Path::new("/"));
        let pid = ended.pid();
        let mut zombie = false;
        for _ in 0..200 {
            if identity(pid).is_ok_and(|read| read.zombie) {
                zombie = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let unreaped = decode(&facts(&[pid])).remove(0);
        ended.reap();
        assert!(zombie);
        assert!(unreaped.zombie);
        assert_eq!(identity(pid).err(), Some(libc::ESRCH));
        let answers = decode(&facts(&[pid]));
        assert_eq!(answers.len(), 1);
        assert_eq!((answers[0].pid, answers[0].errno), (pid, libc::ESRCH as u64));
    }

    #[test]
    fn a_child_is_listed_under_its_parent_with_a_start_at_or_after_the_parents() {
        let parent = started("/bin/sh", &["-c", "/bin/sleep 30 & wait"], Path::new("/"));
        let pid = parent.pid();
        let mut children = Vec::new();
        let mut own = (0, 0);
        for _ in 0..200 {
            let listed = rows();
            children = listed.iter().filter(|row| row.parent == pid as u32).map(|row| (row.group, row.started)).collect();
            if !children.is_empty() {
                own = listed.iter().find(|row| row.pid == pid).unwrap().started;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].0, pid as u32);
        assert!(children[0].1 >= own);
    }
}
