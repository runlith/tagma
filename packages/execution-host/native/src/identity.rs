use std::ffi::c_char;

const IDENTITY: &str = concat!(
    "crate=",
    env!("CARGO_PKG_NAME"),
    "\nversion=",
    env!("CARGO_PKG_VERSION"),
    "\ntarget=",
    env!("EXECUTION_PLATFORM_TARGET"),
    "\nprofile=",
    env!("EXECUTION_PLATFORM_PROFILE"),
    "\nrustc=",
    env!("EXECUTION_PLATFORM_RUSTC"),
    "\nsource=",
    env!("EXECUTION_PLATFORM_SOURCE"),
    "\nclosure=",
    env!("EXECUTION_PLATFORM_CLOSURE"),
    "\n\0"
);

pub fn identity() -> *const c_char {
    IDENTITY.as_ptr().cast()
}
