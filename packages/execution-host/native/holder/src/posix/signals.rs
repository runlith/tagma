use std::ffi::c_int;

const SIGNALS: &[(&str, c_int)] = &[
    ("SIGHUP", libc::SIGHUP),
    ("SIGINT", libc::SIGINT),
    ("SIGQUIT", libc::SIGQUIT),
    ("SIGILL", libc::SIGILL),
    ("SIGTRAP", libc::SIGTRAP),
    ("SIGABRT", libc::SIGABRT),
    #[cfg(target_os = "macos")]
    ("SIGEMT", libc::SIGEMT),
    ("SIGBUS", libc::SIGBUS),
    ("SIGFPE", libc::SIGFPE),
    ("SIGKILL", libc::SIGKILL),
    ("SIGUSR1", libc::SIGUSR1),
    ("SIGSEGV", libc::SIGSEGV),
    ("SIGUSR2", libc::SIGUSR2),
    ("SIGPIPE", libc::SIGPIPE),
    ("SIGALRM", libc::SIGALRM),
    ("SIGTERM", libc::SIGTERM),
    ("SIGCHLD", libc::SIGCHLD),
    ("SIGCONT", libc::SIGCONT),
    ("SIGSTOP", libc::SIGSTOP),
    ("SIGTSTP", libc::SIGTSTP),
    ("SIGTTIN", libc::SIGTTIN),
    ("SIGTTOU", libc::SIGTTOU),
    ("SIGURG", libc::SIGURG),
    ("SIGXCPU", libc::SIGXCPU),
    ("SIGXFSZ", libc::SIGXFSZ),
    ("SIGVTALRM", libc::SIGVTALRM),
    ("SIGPROF", libc::SIGPROF),
    ("SIGWINCH", libc::SIGWINCH),
    ("SIGIO", libc::SIGIO),
    #[cfg(target_os = "macos")]
    ("SIGINFO", libc::SIGINFO),
    #[cfg(target_os = "linux")]
    ("SIGPWR", libc::SIGPWR),
    #[cfg(target_os = "linux")]
    ("SIGSTKFLT", libc::SIGSTKFLT),
    ("SIGSYS", libc::SIGSYS),
];

pub fn number(name: &str) -> Option<c_int> {
    SIGNALS.iter().find(|(known, _)| *known == name).map(|(_, number)| *number)
}

pub fn name(number: c_int) -> String {
    SIGNALS.iter().find(|(_, known)| *known == number).map_or_else(|| format!("signal {number}"), |(name, _)| (*name).to_string())
}
