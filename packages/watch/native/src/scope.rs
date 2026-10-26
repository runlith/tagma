use std::collections::HashSet;

pub const SEPARATOR: char = if cfg!(windows) { '\\' } else { '/' };

pub fn joined(directory: &str, name: &str) -> String {
    if directory.ends_with(SEPARATOR) { format!("{directory}{name}") } else { format!("{directory}{SEPARATOR}{name}") }
}

pub struct Scope {
    pub root: String,
    pub recursive: bool,
    pub exclusions: Vec<String>,
    excluded: HashSet<String>,
    base: String,
}

impl Scope {
    pub fn new(root: String, recursive: bool, exclusions: Vec<String>) -> Scope {
        let excluded = exclusions.iter().cloned().collect();
        let base = root.strip_suffix(SEPARATOR).unwrap_or(&root).to_owned();
        Scope { root, recursive, exclusions, excluded, base }
    }

    pub fn absolute(&self, relative: &str) -> String {
        if relative.is_empty() {
            return self.root.clone();
        }
        let mut path = String::with_capacity(self.base.len() + 1 + relative.len());
        path.push_str(&self.base);
        path.push(SEPARATOR);
        if SEPARATOR == '/' {
            path.push_str(relative);
        } else {
            path.extend(relative.chars().map(|one| if one == '/' { SEPARATOR } else { one }));
        }
        path
    }

    pub fn relative(&self, path: &str) -> Option<String> {
        if path == self.root {
            return Some(String::new());
        }
        let rest = path.strip_prefix(self.base.as_str())?.strip_prefix(SEPARATOR)?;
        Some(if SEPARATOR == '/' { rest.to_owned() } else { rest.replace(SEPARATOR, "/") })
    }

    pub fn excludes(&self, relative: &str) -> bool {
        if self.excluded.is_empty() {
            return false;
        }
        let mut cut = relative.len();
        loop {
            if self.excluded.contains(&relative[..cut]) {
                return true;
            }
            match relative[..cut].rfind('/') {
                Some(at) => cut = at,
                None => return false,
            }
        }
    }

    pub fn keeps(&self, relative: &str) -> bool {
        (self.recursive || !relative.contains('/')) && !self.excludes(relative)
    }

    pub fn kept(&self, path: &str) -> Option<String> {
        let relative = self.relative(path)?;
        if relative.is_empty() || self.keeps(&relative) { Some(relative) } else { None }
    }
}
