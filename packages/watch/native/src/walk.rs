use crate::scope::{Scope, joined};
use std::fs;

#[allow(dead_code)]
pub struct Entry<'a> {
    pub path: &'a str,
    pub relative: &'a str,
    pub metadata: &'a fs::Metadata,
}

pub fn walk(scope: &Scope, from: &str, visit: &mut dyn FnMut(Entry<'_>)) {
    let Some(relative) = scope.relative(from) else { return };
    let mut pending = vec![(from.to_owned(), relative)];
    while let Some((directory, relative)) = pending.pop() {
        let Ok(entries) = fs::read_dir(&directory) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let child = if relative.is_empty() { name.to_string() } else { format!("{relative}/{name}") };
            if !scope.keeps(&child) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else { continue };
            let path = joined(&directory, &name);
            visit(Entry { path: &path, relative: &child, metadata: &metadata });
            if metadata.is_dir() && scope.recursive {
                pending.push((path, child));
            }
        }
    }
}
