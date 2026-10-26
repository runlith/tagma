#[cfg(unix)]
mod unix {
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    pub struct Wake {
        read: OwnedFd,
        write: OwnedFd,
    }

    impl Wake {
        pub fn new() -> io::Result<Wake> {
            let mut ends = [0i32; 2];
            if unsafe { libc::pipe(ends.as_mut_ptr()) } < 0 {
                return Err(io::Error::last_os_error());
            }
            let wake = unsafe { Wake { read: OwnedFd::from_raw_fd(ends[0]), write: OwnedFd::from_raw_fd(ends[1]) } };
            for fd in ends {
                if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            let flags = unsafe { libc::fcntl(ends[1], libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(ends[1], libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(wake)
        }

        pub fn handle(&self) -> i32 {
            self.read.as_raw_fd()
        }

        pub fn signal(&self) {
            let byte = 1u8;
            unsafe { libc::write(self.write.as_raw_fd(), (&byte as *const u8).cast(), 1) };
        }
    }
}

#[cfg(unix)]
pub use unix::Wake;

#[cfg(windows)]
mod windows {
    use std::io;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::WriteFile;
    use windows_sys::Win32::System::Pipes::CreatePipe;

    pub struct Wake {
        read: HANDLE,
        write: HANDLE,
    }

    unsafe impl Send for Wake {}
    unsafe impl Sync for Wake {}

    unsafe extern "C" {
        fn _open_osfhandle(handle: isize, flags: i32) -> i32;
    }

    impl Wake {
        pub fn new() -> io::Result<Wake> {
            let mut read: HANDLE = std::ptr::null_mut();
            let mut write: HANDLE = std::ptr::null_mut();
            if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Wake { read, write })
        }

        pub fn handle(&self) -> i32 {
            unsafe { _open_osfhandle(self.read as isize, 0) }
        }

        pub fn signal(&self) {
            let byte = 1u8;
            let mut written = 0u32;
            unsafe { WriteFile(self.write, &byte, 1, &mut written, std::ptr::null_mut()) };
        }
    }

    impl Drop for Wake {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.read);
                CloseHandle(self.write);
            }
        }
    }
}

#[cfg(windows)]
pub use windows::Wake;
