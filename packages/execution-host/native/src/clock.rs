#[cfg(target_os = "macos")]
const UPTIME: libc::clockid_t = libc::CLOCK_UPTIME_RAW;
#[cfg(target_os = "linux")]
const UPTIME: libc::clockid_t = libc::CLOCK_MONOTONIC;

pub fn uptime_nanos() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(UPTIME, &mut now) } != 0 {
        return 0;
    }
    (now.tv_sec as u64) * 1_000_000_000 + now.tv_nsec as u64
}

pub fn ticks() -> Result<u64, i32> {
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks <= 0 { Err(libc::EIO) } else { Ok(ticks as u64) }
}

pub fn micros(ticks: u64, frequency: u64) -> u64 { (ticks as u128 * 1_000_000 / frequency as u128) as u64 }

#[cfg(target_os = "linux")]
fn nanos(clock: libc::clockid_t) -> Result<i128, i32> {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(clock, &mut now) } != 0 {
        return Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
    }
    Ok(now.tv_sec as i128 * 1_000_000_000 + now.tv_nsec as i128)
}

#[cfg(target_os = "linux")]
pub fn boot_nanos() -> Result<u64, i32> {
    let wall = nanos(libc::CLOCK_REALTIME)?;
    let since = nanos(libc::CLOCK_BOOTTIME)?;
    u64::try_from(wall - since).map_err(|_| libc::EOVERFLOW)
}

#[cfg(test)]
mod tests {
    use super::uptime_nanos;

    #[test]
    fn the_uptime_clock_does_not_run_backward() {
        let first = uptime_nanos();
        let second = uptime_nanos();
        assert!(first > 0);
        assert!(second >= first);
    }
}
