use super::spawn::Spawner;
use super::sys;
use crate::frames::Reason;
use crate::platform::Failure;
use crate::table::Prepared;
use std::ffi::{CString, OsStr, OsString, c_int};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

pub const SUCCESSOR: &str = "--successor";
pub const RETURNED: &str = "--returned";
pub const VERIFY: &str = "--verify";
const STANDING: &str = "bundle";
const NEXT: &str = "bundle.next";
const PRIOR: &str = "bundle.prior";
const ENTRY: &str = "holder.entry";

#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Activated,
    Returned,
    Verifying,
}

#[derive(Clone)]
pub struct Inherited {
    pub claim: RawFd,
    pub table: RawFd,
    pub child_nofile: libc::rlim_t,
    pub part: String,
    pub state: PathBuf,
    pub mode: Mode,
}

fn text(path: &Path) -> Result<CString, Failure> {
    CString::new(path.as_os_str().as_bytes()).map_err(|_| Failure::new(Reason::Invalid, format!("{} carries a NUL", path.display())))
}

fn descriptor(value: &OsStr) -> Result<RawFd, String> {
    value.to_str().and_then(|value| value.parse::<RawFd>().ok()).filter(|fd| *fd > 2).ok_or_else(|| format!("{} names no descriptor", value.display()))
}

pub fn part(state: &Path, holder: &str) -> PathBuf {
    state.join(NEXT).join(holder)
}

pub fn standing(state: &Path, holder: &str) -> PathBuf {
    state.join(STANDING).join(holder)
}

fn written(state: &Path, bytes: &[u8]) -> Result<OwnedFd, Failure> {
    let name = text(&state.join(format!(".holder-table-{}", std::process::id())))?;
    let mut opened = unsafe { libc::open(name.as_ptr(), libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC, 0o600) };
    if opened < 0 && sys::errno() == libc::EEXIST {
        unsafe { libc::unlink(name.as_ptr()) };
        opened = unsafe { libc::open(name.as_ptr(), libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC, 0o600) };
    }
    if opened < 0 {
        return Err(sys::failure(sys::errno(), "the holder table could not be created"));
    }
    let file = unsafe { OwnedFd::from_raw_fd(opened) };
    if unsafe { libc::unlink(name.as_ptr()) } < 0 {
        return Err(sys::failure(sys::errno(), "the holder table could not be unlinked"));
    }
    let mut offset = 0;
    while offset < bytes.len() {
        let wrote = unsafe { libc::write(file.as_raw_fd(), bytes[offset..].as_ptr().cast(), bytes.len() - offset) };
        if wrote > 0 {
            offset += wrote as usize;
            continue;
        }
        let errno = if wrote == 0 { libc::EIO } else { sys::errno() };
        if errno != libc::EINTR {
            return Err(sys::failure(errno, "the holder table could not be written"));
        }
    }
    Ok(file)
}

pub fn table(fd: RawFd) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut landing = [0u8; 65_536];
    loop {
        let read = unsafe { libc::pread(fd, landing.as_mut_ptr().cast(), landing.len(), bytes.len() as libc::off_t) };
        if read == 0 {
            return Ok(bytes);
        }
        if read < 0 {
            let errno = sys::errno();
            if errno == libc::EINTR {
                continue;
            }
            return Err(format!("the carried table could not be read: errno {errno}"));
        }
        bytes.extend_from_slice(&landing[..read as usize]);
    }
}

pub fn inherited(args: &[OsString]) -> Result<Inherited, String> {
    let [mode, claim, table, nofile, part, state] = args else {
        return Err("the successor holder expects its claim, its table, the soft descriptor limit of children, its part and the state directory".into());
    };
    let part = part.to_str().ok_or("the part of the holder is not UTF-8")?.to_string();
    Ok(Inherited {
        claim: descriptor(claim)?,
        table: descriptor(table)?,
        child_nofile: nofile.to_str().and_then(|value| value.parse::<libc::rlim_t>().ok()).ok_or("the soft descriptor limit of children is not a number")?,
        part,
        state: PathBuf::from(state),
        mode: if mode == SUCCESSOR {
            Mode::Activated
        } else if mode == VERIFY {
            Mode::Verifying
        } else {
            Mode::Returned
        },
    })
}

impl Inherited {
    pub fn table(&self) -> Result<Vec<u8>, String> {
        if self.mode != Mode::Verifying && unsafe { libc::flock(self.claim, libc::LOCK_EX | libc::LOCK_NB) } < 0 {
            return Err(format!("the inherited claim is not held: errno {}", sys::errno()));
        }
        table(self.table)
    }

    pub fn argv(&self, image: &Path, mode: &str) -> Result<Vec<CString>, Failure> {
        [
            text(image),
            text(Path::new(mode)),
            text(Path::new(&self.claim.to_string())),
            text(Path::new(&self.table.to_string())),
            text(Path::new(&self.child_nofile.to_string())),
            text(Path::new(&self.part)),
            text(&self.state),
        ]
        .into_iter()
        .collect()
    }

    pub fn images(&self) -> (PathBuf, PathBuf) {
        (standing(&self.state, &self.part), self.state.join(PRIOR).join(&self.part))
    }

    pub fn bundles(&self) -> [PathBuf; 3] {
        [self.state.join(STANDING), self.state.join(NEXT), self.state.join(PRIOR)]
    }

    pub fn seal(&self) {
        if let Err(errno) = sys::cloexec(self.claim) {
            eprintln!("execution-holder: the inherited claim could not be kept from children: errno {errno}");
        }
        unsafe { libc::close(self.table) };
    }

    pub fn retreat(&self, handles: &[RawFd], why: &str, stay: bool) -> String {
        if self.mode != Mode::Activated {
            return why.to_string();
        }
        super::rescue::disarm();
        let restored = restore(&self.state);
        let image = match &restored {
            Ok(()) => standing(&self.state, &self.part),
            Err(failure) if stay => return format!("{why}; the prior bundle could not be restored ({})", failure.detail),
            Err(failure) => {
                eprintln!("execution-holder: the prior bundle could not be restored ({}); its holder returns from {PRIOR}", failure.detail);
                self.state.join(PRIOR).join(&self.part)
            }
        };
        eprintln!("execution-holder: the successor cannot take over ({why}); the prior holder returns");
        let carried = [self.claim, self.table].into_iter().chain(handles.iter().copied()).try_for_each(|fd| {
            sys::inheritable(fd).map_err(|errno| format!("descriptor {fd} could not be carried back: errno {errno}"))
        });
        let failed = match carried {
            Ok(()) => self.exec(&image),
            Err(detail) => detail,
        };
        if restored.is_ok() {
            if let Err(failure) = rotate(&self.state) {
                eprintln!("execution-holder: the activated bundle could not be put back: {}", failure.detail);
            }
        }
        for fd in handles {
            if let Err(errno) = sys::cloexec(*fd) {
                eprintln!("execution-holder: descriptor {fd} could not be kept from children again: errno {errno}");
            }
        }
        format!("{why}; {failed}")
    }

    fn exec(&self, image: &Path) -> String {
        let argv = match self.argv(image, RETURNED) {
            Ok(argv) => argv,
            Err(failure) => return failure.detail,
        };
        let mut pointers: Vec<*const libc::c_char> = argv.iter().map(|arg| arg.as_ptr()).collect();
        pointers.push(std::ptr::null());
        unsafe { libc::execv(argv[0].as_ptr(), pointers.as_ptr()) };
        format!("the prior holder could not be started again: errno {}", sys::errno())
    }
}

fn environment() -> Vec<CString> {
    std::env::vars_os()
        .filter_map(|(name, value)| {
            let mut entry = name.as_bytes().to_vec();
            entry.push(b'=');
            entry.extend_from_slice(value.as_bytes());
            CString::new(entry).ok()
        })
        .collect()
}

fn inheriting(flags: c_int, kept: &[RawFd]) -> Result<Spawner, Failure> {
    let mut spawner = Spawner::new(flags | libc::POSIX_SPAWN_CLOEXEC_DEFAULT | libc::POSIX_SPAWN_SETSIGDEF | libc::POSIX_SPAWN_SETSIGMASK)
        .map_err(|(errno, detail)| Failure::new(sys::classify(errno), detail))?;
    for fd in (0..=2).chain(kept.iter().copied()) {
        spawner.inherit(fd).map_err(|(errno, detail)| Failure::new(sys::classify(errno), detail))?;
    }
    Ok(spawner)
}

pub fn verify(state: &Path, holder: &str, claim: RawFd, child_nofile: libc::rlim_t, bytes: &[u8], handles: &[RawFd]) -> Result<i32, Failure> {
    let file = written(state, bytes)?;
    let image = part(state, holder);
    let checked = Inherited { claim, table: file.as_raw_fd(), child_nofile, part: holder.to_string(), state: state.to_path_buf(), mode: Mode::Verifying };
    let argv = checked.argv(&image, VERIFY)?;
    let mut spawner = inheriting(0, &[file.as_raw_fd()])?;
    for fd in std::iter::once(claim).chain(handles.iter().copied()) {
        spawner.placeholder(fd).map_err(|(errno, detail)| Failure::new(sys::classify(errno), detail))?;
    }
    spawner.spawn(&argv[0], &argv, &environment()).map_err(|(errno, detail)| Failure::new(sys::classify(errno), detail))
}

pub fn replace(state: &Path, holder: &str, claim: RawFd, child_nofile: libc::rlim_t, bytes: &[u8], handles: &[Rc<OwnedFd>]) -> Failure {
    let mut kept: Vec<RawFd> = handles.iter().map(|handle| handle.as_raw_fd()).collect();
    kept.push(claim);
    let failure = match replacing(state, holder, claim, child_nofile, bytes, &kept) {
        Ok(_) => Failure::new(Reason::Os, "posix_spawn returned after replacing the image"),
        Err(failure) => failure,
    };
    for fd in kept {
        if let Err(errno) = sys::cloexec(fd) {
            eprintln!("execution-holder: descriptor {fd} could not be kept from children again: errno {errno}");
        }
    }
    failure
}

fn replacing(state: &Path, holder: &str, claim: RawFd, child_nofile: libc::rlim_t, bytes: &[u8], kept: &[RawFd]) -> Result<i32, Failure> {
    let file = written(state, bytes)?;
    let image = text(&standing(state, holder))?;
    let mut kept = kept.to_vec();
    kept.push(file.as_raw_fd());
    for fd in &kept {
        sys::inheritable(*fd).map_err(|errno| sys::failure(errno, &format!("descriptor {fd} could not be carried")))?;
    }
    let spawner = inheriting(libc::POSIX_SPAWN_SETEXEC, &kept)?;
    let argv = [
        image.clone(),
        CString::new(SUCCESSOR).unwrap(),
        CString::new(claim.to_string()).unwrap(),
        CString::new(file.as_raw_fd().to_string()).unwrap(),
        CString::new(child_nofile.to_string()).unwrap(),
        text(Path::new(holder))?,
        text(state)?,
    ];
    spawner.spawn(&image, &argv, &environment()).map_err(|(errno, detail)| Failure::new(sys::classify(errno), detail))
}

fn relative(value: &str) -> Result<&str, Failure> {
    let path = Path::new(value);
    if value.is_empty() || value.contains('\0') || !path.components().all(|part| matches!(part, std::path::Component::Normal(_))) {
        return Err(Failure::new(Reason::Invalid, format!("{value:?} in {ENTRY} is not a path inside its root")));
    }
    Ok(value)
}

fn rooted(root: &Path, value: &str) -> Result<String, Failure> {
    let path = root.join(relative(value)?);
    path.to_str().map(str::to_string).ok_or_else(|| Failure::new(Reason::Invalid, format!("{} is not UTF-8", path.display())))
}

pub fn entry(state: &Path) -> Result<Option<Prepared>, Failure> {
    let path = state.join(NEXT).join(ENTRY);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(sys::failure(error.raw_os_error().unwrap_or(libc::EIO), &format!("read {}", path.display()))),
    };
    let mut lines = text.lines();
    let holder = match lines.next().and_then(|line| line.strip_prefix("holder ")) {
        Some(holder) => relative(holder)?.to_string(),
        None => return Err(Failure::new(Reason::Invalid, format!("{} does not open with the holder part", path.display()))),
    };
    let logic = lines
        .map(|line| match line.split_once(' ') {
            Some(("bundle", value)) => rooted(&state.join(STANDING), value),
            Some(("state", value)) => rooted(state, value),
            Some(("text", value)) => Ok(value.to_string()),
            _ => Err(Failure::new(Reason::Invalid, format!("{line:?} in {} is not an argument of the logic", path.display()))),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if logic.is_empty() {
        return Err(Failure::new(Reason::Invalid, format!("{} names no logic program", path.display())));
    }
    Ok(Some(Prepared { holder, logic }))
}

fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

fn swap(from: &Path, to: &Path) -> Result<(), Failure> {
    let (from_text, to_text) = (text(from)?, text(to)?);
    sys::check(unsafe { libc::renamex_np(from_text.as_ptr(), to_text.as_ptr(), libc::RENAME_SWAP) })
        .map_err(|errno| sys::failure(errno, &format!("swap {} and {}", from.display(), to.display())))
}

fn rename(from: &Path, to: &Path) -> Result<(), Failure> {
    std::fs::rename(from, to).map_err(|error| {
        let errno = error.raw_os_error().unwrap_or(libc::EIO);
        sys::failure(errno, &format!("rename {} to {}", from.display(), to.display()))
    })
}

pub fn rotate(state: &Path) -> Result<(), Failure> {
    let (standing, next, prior) = (state.join(STANDING), state.join(NEXT), state.join(PRIOR));
    if exists(&prior) {
        std::fs::remove_dir_all(&prior).map_err(|error| {
            sys::failure(error.raw_os_error().unwrap_or(libc::EIO), &format!("remove {}", prior.display()))
        })?;
    }
    swap(&next, &standing)?;
    if let Err(failure) = rename(&next, &prior) {
        swap(&next, &standing)?;
        return Err(failure);
    }
    Ok(())
}

pub fn restore(state: &Path) -> Result<(), Failure> {
    let (standing, next, prior) = (state.join(STANDING), state.join(NEXT), state.join(PRIOR));
    swap(&prior, &standing)?;
    rename(&prior, &next)
}
