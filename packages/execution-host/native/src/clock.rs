// The kernel's uptime clock, which every process of this machine reads against the same origin and
// which stands still while the machine sleeps: CLOCK_UPTIME_RAW. A deadline written by one process
// and read by the next is a number on this clock, so it means the same instant to both.

pub fn uptime_nanos() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut now) } != 0 {
        return 0;
    }
    (now.tv_sec as u64) * 1_000_000_000 + now.tv_nsec as u64
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
