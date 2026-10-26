use crate::batch::Change;
use crate::scope::Scope;
use crate::walk::walk;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::time::UNIX_EPOCH;

const HEADER: &[u8] = b"tree\n";

#[derive(PartialEq, Eq, Clone, Copy)]
struct Stamp {
    modified: i128,
    size: u64,
    node: u64,
    directory: bool,
}

fn stamp(metadata: &fs::Metadata) -> Stamp {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos() as i128);
    #[cfg(unix)]
    let node = std::os::unix::fs::MetadataExt::ino(metadata);
    #[cfg(windows)]
    let node = std::os::windows::fs::MetadataExt::creation_time(metadata);
    Stamp { modified, size: if metadata.is_dir() { 0 } else { metadata.len() }, node, directory: metadata.is_dir() }
}

fn tree(scope: &Scope) -> io::Result<HashMap<String, Stamp>> {
    if !fs::symlink_metadata(&scope.root)?.is_dir() {
        return Err(io::Error::other(format!("{} is not a directory", scope.root)));
    }
    let mut entries = HashMap::new();
    walk(scope, &scope.root, &mut |entry| {
        entries.insert(entry.relative.to_owned(), stamp(entry.metadata));
    });
    Ok(entries)
}

pub fn write(scope: &Scope, file: &str) -> Result<(), String> {
    let entries = tree(scope).map_err(|error| format!("{} could not be read: {error}", scope.root))?;
    let written = (|| -> io::Result<()> {
        let mut out = BufWriter::new(File::create(file)?);
        out.write_all(HEADER)?;
        for (path, stamp) in &entries {
            out.write_all(&(path.len() as u32).to_le_bytes())?;
            out.write_all(path.as_bytes())?;
            out.write_all(&stamp.modified.to_le_bytes())?;
            out.write_all(&stamp.size.to_le_bytes())?;
            out.write_all(&stamp.node.to_le_bytes())?;
            out.write_all(&[u8::from(stamp.directory)])?;
        }
        out.flush()
    })();
    written.map_err(|error| format!("the snapshot {file} could not be written: {error}"))
}

fn read(file: &str) -> Option<HashMap<String, Stamp>> {
    let mut bytes = Vec::new();
    File::open(file).ok()?.read_to_end(&mut bytes).ok()?;
    let mut rest = bytes.strip_prefix(HEADER)?;
    let mut entries = HashMap::new();
    let mut take = |count: usize| -> Option<&[u8]> {
        let (head, tail) = rest.split_at_checked(count)?;
        rest = tail;
        Some(head)
    };
    loop {
        let Some(length) = take(4) else { return Some(entries) };
        let length = u32::from_le_bytes(length.try_into().ok()?) as usize;
        let path = String::from_utf8(take(length)?.to_vec()).ok()?;
        let modified = i128::from_le_bytes(take(16)?.try_into().ok()?);
        let size = u64::from_le_bytes(take(8)?.try_into().ok()?);
        let node = u64::from_le_bytes(take(8)?.try_into().ok()?);
        let directory = take(1)?[0] == 1;
        entries.insert(path, Stamp { modified, size, node, directory });
    }
}

pub fn since(scope: &Scope, file: &str) -> Result<Option<Vec<Change>>, String> {
    let Some(before) = read(file) else { return Ok(None) };
    let now = tree(scope).map_err(|error| format!("{} could not be read: {error}", scope.root))?;
    let mut changes = Vec::new();
    for (path, stamp) in &now {
        match before.get(path) {
            None => changes.push(Change::Created { path: path.clone(), directory: stamp.directory }),
            Some(held) if held.directory != stamp.directory => {
                changes.push(Change::Deleted { path: path.clone() });
                changes.push(Change::Created { path: path.clone(), directory: stamp.directory });
            }
            Some(held) if !stamp.directory && held != stamp => changes.push(Change::Updated { path: path.clone() }),
            Some(_) => {}
        }
    }
    for path in before.keys() {
        if !now.contains_key(path) {
            changes.push(Change::Deleted { path: path.clone() });
        }
    }
    Ok(Some(changes))
}
