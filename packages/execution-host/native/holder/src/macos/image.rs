unsafe extern "C" {
    fn _dyld_get_image_header(index: u32) -> *const u8;
}

fn uuid(bytes: &[u8]) -> Option<[u8; 16]> {
    if bytes.get(..4)? != [0xcf, 0xfa, 0xed, 0xfe] { return None; }
    let count = u32::from_le_bytes(bytes.get(16..20)?.try_into().ok()?);
    let length = u32::from_le_bytes(bytes.get(20..24)?.try_into().ok()?) as usize;
    let commands = bytes.get(32..32usize.checked_add(length)?)?;
    let mut at = 0usize;
    for _ in 0..count {
        let command = u32::from_le_bytes(commands.get(at..at.checked_add(4)?)?.try_into().ok()?);
        let size = u32::from_le_bytes(commands.get(at.checked_add(4)?..at.checked_add(8)?)?.try_into().ok()?) as usize;
        if size < 8 { return None; }
        let entry = commands.get(at..at.checked_add(size)?)?;
        if command == 0x1b { return entry.get(8..24)?.try_into().ok(); }
        at = at.checked_add(size)?;
    }
    None
}

fn current_uuid() -> Option<[u8; 16]> {
    let header = unsafe { _dyld_get_image_header(0) };
    if header.is_null() { return None; }
    let bytes = unsafe { std::slice::from_raw_parts(header, 32) };
    let length = u32::from_le_bytes(bytes.get(20..24)?.try_into().ok()?) as usize;
    uuid(unsafe { std::slice::from_raw_parts(header, 32usize.checked_add(length)?) })
}

pub fn verify(bytes: &[u8]) -> Result<(), String> {
    let loaded = current_uuid().ok_or("the running image has no readable UUID")?;
    if uuid(bytes) != Some(loaded) { return Err("the source is not the running image".into()); }
    Ok(())
}
