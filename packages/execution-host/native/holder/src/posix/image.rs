use super::{backend::Backend, sys};
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
    pub fn open<B: Backend>(state: &Path) -> Result<Self, String> {
        let source = B::image_source()?;
        match Self::pin::<B>(state, &source) {
            Ok(image) => Ok(image),
            Err(detail) => {
                eprintln!("execution-holder: launch image could not be pinned ({detail}); using {}", source.display());
                let path = CString::new(source.as_os_str().as_bytes()).map_err(|_| "the image path carries a NUL".to_string())?;
                Ok(Self { path, digest: None, _lease: None })
            }
        }
    }

    fn pin<B: Backend>(state: &Path, source: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(source).map_err(failure)?;
        B::verify_image(&bytes)?;
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
            B::sync_image(&file)?;
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
