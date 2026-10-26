#[cfg(not(target_os = "macos"))]
compile_error!("execution-holder has a platform module for macOS alone");

mod control;
mod frames;
mod handover;
mod holder;
#[cfg(target_os = "macos")]
mod macos;
mod platform;
mod table;
#[cfg(test)]
mod testing;

#[cfg(target_os = "macos")]
type Native = macos::Macos;

fn main() {
    std::process::exit(match holder::run::<Native>() {
        Ok(code) => code,
        Err(message) => {
            <Native as platform::Platform>::diagnostic(format_args!("execution-holder: {message}"));
            1
        }
    });
}
