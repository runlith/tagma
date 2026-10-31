use crate::process;
use std::collections::{HashMap, HashSet};
use std::ffi::{c_char, c_void};
use std::ptr;

type Cf = *const c_void;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> Cf;
    fn IOServiceGetMatchingServices(port: u32, matching: Cf, iterator: *mut u32) -> i32;
    fn IORegistryEntryCreateIterator(entry: u32, plane: *const c_char, options: u32, iterator: *mut u32) -> i32;
    fn IOIteratorNext(iterator: u32) -> u32;
    fn IOIteratorIsValid(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
    fn IOObjectConformsTo(object: u32, class: *const c_char) -> u32;
    fn IORegistryEntryGetRegistryEntryID(entry: u32, id: *mut u64) -> i32;
    fn IORegistryEntryCreateCFProperties(entry: u32, properties: *mut Cf, allocator: Cf, options: u32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: Cf);
    fn CFGetTypeID(value: Cf) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
    fn CFStringGetCString(value: Cf, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
    fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
    fn CFArrayGetCount(array: Cf) -> isize;
    fn CFArrayGetValueAtIndex(array: Cf, index: isize) -> Cf;
    fn CFNumberGetValue(number: Cf, kind: isize, value: *mut c_void) -> u8;
}

fn checked(status: i32) -> Result<(), i32> {
    match status as u32 {
        0 => Ok(()),
        0xe00002c1 | 0xe00002e2 => Err(libc::EACCES),
        0xe00002c7 => Err(libc::ENOTSUP),
        _ => Err(libc::EIO),
    }
}

struct Object(u32);

impl Drop for Object {
    fn drop(&mut self) {
        unsafe { IOObjectRelease(self.0); }
    }
}

struct Owned(Cf);

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() { unsafe { CFRelease(self.0); } }
    }
}

impl Owned {
    fn key(text: &std::ffi::CStr) -> Result<Self, i32> {
        let value = unsafe { CFStringCreateWithCString(ptr::null(), text.as_ptr(), 0x08000100) };
        if value.is_null() { Err(libc::ENOMEM) } else { Ok(Self(value)) }
    }
}

fn field(dictionary: Cf, key: &Owned) -> Result<Cf, i32> {
    if dictionary.is_null() || unsafe { CFGetTypeID(dictionary) != CFDictionaryGetTypeID() } {
        return Err(libc::EBADMSG);
    }
    let value = unsafe { CFDictionaryGetValue(dictionary, key.0) };
    if value.is_null() { Err(libc::ENODATA) } else { Ok(value) }
}

fn creator(value: Cf) -> Result<i32, i32> {
    if unsafe { CFGetTypeID(value) != CFStringGetTypeID() } { return Err(libc::EBADMSG); }
    let mut bytes = [0u8; 256];
    if unsafe { CFStringGetCString(value, bytes.as_mut_ptr().cast(), bytes.len() as isize, 0x08000100) } == 0 {
        return Err(libc::EBADMSG);
    }
    let text = std::str::from_utf8(&bytes[..bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len())]).map_err(|_| libc::EBADMSG)?;
    let pid = text.strip_prefix("pid ").and_then(|rest| rest.split_once(',')).ok_or(libc::EBADMSG)?.0;
    pid.parse::<i32>().ok().filter(|&pid| pid > 0).ok_or(libc::EBADMSG)
}

fn accumulated(properties: Cf, usage: &Owned, time: &Owned) -> Result<u64, i32> {
    let array = field(properties, usage)?;
    if unsafe { CFGetTypeID(array) != CFArrayGetTypeID() } { return Err(libc::EBADMSG); }
    let mut total = 0u64;
    for index in 0..unsafe { CFArrayGetCount(array) } {
        let queue = unsafe { CFArrayGetValueAtIndex(array, index) };
        let counter = field(queue, time)?;
        if unsafe { CFGetTypeID(counter) != CFNumberGetTypeID() } { return Err(libc::EBADMSG); }
        let mut nanos = 0i64;
        if unsafe { CFNumberGetValue(counter, 4, (&mut nanos as *mut i64).cast()) } == 0 || nanos < 0 {
            return Err(libc::EBADMSG);
        }
        total = total.checked_add(nanos as u64).ok_or(libc::EOVERFLOW)?;
    }
    Ok(total)
}

pub const ROW: usize = 6;

pub fn all() -> Result<Vec<[u64; ROW]>, i32> {
    let mut before = HashMap::new();
    process::each(|pid, identity| { before.insert(pid, (identity.seconds, identity.micros)); }).map_err(|_| libc::EIO)?;
    let matching = unsafe { IOServiceMatching(c"IOAccelerator".as_ptr()) };
    if matching.is_null() { return Err(libc::ENOMEM); }
    let mut accelerators = 0;
    let status = unsafe { IOServiceGetMatchingServices(0, matching, &mut accelerators) };
    checked(status)?;
    if accelerators == 0 { return Err(libc::ENOTSUP); }
    let accelerators = Object(accelerators);
    let creator_key = Owned::key(c"IOUserClientCreator")?;
    let usage_key = Owned::key(c"AppUsage")?;
    let time_key = Owned::key(c"accumulatedGPUTime")?;
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut supported = false;
    loop {
        let accelerator = unsafe { IOIteratorNext(accelerators.0) };
        if accelerator == 0 { break; }
        let accelerator = Object(accelerator);
        let mut clients = 0;
        let status = unsafe { IORegistryEntryCreateIterator(accelerator.0, c"IOService".as_ptr(), 1, &mut clients) };
        checked(status)?;
        let clients = Object(clients);
        loop {
            let client = unsafe { IOIteratorNext(clients.0) };
            if client == 0 { break; }
            let client = Object(client);
            if unsafe { IOObjectConformsTo(client.0, c"AGXDeviceUserClient".as_ptr()) } == 0 { continue; }
            supported = true;
            let mut id = 0;
            let status = unsafe { IORegistryEntryGetRegistryEntryID(client.0, &mut id) };
            checked(status)?;
            if !seen.insert(id) { continue; }
            let mut properties = ptr::null();
            let status = unsafe { IORegistryEntryCreateCFProperties(client.0, &mut properties, ptr::null(), 0) };
            let properties = Owned(properties);
            checked(status)?;
            let pid = creator(field(properties.0, &creator_key)?)?;
            let Some(&(seconds, micros)) = before.get(&pid) else { continue; };
            let counter = accumulated(properties.0, &usage_key, &time_key);
            let identity = process::identity(pid);
            let counter = match identity {
                Ok(after) if (after.seconds, after.micros) == (seconds, micros) => counter,
                _ => Err(libc::ESRCH),
            };
            let (nanos, errno) = match counter { Ok(nanos) => (nanos, 0), Err(errno) => (0, errno as u64) };
            rows.push([pid as u64, seconds, micros, id, nanos, errno]);
        }
        if unsafe { IOIteratorIsValid(clients.0) } == 0 { return Err(libc::EAGAIN); }
    }
    if unsafe { IOIteratorIsValid(accelerators.0) } == 0 { return Err(libc::EAGAIN); }
    if supported { Ok(rows) } else { Err(libc::ENOTSUP) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_arch = "aarch64")]
    #[test]
    fn metal_client_counters_carry_the_current_kernel_birth() {
        #[link(name = "Metal", kind = "framework")]
        unsafe extern "C" { fn MTLCreateSystemDefaultDevice() -> *mut c_void; }
        #[link(name = "objc")]
        unsafe extern "C" { fn objc_release(object: *mut c_void); }
        let device = unsafe { MTLCreateSystemDefaultDevice() };
        assert!(!device.is_null());
        let read = all();
        unsafe { objc_release(device); }
        let rows = read.unwrap();
        let pid = std::process::id();
        let identity = process::identity(pid as i32).unwrap();
        let own: Vec<_> = rows.iter().filter(|row| row[0] == pid as u64).collect();
        assert!(!own.is_empty(), "the Metal device must expose its AGX client");
        for row in own {
            assert_eq!((row[1], row[2]), (identity.seconds, identity.micros));
            assert_ne!(row[3], 0);
            assert_eq!(row[5], 0);
        }
    }
}
