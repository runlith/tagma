// What the KERNEL allows this process, which nothing above the crate can read for itself: the soft
// descriptor and process limits `getrlimit` answers, and the pty maximum the kernel holds as
// `kern.tty.ptmx_max`. Bun exposes neither call, which is why the reading is here.
//
// A reading that fails REFUSES. A ceiling derived from a figure nobody measured is a host admitting
// work its machine cannot carry, so each of the three answers or none of them does.

use crate::refusal::Refusal;
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::io;
#[cfg(target_os = "macos")]
use std::ptr;

// The SOFT limit, because that is what binds this process now: the hard limit is only what it could
// raise itself to, and a count derived from one it has not taken would overcommit until it did.
#[cfg(target_os = "macos")]
type Resource = libc::c_int;
#[cfg(target_os = "linux")]
type Resource = libc::__rlimit_resource_t;

fn soft(resource: Resource, name: &str) -> Result<u64, Refusal> {
    let mut limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    if unsafe { libc::getrlimit(resource, &mut limit) } != 0 {
        return Err(Refusal::Failed(format!("{name}: {}", io::Error::last_os_error())));
    }
    Ok(if limit.rlim_cur == libc::RLIM_INFINITY { u64::MAX } else { limit.rlim_cur })
}

// `kern.tty.ptmx_max` is an `int`: a kernel answering it in another width is refused rather than read
// as half a number.
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "linux")]
fn ptmx_max() -> Result<u64, Refusal> {
    let text = std::fs::read_to_string("/proc/sys/kernel/pty/max")?;
    text.trim().parse().map_err(|_| Refusal::Failed("kernel.pty.max did not answer a nonnegative integer".into()))
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
    #[test]
    fn the_limits_abi_preserves_finite_values_and_canonicalizes_infinity() {
        let mut read = [0; 3];
        assert_eq!(unsafe { crate::abi::execution_platform_limits(read.as_mut_ptr()) }, 0);
        for (index, resource) in [libc::RLIMIT_NOFILE, libc::RLIMIT_NPROC].into_iter().enumerate() {
            let mut limit = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
            assert_eq!(unsafe { libc::getrlimit(resource, &mut limit) }, 0);
            let expected = if limit.rlim_cur == libc::RLIM_INFINITY { u64::MAX } else { limit.rlim_cur };
            assert_eq!(read[index], expected);
        }
    }
}
