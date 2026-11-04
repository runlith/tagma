use super::{events::Queue, sys};
#[cfg(target_os = "macos")]
use std::ffi::CStr;
use std::ffi::OsStr;
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileExt, OpenOptionsExt};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

pub const LIMIT_VARIABLE: &str = "EXECUTION_OUTPUT_LIMIT";
static SINK: OnceLock<Mutex<Sink>> = OnceLock::new();

struct Sink {
    file: File,
    writer: File,
    limit: usize,
}

impl Sink {
    fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
        let fd = self.writer.as_raw_fd();
        loop {
            if unsafe { libc::flock(fd, libc::LOCK_EX) } >= 0 { break; }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted { return Err(error); }
        }
        let written = self.append_locked(bytes);
        let unlocked = unsafe { libc::flock(fd, libc::LOCK_UN) };
        written?;
        if unlocked < 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }

    fn append_locked(&mut self, bytes: &[u8]) -> io::Result<()> {
        let bytes = &bytes[bytes.len().saturating_sub(self.limit)..];
        let size = self.file.metadata()?.len();
        if size.saturating_add(bytes.len() as u64) > self.limit as u64 {
            let kept = (self.limit - bytes.len()).min(size as usize);
            let mut tail = vec![0; kept];
            self.file.read_exact_at(&mut tail, size - kept as u64)?;
            self.file.set_len(0)?;
            self.file.write_all(&tail)?;
        }
        self.file.write_all(bytes)
    }
}

pub fn install() -> Result<(), String> {
    let Some(limit) = std::env::var_os(LIMIT_VARIABLE) else { return Ok(()); };
    let limit = limit.to_str().and_then(|value| value.parse::<usize>().ok()).filter(|limit| *limit > 0)
        .ok_or_else(|| format!("{LIMIT_VARIABLE} must name a positive byte limit"))?;
    #[cfg(target_os = "macos")]
    let path = {
        let mut path = [0 as libc::c_char; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(libc::STDERR_FILENO, libc::F_GETPATH, path.as_mut_ptr()) } < 0 { return Err(format!("the diagnostic output file could not be named: {}", io::Error::last_os_error())); }
        unsafe { CStr::from_ptr(path.as_ptr()) }.to_owned()
    };
    #[cfg(target_os = "linux")]
    let path = {
        let path = std::fs::read_link("/proc/self/fd/2").map_err(|error| format!("the diagnostic output file could not be named: {error}"))?;
        std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|error| error.to_string())?
    };
    let file = OpenOptions::new().read(true).append(true).open(Path::new(OsStr::from_bytes(path.to_bytes())))
        .map_err(|error| format!("the diagnostic output file could not be opened: {error}"))?;
    if !file.metadata().map_err(|error| error.to_string())?.is_file() {
        return Err("the diagnostic output is not a regular file".into());
    }
    let mut writing = OsStr::from_bytes(path.to_bytes()).to_os_string();
    writing.push(".writing");
    let writer = OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600).open(Path::new(&writing))
        .map_err(|error| format!("the diagnostic writer could not be held: {error}"))?;
    let mut sink = Sink { file, writer, limit };
    sink.append(&[]).map_err(|error| format!("the diagnostic output could not be bounded: {error}"))?;
    SINK.set(Mutex::new(sink)).map_err(|_| "the diagnostic output was already installed".to_string())?;
    let output = SINK.get().expect("the diagnostic output was installed");
    std::panic::set_hook(Box::new(move |panic| {
        let message = format!("{panic}\n");
        match output.try_lock() {
            Ok(mut sink) => {
                if let Err(error) = sink.append(message.as_bytes()) { report(&error); }
            }
            Err(_) => report(&io::Error::other(message)),
        }
    }));
    Ok(())
}

fn report(error: &io::Error) {
    let message = format!("execution-holder: diagnostic output could not be written: {error}");
    unsafe { libc::syslog(libc::LOG_ERR, c"%.*s".as_ptr(), message.len().min(libc::c_int::MAX as usize) as libc::c_int, message.as_ptr().cast::<libc::c_char>()) };
}

pub fn message(message: fmt::Arguments<'_>) {
    if let Some(sink) = SINK.get() {
        let mut sink = sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Err(error) = sink.append(format!("{message}\n").as_bytes()) {
            report(&error);
        }
    } else {
        let _ = writeln!(io::stderr(), "{message}");
    }
}

pub struct Capture {
    reader: OwnedFd,
    writer: OwnedFd,
}

impl Capture {
    pub fn open(queue: &Queue) -> Result<Option<Self>, String> {
        if SINK.get().is_none() { return Ok(None); }
        let (reader, writer) = sys::pipe().map_err(|errno| format!("diagnostic pipe: errno {errno}"))?;
        sys::nonblocking(reader.as_raw_fd()).map_err(|errno| format!("diagnostic pipe readiness: errno {errno}"))?;
        queue.read(reader.as_raw_fd()).map_err(|errno| format!("diagnostic pipe interest: errno {errno}"))?;
        Ok(Some(Self { reader, writer }))
    }

    pub fn reader(&self) -> RawFd { self.reader.as_raw_fd() }
    pub fn writer(&self) -> RawFd { self.writer.as_raw_fd() }

    pub fn drain(&self, finishing: bool) {
        let mut bytes = [0u8; 4096];
        loop {
            let read = unsafe { libc::read(self.reader.as_raw_fd(), bytes.as_mut_ptr().cast(), bytes.len()) };
            if read < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted { continue; }
            if read <= 0 { return; }
            if let Some(sink) = SINK.get() {
                let mut sink = sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Err(error) = sink.append(&bytes[..read as usize]) {
                    report(&error);
                }
            }
            if !finishing { return; }
        }
    }
}
