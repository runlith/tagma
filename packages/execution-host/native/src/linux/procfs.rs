use std::fs;
use std::io;

pub struct Stat {
    pub parent: u32,
    pub group: u32,
    pub terminal: u64,
    pub started: u64,
    pub zombie: bool,
    pub own: u64,
    pub children: u64,
    pub resident: u64,
}

pub fn error(error: io::Error) -> i32 {
    match error.raw_os_error() {
        Some(libc::ENOENT) => libc::ESRCH,
        Some(code) if code > 0 => code,
        _ => libc::EIO,
    }
}

pub fn parse(bytes: &[u8]) -> Result<Stat, i32> {
    let at = bytes.iter().rposition(|byte| *byte == b')').ok_or(libc::EBADMSG)?;
    let text = std::str::from_utf8(&bytes[at + 1..]).map_err(|_| libc::EBADMSG)?;
    let fields: Vec<_> = text.split_whitespace().collect();
    let value = |at: usize| fields.get(at).ok_or(libc::EBADMSG)?.parse::<u64>().map_err(|_| libc::EBADMSG);
    let signed = |at: usize| fields.get(at).ok_or(libc::EBADMSG)?.parse::<i64>().map_err(|_| libc::EBADMSG);
    let parent = u32::try_from(value(1)?).map_err(|_| libc::EBADMSG)?;
    let group = u32::try_from(value(2)?).map_err(|_| libc::EBADMSG)?;
    Ok(Stat {
        parent,
        group,
        terminal: (signed(4)? as u32) as u64,
        started: value(19)?,
        zombie: matches!(fields.first(), Some(&"Z") | Some(&"X")),
        own: value(11)?.checked_add(value(12)?).ok_or(libc::EOVERFLOW)?,
        children: (signed(13)?.max(0) as u64).checked_add(signed(14)?.max(0) as u64).ok_or(libc::EOVERFLOW)?,
        resident: signed(21)?.max(0) as u64,
    })
}

pub fn stat(pid: i32) -> Result<Stat, i32> {
    parse(&fs::read(format!("/proc/{pid}/stat")).map_err(error)?)
}

pub fn pids() -> Result<Vec<i32>, i32> {
    fs::read_dir("/proc").map_err(error)?.filter_map(|entry| match entry {
        Ok(entry) => entry.file_name().to_str().and_then(|name| name.parse::<i32>().ok()).filter(|pid| *pid > 0).map(Ok),
        Err(failure) => Some(Err(error(failure))),
    }).collect()
}

pub fn group_standing(group: i32, ignored: Option<i32>) -> Result<bool, i32> {
    for pid in pids()? {
        if Some(pid) == ignored { continue; }
        let membership = unsafe { libc::getpgid(pid) };
        if membership < 0 {
            let code = error(io::Error::last_os_error());
            if code == libc::ESRCH { continue; }
            return Err(code);
        }
        if membership != group { continue; }
        match stat(pid) {
            Ok(read) if read.group == group as u32 && !read.zombie => return Ok(true),
            Ok(_) | Err(libc::ESRCH) => {},
            Err(code) => return Err(code),
        }
    }
    Ok(false)
}

