#[cfg(not(any(target_os = "macos", target_os = "linux")))]
compile_error!("execution-holder requires a native platform module");

mod control;
mod frames;
mod handover;
mod holder;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod posix;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
#[path = "../../src/linux/procfs.rs"]
mod procfs;
mod platform;
mod table;
#[cfg(test)]
mod testing;

#[cfg(target_os = "macos")]
type Native = posix::Posix<macos::Kernel>;
#[cfg(target_os = "linux")]
type Native = posix::Posix<linux::Kernel>;

fn main() {
    std::process::exit(match holder::run::<Native>() {
        Ok(code) => code,
        Err(message) => {
            <Native as platform::Platform>::diagnostic(format_args!("execution-holder: {message}"));
            1
        }
    });
}
