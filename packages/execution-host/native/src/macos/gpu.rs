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
#[path = "../../testing/metal.rs"]
mod metal;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_work_on_both_metal_queues_grows_the_witnessed_gpu_counter() {
        let work = metal::Work::open().unwrap();
        let before = match all() {
            Ok(rows) => rows,
            Err(code) => {
                assert!([libc::ENOTSUP, libc::EACCES].contains(&code), "unexpected registry failure: {code}");
                return;
            }
        };
        let pid = std::process::id() as u64;
        let own: Vec<_> = before.iter().filter(|row| row[0] == pid).collect();
        let identity = process::identity(pid as i32).unwrap();
        for row in &own {
            assert_eq!((row[1], row[2]), (identity.seconds, identity.micros));
            assert_ne!(row[3], 0);
        }
        let Some(work) = work else { return; };
        assert!(!own.is_empty(), "the Metal queues must expose an AGX client");
        for row in &own { assert_eq!(row[5], 0); }
        let total = |rows: &[[u64; ROW]]| rows.iter().filter(|row| row[0] == pid && row[5] == 0).map(|row| row[4]).sum::<u64>();
        let initial = total(&before);
        assert!(work.complete(0).unwrap() > 0.0);
        let first = total(&all().unwrap());
        assert!(first > initial, "the first queue's completed work was not measured: {initial} -> {first}");
        assert!(work.complete(1).unwrap() > 0.0);
        let final_rows = all().unwrap();
        let second = total(&final_rows);
        assert!(second > first, "the second queue's work was not added to the process total: {first} -> {second}");
        #[link(name = "IOKit", kind = "framework")]
        unsafe extern "C" {
            fn IORegistryCreateIterator(port: u32, plane: *const c_char, options: u32, iterator: *mut u32) -> i32;
            fn IORegistryEntryCreateCFProperty(entry: u32, key: Cf, allocator: Cf, options: u32) -> Cf;
        }
        let usage_key = Owned::key(c"AppUsage").unwrap();
        let time_key = Owned::key(c"accumulatedGPUTime").unwrap();
        let mut expected_clients: HashMap<_, _> = final_rows.iter().filter(|row| row[0] == pid && row[5] == 0).map(|row| (row[3], row[4])).collect();
        let mut iterator = 0;
        assert_eq!(unsafe { IORegistryCreateIterator(0, c"IOService".as_ptr(), 1, &mut iterator) }, 0);
        let iterator = Object(iterator);
        let mut positive_queues = 0;
        while !expected_clients.is_empty() {
            let client = Object(unsafe { IOIteratorNext(iterator.0) });
            assert_ne!(client.0, 0, "the held registry clients must still exist");
            let mut id = 0;
            assert_eq!(unsafe { IORegistryEntryGetRegistryEntryID(client.0, &mut id) }, 0);
            let Some(actual) = expected_clients.remove(&id) else { continue; };
            let usage = Owned(unsafe { IORegistryEntryCreateCFProperty(client.0, usage_key.0, ptr::null(), 0) });
            assert!(!usage.0.is_null());
            assert_eq!(unsafe { CFGetTypeID(usage.0) }, unsafe { CFArrayGetTypeID() });
            let mut expected = 0u64;
            for index in 0..unsafe { CFArrayGetCount(usage.0) } {
                let queue = unsafe { CFArrayGetValueAtIndex(usage.0, index) };
                let counter = field(queue, &time_key).unwrap();
                let mut nanos = 0i64;
                assert_ne!(unsafe { CFNumberGetValue(counter, 4, (&mut nanos as *mut i64).cast()) }, 0);
                assert!(nanos >= 0);
                positive_queues += usize::from(nanos > 0);
                expected += nanos as u64;
            }
            assert_eq!(actual, expected, "the native process counter must sum every queue's nanoseconds");
        }
        assert!(positive_queues >= 2, "both held queues must expose positive GPU counters");
        eprintln!("GPU nanoseconds: {initial} -> {first} -> {second}; positive queues: {positive_queues}");
    }
}
