// What the KERNEL allows this process, which nothing above the crate can read for itself: the soft
// descriptor and process limits `getrlimit` answers, and the pty maximum the kernel holds as
// `kern.tty.ptmx_max`. Bun exposes neither call, which is why the reading is here.
//
// A reading that fails REFUSES. A ceiling derived from a figure nobody measured is a host admitting
// work its machine cannot carry, so each of the three answers or none of them does.

use crate::refusal::Refusal;
use std::ffi::CString;
use std::io;
use std::ptr;

// The SOFT limit, because that is what binds this process now: the hard limit is only what it could
// raise itself to, and a count derived from one it has not taken would overcommit until it did.
fn soft(resource: libc::c_int, name: &str) -> Result<u64, Refusal> {
    let mut limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    if unsafe { libc::getrlimit(resource, &mut limit) } != 0 {
        return Err(Refusal::Failed(format!("{name}: {}", io::Error::last_os_error())));
    }
    Ok(limit.rlim_cur)
}

// `kern.tty.ptmx_max` is an `int`: a kernel answering it in another width is refused rather than read
// as half a number.
fn ptmx_max() -> Result<u64, Refusal> {
    let name = CString::new("kern.tty.ptmx_max").map_err(|error| Refusal::Failed(error.to_string()))?;
    let mut value: libc::c_int = 0;
    let mut size = size_of::<libc::c_int>();
    let read = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut libc::c_int).cast::<libc::c_void>(),
            &mut size,
            ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return Err(Refusal::Failed(format!("kern.tty.ptmx_max: {}", io::Error::last_os_error())));
    }
    if size != size_of::<libc::c_int>() || value < 0 {
        return Err(Refusal::Failed(format!("kern.tty.ptmx_max answered {size} bytes holding {value}")));
    }
    Ok(value as u64)
}

// The three figures in the order the ABI writes them: descriptors, processes, ptys.
pub fn platform() -> Result<[u64; 3], Refusal> {
    Ok([
        soft(libc::RLIMIT_NOFILE, "RLIMIT_NOFILE")?,
        soft(libc::RLIMIT_NPROC, "RLIMIT_NPROC")?,
        ptmx_max()?,
    ])
}

#[cfg(test)]
mod tests {
    use super::platform;

    // The contract: this kernel answers all three, and each is a figure a count can be derived from —
    // a process runs under at least one descriptor and one process, and a machine that admits ptys
    // names how many. A reading that refused would answer no ceiling at all.
    #[test]
    fn the_platform_answers_three_usable_limits() {
        let read = platform().unwrap_or_else(|_| panic!("this kernel refused its own limits"));
        let [files, processes, terminals] = read;
        assert!(files > 0, "RLIMIT_NOFILE soft answered {files}");
        assert!(processes > 0, "RLIMIT_NPROC soft answered {processes}");
        assert!(terminals > 0, "kern.tty.ptmx_max answered {terminals}");
    }
}
