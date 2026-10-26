use super::sys;
use sha2::{Digest, Sha256};
use std::ffi::{CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

pub struct Image {
    path: CString,
    digest: Option<String>,
    _lease: Option<File>,
}

fn failure(error: std::io::Error) -> String { error.to_string() }

unsafe extern "C" {
    fn _dyld_get_image_header(index: u32) -> *const u8;
}

fn uuid(bytes: &[u8]) -> Option<[u8; 16]> {
    if bytes.get(..4)? != [0xcf, 0xfa, 0xed, 0xfe] { return None; }
    let count = u32::from_le_bytes(bytes.get(16..20)?.try_into().ok()?);
    let length = u32::from_le_bytes(bytes.get(20..24)?.try_into().ok()?) as usize;
    let commands = bytes.get(32..32usize.checked_add(length)?)?;
    let mut at = 0usize;
    for _ in 0..count {
        let command = u32::from_le_bytes(commands.get(at..at.checked_add(4)?)?.try_into().ok()?);
        let size = u32::from_le_bytes(commands.get(at.checked_add(4)?..at.checked_add(8)?)?.try_into().ok()?) as usize;
        if size < 8 { return None; }
        let entry = commands.get(at..at.checked_add(size)?)?;
        if command == 0x1b { return entry.get(8..24)?.try_into().ok(); }
        at = at.checked_add(size)?;
    }
    None
}

fn current_uuid() -> Option<[u8; 16]> {
    let header = unsafe { _dyld_get_image_header(0) };
    if header.is_null() { return None; }
    let bytes = unsafe { std::slice::from_raw_parts(header, 32) };
    let length = u32::from_le_bytes(bytes.get(20..24)?.try_into().ok()?) as usize;
    uuid(unsafe { std::slice::from_raw_parts(header, 32usize.checked_add(length)?) })
}

fn unused(directory: &Path, kept: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(directory).map_err(failure)? {
        let path = entry.map_err(failure)?.path();
        if path == kept { continue; }
        let file = File::open(&path).map_err(failure)?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } < 0 {
            let errno = sys::errno();
            if errno == libc::EWOULDBLOCK { continue; }
            return Err(format!("image lease {}: errno {errno}", path.display()));
        }
        std::fs::remove_file(&path).map_err(failure)?;
    }
    Ok(())
}

impl Image {
    pub fn open(state: &Path) -> Result<Self, String> {
        let source = std::env::current_exe().map_err(failure)?;
        match Self::pin(state, &source) {
            Ok(image) => Ok(image),
            Err(detail) => {
                eprintln!("execution-holder: launch image could not be pinned ({detail}); using {}", source.display());
                let path = CString::new(source.as_os_str().as_bytes()).map_err(|_| "the image path carries a NUL".to_string())?;
                Ok(Self { path, digest: None, _lease: None })
            }
        }
    }

    fn pin(state: &Path, source: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(source).map_err(failure)?;
        let loaded = current_uuid().ok_or("the running image has no readable UUID")?;
        if uuid(&bytes) != Some(loaded) { return Err("the source is not the running image".into()); }
        let digest = Sha256::digest(&bytes);
        let directory = state.join("launch-images");
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&directory).map_err(failure)?;
        let path = directory.join(format!("{digest:x}"));
        if let Err(detail) = unused(&directory, &path) {
            eprintln!("execution-holder: unused launch images could not be cleaned: {detail}");
        }
        let reusable = match std::fs::read(&path) {
            Ok(saved) => Sha256::digest(&saved) == digest,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(failure(error)),
        };
        let file = if reusable {
            File::open(&path).map_err(failure)?
        } else {
            let pending = directory.join(format!("pending-{}", std::process::id()));
            let mut file = OpenOptions::new().read(true).write(true).create_new(true).mode(0o700)
                .custom_flags(libc::O_CLOEXEC).open(&pending).map_err(failure)?;
            file.write_all(&bytes).map_err(failure)?;
            file.set_permissions(std::fs::Permissions::from_mode(0o700)).map_err(failure)?;
            if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) } < 0 {
                return Err(format!("sync launch image: errno {}", sys::errno()));
            }
            std::fs::rename(&pending, &path).map_err(failure)?;
            drop(file);
            File::open(&path).map_err(failure)?
        };
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_SH | libc::LOCK_NB) } < 0 {
            return Err(format!("image lease {}: errno {}", path.display(), sys::errno()));
        }
        let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "the image path carries a NUL".to_string())?;
        Ok(Self { path, digest: Some(format!("sha256:{digest:x}")), _lease: Some(file) })
    }

    pub fn path(&self) -> &CStr { &self.path }

    pub fn digest(&self) -> Option<&str> { self.digest.as_deref() }
}

pub fn digest_of(path: &Path) -> Result<String, std::io::Error> {
    Ok(format!("sha256:{:x}", Sha256::digest(std::fs::read(path)?)))
}
