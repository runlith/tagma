use std::io;
use std::panic::{AssertUnwindSafe, catch_unwind};

pub const ROW: usize = 14;

#[cfg(target_os = "macos")]
#[path = "macos/gpu.rs"]
mod gpu;

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_usage_gpu(values: *mut u64, capacity: i32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        if capacity < 0 || (capacity > 0 && values.is_null()) { return Err(libc::EINVAL); }
        let rows = gpu::all()?;
        for (at, row) in rows.iter().take(capacity as usize).enumerate() {
            unsafe { std::ptr::copy_nonoverlapping(row.as_ptr(), values.add(at * gpu::ROW), gpu::ROW) };
        }
        Ok(rows.len() as i32)
    })) {
        Ok(Ok(count)) => count,
        Ok(Err(code)) => -code,
        Err(_) => -libc::EIO,
    }
}

fn errno() -> i32 {
    io::Error::last_os_error().raw_os_error().filter(|&code| code > 0).unwrap_or(5)
}

fn answer(action: impl FnOnce() -> Result<(), i32>) -> i32 {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(Ok(())) => 0,
        Ok(Err(code)) => code,
        Err(_) => -1,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_usage_machine(values: *mut u64) -> i32 {
    answer(|| {
        if values.is_null() { return Err(22); }
        let read = platform::machine()?;
        unsafe { std::ptr::copy_nonoverlapping(read.as_ptr(), values, read.len()) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn execution_usage_all(values: *mut u64, capacity: i32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        if capacity < 0 || (capacity > 0 && values.is_null()) { return Err(22); }
        let rows = platform::all()?;
        let written = rows.len().min(capacity as usize);
        for (at, row) in rows.iter().take(written).enumerate() {
            unsafe { std::ptr::copy_nonoverlapping(row.as_ptr(), values.add(at * ROW), ROW) };
        }
        Ok(rows.len() as i32)
    })) {
        Ok(Ok(count)) => count,
        Ok(Err(code)) => -code,
        Err(_) => -1,
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{ROW, errno};
    use std::mem::{size_of, zeroed};
    use std::sync::OnceLock;

    unsafe extern "C" {
        fn mach_port_deallocate(task: libc::mach_port_t, name: libc::mach_port_t) -> i32;
    }

    type Responsible = unsafe extern "C" fn(i32) -> i32;

    fn responsible(pid: i32) -> i32 {
        static FIND: OnceLock<Option<Responsible>> = OnceLock::new();
        let find = FIND.get_or_init(|| {
            let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"responsibility_get_pid_responsible_for_pid".as_ptr()) };
            (!symbol.is_null()).then(|| unsafe { std::mem::transmute::<*mut libc::c_void, Responsible>(symbol) })
        });
        find.map(|find| unsafe { find(pid) }).filter(|&found| found > 0).unwrap_or(pid)
    }

    fn counters(pid: i32) -> Result<[u64; 5], i32> {
        let mut usage: libc::rusage_info_v2 = unsafe { zeroed() };
        if unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, (&mut usage as *mut libc::rusage_info_v2).cast()) } != 0 {
            return Err(errno());
        }
        Ok([
            ticks_to_micros(usage.ri_user_time + usage.ri_system_time)?,
            ticks_to_micros(usage.ri_child_user_time + usage.ri_child_system_time)?,
            usage.ri_resident_size,
            usage.ri_phys_footprint,
            1,
        ])
    }

    pub fn all() -> Result<Vec<[u64; ROW]>, i32> {
        let mut rows = Vec::with_capacity(1024);
        crate::process::each(|pid, listed| {
            let mut row = [0u64; ROW];
            row[0] = pid as u64;
            row[2] = listed.parent as u64;
            row[3] = listed.group as u64;
            row[4] = listed.seconds;
            row[5] = listed.micros;
            row[6] = u64::from(listed.zombie);
            row[13] = responsible(pid) as u64;
            match counters(pid) {
                Ok(read) => match crate::process::identity(pid) {
                    Ok(after) if (after.seconds, after.micros) == (listed.seconds, listed.micros) => row[7..12].copy_from_slice(&read),
                    Ok(_) => row[1] = libc::ESRCH as u64,
                    Err(code) => row[1] = code as u64,
                },
                Err(code) => row[1] = code as u64,
            }
            rows.push(row);
        })
        .map_err(|_| libc::EIO)?;
        Ok(rows)
    }

    fn ticks_to_micros(ticks: u64) -> Result<u64, i32> {
        static BASE: OnceLock<Option<(u32, u32)>> = OnceLock::new();
        let (numer, denom) = BASE.get_or_init(|| {
            let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
            (unsafe { libc::mach_timebase_info(&mut info) } == 0 && info.denom != 0).then_some((info.numer, info.denom))
        }).ok_or(libc::EIO)?;
        Ok((ticks as u128 * numer as u128 / denom as u128 / 1_000) as u64)
    }

    pub fn machine() -> Result<[u64; 12], i32> {
        let host = unsafe { libc::mach_host_self() };
        let mut count = 0;
        let mut info = std::ptr::null_mut();
        let mut length = 0;
        let status = unsafe { libc::host_processor_info(host, libc::PROCESSOR_CPU_LOAD_INFO, &mut count, &mut info, &mut length) };
        let mut vm: libc::vm_statistics64 = unsafe { zeroed() };
        let mut vm_count = libc::HOST_VM_INFO64_COUNT;
        let vm_status = unsafe { libc::host_statistics64(host, libc::HOST_VM_INFO64, (&mut vm as *mut libc::vm_statistics64).cast(), &mut vm_count) };
        let released = unsafe { mach_port_deallocate(libc::mach_task_self(), host) };
        if status != 0 { return Err(status); }
        let ticks = unsafe { std::slice::from_raw_parts(info, length as usize) };
        let mut busy = 0u64;
        let mut total = 0u64;
        for cpu in ticks.chunks_exact(4) {
            total += cpu.iter().map(|&tick| tick as u32 as u64).sum::<u64>();
            busy += cpu[0] as u32 as u64 + cpu[1] as u32 as u64 + cpu[3] as u32 as u64;
        }
        let freed = unsafe { libc::vm_deallocate(libc::mach_task_self(), info as libc::vm_address_t, length as usize * size_of::<i32>()) };
        if released != 0 { return Err(released); }
        if freed != 0 { return Err(freed); }
        let mut memory = 0u64;
        let mut size = size_of::<u64>();
        let mib = c"hw.memsize";
        if unsafe { libc::sysctlbyname(mib.as_ptr(), (&mut memory as *mut u64).cast(), &mut size, std::ptr::null_mut(), 0) } != 0 {
            return Err(errno());
        }
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        let memory_errno = if vm_status != 0 { vm_status } else if page <= 0 { errno() } else if vm_count < libc::HOST_VM_INFO64_COUNT { libc::EBADMSG } else { 0 };
        let available = if memory_errno == 0 { ((vm.free_count as u64 + vm.inactive_count as u64 + vm.purgeable_count as u64) * page as u64).min(memory) } else { 0 };
        let mut pressure = 0u32;
        let mut size = size_of::<u32>();
        let read = unsafe { libc::sysctlbyname(c"kern.memorystatus_vm_pressure_level".as_ptr(), (&mut pressure as *mut u32).cast(), &mut size, std::ptr::null_mut(), 0) };
        let pressure_errno = if read != 0 { errno() } else if ![1, 2, 4].contains(&pressure) { libc::EBADMSG } else { 0 };
        let level = if pressure_errno != 0 { 0 } else if pressure == 4 { 3 } else { pressure as u64 };
        Ok([busy, total, count as u64, memory, memory - available, available, level, pressure as u64, memory_errno as u64, pressure_errno as u64, 1, 1])
    }
}

#[cfg(any(target_os = "linux", test))]
mod procfs {
    pub struct Stat {
        pub parent: u64,
        pub group: u64,
        pub started: u64,
        pub zombie: bool,
        pub own: u64,
        pub children: u64,
        pub resident: u64,
    }

    pub fn stat(text: &str, ticks: u64, page: u64) -> Result<Stat, i32> {
        let (_, fields) = text.rsplit_once(')').ok_or(74)?;
        let fields: Vec<&str> = fields.split_whitespace().collect();
        let value = |at: usize| fields.get(at).ok_or(74)?.parse::<u64>().map_err(|_| 74);
        Ok(Stat {
            parent: value(1)?,
            group: value(2)?,
            started: value(19)?,
            zombie: fields.first() == Some(&"Z"),
            own: (value(11)? + value(12)?) * 1_000_000 / ticks,
            children: (value(13)? + value(14)?) * 1_000_000 / ticks,
            resident: value(21)? * page,
        })
    }

    pub fn pss(text: &str) -> Result<u64, i32> {
        let row = text.lines().find_map(|line| line.strip_prefix("Pss:")).ok_or(74)?;
        let mut fields = row.split_whitespace();
        let bytes = fields.next().ok_or(74)?.parse::<u64>().map_err(|_| 74)?;
        if fields.next() != Some("kB") { return Err(74); }
        bytes.checked_mul(1024).ok_or(74)
    }

    pub fn memory(text: &str, field: &str) -> Result<u64, i32> {
        let row = text.lines().find_map(|line| line.strip_prefix(field)).ok_or(74)?;
        let mut fields = row.split_whitespace();
        let value = fields.next().ok_or(74)?.parse::<u64>().map_err(|_| 74)?;
        if fields.next() != Some("kB") { return Err(74); }
        value.checked_mul(1024).ok_or(74)
    }

    pub fn pressure(text: &str) -> Result<(u64, u64), i32> {
        let read = |name: &str| -> Result<f64, i32> {
            let line = text.lines().find_map(|line| line.strip_prefix(name)).ok_or(74)?;
            let value = line.split_whitespace().find_map(|part| part.strip_prefix("avg10=")).ok_or(74)?.parse::<f64>().map_err(|_| 74)?;
            if !(0.0..=100.0).contains(&value) { return Err(74); }
            Ok(value)
        };
        let some = read("some ")?;
        let full = read("full ")?;
        Ok((if full > 0.0 { 3 } else if some > 0.0 { 2 } else { 1 }, (some * 1000.0).round() as u64))
    }

    pub fn machine(text: &str) -> Result<(u64, u64, u64), i32> {
        let mut lines = text.lines();
        let first = lines.next().ok_or(74)?;
        let mut fields = first.split_whitespace();
        if fields.next() != Some("cpu") { return Err(74); }
        let values = fields.take(8).map(|field| field.parse::<u64>().map_err(|_| 74)).collect::<Result<Vec<_>, _>>()?;
        if values.len() < 4 { return Err(74); }
        let total = values.iter().sum::<u64>();
        let idle = values[3] + values.get(4).copied().unwrap_or(0);
        let cores = lines.filter(|line| line.starts_with("cpu") && line.as_bytes().get(3).is_some_and(u8::is_ascii_digit)).count() as u64;
        if cores == 0 { return Err(74); }
        Ok((total - idle, total, cores))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{ROW, errno, procfs};
    use std::fs;
    use std::sync::OnceLock;

    fn clock() -> Result<(u64, u64), i32> {
        static CLOCK: OnceLock<(u64, u64)> = OnceLock::new();
        if let Some(clock) = CLOCK.get() { return Ok(*clock); }
        let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if ticks <= 0 || page <= 0 { return Err(errno()); }
        let read = (ticks as u64, page as u64);
        let _ = CLOCK.set(read);
        Ok(read)
    }

    fn process(pid: i32, row: &mut [u64; ROW]) -> Result<(), i32> {
        let (ticks, page) = clock()?;
        let path = format!("/proc/{pid}/stat");
        let read = procfs::stat(&fs::read_to_string(&path).map_err(|_| errno())?, ticks, page)?;
        row[2] = read.parent;
        row[3] = read.group;
        row[4] = read.started;
        row[6] = u64::from(read.zombie);
        row[7] = read.own;
        row[8] = read.children;
        row[9] = read.resident;
        row[11] = 2;
        match fs::read_to_string(format!("/proc/{pid}/smaps_rollup")) {
            Ok(text) => match procfs::pss(&text) {
                Ok(bytes) => row[10] = bytes,
                Err(code) => { row[11] = 4; row[12] = code as u64; }
            },
            Err(error) => { row[11] = 4; row[12] = error.raw_os_error().unwrap_or(5) as u64; }
        }
        let after = procfs::stat(&fs::read_to_string(path).map_err(|_| errno())?, ticks, page)?;
        if after.started != read.started { return Err(libc::ESRCH); }
        Ok(())
    }

    pub fn all() -> Result<Vec<[u64; ROW]>, i32> {
        let entries = fs::read_dir("/proc").map_err(|_| errno())?;
        let mut rows = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| errno())?;
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<i32>().ok()).filter(|&pid| pid > 0) else { continue };
            let mut row = [0u64; ROW];
            row[0] = pid as u64;
            row[13] = pid as u64;
            if let Err(code) = process(pid, &mut row) {
                if code == libc::ESRCH || code == libc::ENOENT { continue; }
                row[1] = code as u64;
            }
            rows.push(row);
        }
        Ok(rows)
    }

    pub fn machine() -> Result<[u64; 12], i32> {
        let (busy, total, cores) = procfs::machine(&fs::read_to_string("/proc/stat").map_err(|_| errno())?)?;
        let memory = fs::read_to_string("/proc/meminfo").map_err(|_| errno())?;
        let physical = procfs::memory(&memory, "MemTotal:")?;
        let (available, memory_errno) = match procfs::memory(&memory, "MemAvailable:") {
            Ok(value) => (value.min(physical), 0), Err(code) => (0, code as u64),
        };
        let (level, value, pressure_errno) = match fs::read_to_string("/proc/pressure/memory") {
            Ok(text) => match procfs::pressure(&text) { Ok((level, value)) => (level, value, 0), Err(code) => (0, 0, code as u64) },
            Err(error) => (0, 0, error.raw_os_error().unwrap_or(5) as u64),
        };
        Ok([busy, total, cores, physical, physical - available, available, level, value, memory_errno, pressure_errno, 2, 1])
    }
}

#[cfg(any(target_os = "windows", test))]
mod windows {
    pub fn process_times(created: u64, kernel: u64, user: u64) -> (u64, u64) {
        (created, (kernel + user) / 10)
    }

    pub fn system_times(idle: u64, kernel: u64, user: u64) -> Result<(u64, u64), i32> {
        let total = kernel.checked_add(user).ok_or(74)?;
        Ok((total.checked_sub(idle).ok_or(74)?, total))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{ROW, errno, windows};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    type Handle = *mut c_void;
    #[repr(C)] struct Time { low: u32, high: u32 }
    impl Time { fn value(&self) -> u64 { self.low as u64 | ((self.high as u64) << 32) } }
    #[repr(C)] struct Memory { size: u32, faults: u32, values: [usize; 9] }
    #[repr(C)] struct MachineMemory { size: u32, load: u32, values: [u64; 7] }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetProcessTimes(handle: Handle, created: *mut Time, exited: *mut Time, kernel: *mut Time, user: *mut Time) -> i32;
        fn GetSystemTimes(idle: *mut Time, kernel: *mut Time, user: *mut Time) -> i32;
        fn GlobalMemoryStatusEx(memory: *mut MachineMemory) -> i32;
    }
    #[link(name = "psapi")]
    unsafe extern "system" {
        fn GetProcessMemoryInfo(handle: Handle, memory: *mut Memory, size: u32) -> i32;
        fn EnumProcesses(pids: *mut i32, size: u32, needed: *mut u32) -> i32;
    }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQueryInformationProcess(handle: Handle, class: u32, info: *mut c_void, size: u32, returned: *mut u32) -> i32;
    }
    struct Opened(Handle);
    impl Drop for Opened { fn drop(&mut self) { unsafe { CloseHandle(self.0) }; } }

    fn process(pid: i32, row: &mut [u64; ROW]) -> Result<(), i32> {
        let handle = Opened(unsafe { OpenProcess(0x0400 | 0x0010, 0, pid as u32) });
        if handle.0.is_null() { return Err(errno()); }
        let (mut created, mut exited, mut kernel, mut user): (Time, Time, Time, Time) = unsafe { zeroed() };
        if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) } == 0 { return Err(errno()); }
        let mut memory: Memory = unsafe { zeroed() };
        memory.size = size_of::<Memory>() as u32;
        if unsafe { GetProcessMemoryInfo(handle.0, &mut memory, memory.size) } == 0 { return Err(errno()); }
        let mut info = [0usize; 6];
        let mut returned = 0u32;
        let status = unsafe { NtQueryInformationProcess(handle.0, 0, info.as_mut_ptr().cast(), size_of::<[usize; 6]>() as u32, &mut returned) };
        if status != 0 { return Err(status); }
        let (started, cpu) = windows::process_times(created.value(), kernel.value(), user.value());
        row[2] = info[5] as u64;
        row[4] = started;
        row[7] = cpu;
        row[9] = memory.values[1] as u64;
        row[10] = memory.values[8] as u64;
        row[11] = 3;
        Ok(())
    }

    fn pids() -> Result<Vec<i32>, i32> {
        let mut pids = vec![0i32; 1024];
        loop {
            let mut needed = 0u32;
            let size = (pids.len() * size_of::<i32>()) as u32;
            if unsafe { EnumProcesses(pids.as_mut_ptr(), size, &mut needed) } == 0 { return Err(errno()); }
            if needed < size { pids.truncate(needed as usize / size_of::<i32>()); pids.retain(|&pid| pid > 0); return Ok(pids); }
            pids.resize(pids.len() * 2, 0);
        }
    }

    pub fn all() -> Result<Vec<[u64; ROW]>, i32> {
        Ok(pids()?
            .into_iter()
            .map(|pid| {
                let mut row = [0u64; ROW];
                row[0] = pid as u64;
                row[13] = pid as u64;
                if let Err(code) = process(pid, &mut row) { row[1] = code as u64; }
                row
            })
            .collect())
    }

    pub fn machine() -> Result<[u64; 12], i32> {
        let (mut idle, mut kernel, mut user): (Time, Time, Time) = unsafe { zeroed() };
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 { return Err(errno()); }
        let mut memory: MachineMemory = unsafe { zeroed() };
        memory.size = size_of::<MachineMemory>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut memory) } == 0 { return Err(errno()); }
        let (busy, total) = windows::system_times(idle.value(), kernel.value(), user.value())?;
        let cores = std::thread::available_parallelism().map_err(|_| errno())?.get() as u64;
        let physical = memory.values[0];
        let available = memory.values[1].min(physical);
        let level = if memory.load >= 90 { 3 } else if memory.load >= 80 { 2 } else { 1 };
        Ok([busy, total, cores, physical, physical - available, available, level, memory.load as u64, 0, 0, 3, 1])
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod platform {
    pub fn machine() -> Result<[u64; 12], i32> { Err(95) }
    pub fn all() -> Result<Vec<[u64; super::ROW]>, i32> { Err(95) }
}

#[cfg(test)]
mod tests {
    use super::{procfs, windows};
    #[test]
    fn proc_stat_handles_spaces_and_parentheses_in_the_program_and_reads_reaped_children() {
        let row = "12 (a program) (worker)) Z 8 12 12 0 0 0 0 0 0 0 125 25 300 100 0 0 1 0 50 8192 3 0";
        let read = procfs::stat(row, 100, 4096).unwrap();
        assert_eq!((read.parent, read.group, read.started, read.zombie), (8, 12, 50, true));
        assert_eq!((read.own, read.children, read.resident), (1_500_000, 4_000_000, 12_288));
        assert!(procfs::stat("broken", 100, 4096).is_err());
    }
    #[test]
    fn pss_reads_only_the_proportional_mapping_account() {
        assert_eq!(procfs::pss("Rss: 900 kB\nPss: 240 kB\nPss_Anon: 200 kB"), Ok(245_760));
        assert_eq!(procfs::pss("Pss: 240 bytes"), Err(74));
    }
    #[test]
    fn machine_ticks_exclude_idle_iowait_and_duplicate_guest_time() {
        assert_eq!(procfs::machine("cpu 10 20 30 40 50 60 70 80 90 100\ncpu0 1\ncpu1 1\nbtime 1"), Ok((270, 360, 2)));
    }
    #[test]
    fn linux_memory_uses_available_and_pressure_uses_kernel_stalls() {
        let memory = "MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\n";
        assert_eq!(procfs::memory(memory, "MemTotal:"), Ok(1_024_000));
        assert_eq!(procfs::memory(memory, "MemAvailable:"), Ok(409_600));
        assert_eq!(procfs::pressure("some avg10=1.20 avg60=0 total=2\nfull avg10=0.00 avg60=0 total=0"), Ok((2, 1200)));
        assert_eq!(procfs::pressure("some avg10=1.20 avg60=0 total=2\nfull avg10=0.10 avg60=0 total=1"), Ok((3, 1200)));
        assert_eq!(procfs::pressure("some avg10=NaN\nfull avg10=0"), Err(74));
    }
    #[test]
    fn windows_counters_keep_epoch_and_idle_distinctions() {
        assert_eq!(windows::process_times(116_444_736_010_000_000, 100, 200), (116_444_736_010_000_000, 30));
        assert_eq!(windows::system_times(40, 80, 20), Ok((60, 100)));
        assert_eq!(windows::system_times(120, 80, 20), Err(74));
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_reaped_child_carries_its_cpu_into_the_parent_counter() {
        use std::io::{BufRead, BufReader, Write};
        use std::process::Stdio;
        let mut parent = std::process::Command::new("/bin/sh")
            .args(["-c", "/usr/bin/awk 'BEGIN { for (i=0; i<2000000; i++) value += i % 97; print value }' >/dev/null; printf 'reaped\\n'; read release"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = parent.id() as u64;
        let mut ready = String::new();
        BufReader::new(parent.stdout.take().unwrap()).read_line(&mut ready).unwrap();
        let rows = super::platform::all().unwrap();
        parent.stdin.as_mut().unwrap().write_all(b"done\n").unwrap();
        assert!(parent.wait().unwrap().success());
        assert_eq!(ready, "reaped\n");
        let row = rows.iter().find(|row| row[0] == pid).unwrap();
        assert_eq!(row[1], 0);
        assert!(row[8] > 0, "the reaped child's CPU is missing");
        assert!(row[7] < row[8]);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn the_whole_table_reads_this_process_and_another_users_identity() {
        let pid = std::process::id() as u64;
        let rows = super::platform::all().unwrap();
        let own = rows.iter().find(|row| row[0] == pid).unwrap();
        assert_eq!(own[1], 0);
        assert!(own[9] > 0 && own[10] > 0);
        assert_eq!(own[11], 1);
        let launchd = rows.iter().find(|row| row[0] == 1).unwrap();
        assert!(launchd[4] > 0);
        let machine = super::platform::machine().unwrap();
        assert!(machine[0] <= machine[1]);
        assert!(machine[2] > 0);
        assert_eq!(machine[4] + machine[5], machine[3]);
        assert_eq!(machine[11], 1);
    }
}
