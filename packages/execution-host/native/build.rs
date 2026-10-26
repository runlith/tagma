// The artifact's identity is fixed at build time: the resolved dependency closure read off the
// workspace lockfile, this crate's own sources, the target, the profile and the compiler. A library
// that cannot say what it was built from cannot be matched against the evidence that qualified it,
// so a dependency the workspace patched with local source names itself by the digest of that
// source, never by the checksum of the release it departs from. Every source it names is a rerun
// trigger, so an identity describes the sources standing under it. Its scope is those sources and
// the four fields beside them; what a compiler is told beyond its target, profile and version —
// `RUSTFLAGS`, an overridden optimization level, a feature — lies outside this text.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Default, Clone)]
struct Package {
    name: String,
    version: String,
    checksum: String,
    dependencies: Vec<String>,
}

// What this crate is compiled from, beside the closure it links.
const SOURCES: [&str; 3] = ["Cargo.toml", "build.rs", "src"];

// What a patched dependency is compiled from, by cargo's own layout. A vendored crate stands in a
// directory people work in, and what a working directory collects — an editor's swap file, a
// `.DS_Store`, a `.rej` left by re-applying the patch — is not source and moves no artifact. A
// patched crate whose manifest names a build script or another library path is one this list must
// grow to meet; until then the walk refuses the paths it cannot find.
const PATCHED_SOURCES: [&str; 2] = ["Cargo.toml", "src"];

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let lock = lockfile(&manifest_dir).expect("a Cargo.lock stands above the crate or beside it");
    let workspace = lock.parent().expect("the lockfile stands in a directory").to_path_buf();
    println!("cargo:rerun-if-changed={}", lock.display());
    // The workspace manifest is an input too: it says which packages are built from local source and
    // where those trees stand, so aiming a patch at other bytes must re-derive the identity.
    println!("cargo:rerun-if-changed={}", workspace.join("Cargo.toml").display());
    for source in SOURCES {
        println!("cargo:rerun-if-changed={source}");
    }
    let patched = patched(&workspace);
    for root in patched.values() {
        println!("cargo:rerun-if-changed={}", root.display());
    }
    let text = fs::read_to_string(&lock).expect("the lockfile is readable");
    let packages = parse(&text);
    let crate_name = env::var("CARGO_PKG_NAME").expect("cargo sets CARGO_PKG_NAME");
    let closure = closure(&packages, &crate_name);
    // A patch cargo did not apply leaves its package in the closure wearing the registry's
    // checksum: the release's bytes under a name this workspace declared it had replaced. Cargo
    // says so in a warning; here it stops the build, because linking the unpatched release while
    // reporting a patched identity is the one outcome all of this exists to catch.
    for (name, root) in &patched {
        let resolved = closure.iter().find(|package| &package.name == name);
        if let Some(package) = resolved.filter(|package| !package.checksum.is_empty()) {
            panic!(
                "{} {} resolved from the registry while the workspace patches it with {}",
                package.name,
                package.version,
                root.display()
            );
        }
    }
    let closure_text = closure
        .iter()
        .map(|p| format!("{} {} {}", p.name, p.version, checksum(p, &patched)))
        .collect::<Vec<_>>()
        .join(";");
    println!("cargo:rustc-env=EXECUTION_PLATFORM_CLOSURE={closure_text}");
    println!("cargo:rustc-env=EXECUTION_PLATFORM_SOURCE={}", digest(&manifest_dir, &SOURCES));
    println!("cargo:rustc-env=EXECUTION_PLATFORM_TARGET={}", env::var("TARGET").unwrap_or_default());
    println!("cargo:rustc-env=EXECUTION_PLATFORM_PROFILE={}", env::var("PROFILE").unwrap_or_default());
    println!("cargo:rustc-env=EXECUTION_PLATFORM_RUSTC={}", rustc_version());
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/libexecution_platform.dylib");
    }
}

// What names a package's bytes: the lockfile's registry checksum, or, for one the lockfile gives
// none because this workspace patched it with local source, the digest of that source under a
// `local:` mark, so it is never read as a checksum crates.io could verify. A package with neither
// is one whose bytes nothing here can name, and the build stops rather than report an identity a
// changed dependency could pass through unnoticed.
fn checksum(package: &Package, patched: &BTreeMap<String, PathBuf>) -> String {
    if !package.checksum.is_empty() {
        return package.checksum.clone();
    }
    match patched.get(&package.name) {
        Some(root) => format!("local:{}", digest(root, &PATCHED_SOURCES)),
        None => panic!(
            "{} {} carries no lockfile checksum and no patched source in the workspace manifest; \
             its bytes cannot be identified",
            package.name, package.version
        ),
    }
}

// The workspace lock stands at the workspace root; a crate built outside a workspace keeps its own.
fn lockfile(from: &Path) -> Option<PathBuf> {
    let mut dir = Some(from);
    while let Some(current) = dir {
        let candidate = current.join("Cargo.lock");
        if candidate.is_file() {
            return Some(candidate);
        }
        dir = current.parent();
    }
    None
}

fn rustc_version() -> String {
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    Command::new(rustc)
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

// Cargo.lock v4 is a flat list of `[[package]]` tables with scalar `name`, `version`, `checksum` and
// a `dependencies` array of `"name"` or `"name version"` strings; nothing else is read.
fn parse(text: &str) -> Vec<Package> {
    let mut packages = Vec::new();
    let mut current: Option<Package> = None;
    let mut in_dependencies = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line == "[[package]]" {
            if let Some(done) = current.take() {
                packages.push(done);
            }
            current = Some(Package::default());
            in_dependencies = false;
            continue;
        }
        let Some(package) = current.as_mut() else { continue };
        if in_dependencies {
            if line.starts_with(']') {
                in_dependencies = false;
            } else if let Some(entry) = quoted(line) {
                package.dependencies.push(entry);
            }
            continue;
        }
        if let Some(value) = scalar(line, "name") {
            package.name = value;
        } else if let Some(value) = scalar(line, "version") {
            package.version = value;
        } else if let Some(value) = scalar(line, "checksum") {
            package.checksum = value;
        } else if line.starts_with("dependencies = [") {
            in_dependencies = !line.ends_with(']');
            if !in_dependencies {
                let inner = &line["dependencies = [".len()..line.len() - 1];
                for item in inner.split(',') {
                    if let Some(entry) = quoted(item.trim()) {
                        package.dependencies.push(entry);
                    }
                }
            }
        }
    }
    if let Some(done) = current.take() {
        packages.push(done);
    }
    packages
}

fn scalar(line: &str, key: &str) -> Option<String> {
    let rest = line.strip_prefix(key)?.trim_start().strip_prefix('=')?.trim();
    quoted(rest)
}

fn quoted(text: &str) -> Option<String> {
    let text = text.trim().trim_end_matches(',').trim();
    let inner = text.strip_prefix('"')?.strip_suffix('"')?;
    Some(inner.to_string())
}

// Everything reachable from the crate through the lock's dependency lists, resolved by name and,
// where the lock names one, by version; sorted so the identity is stable across builds. A bare
// name in a lock's dependency list is the lock's own promise that exactly one version of that
// package exists in it — cargo writes the version the moment a second one appears.
fn closure(packages: &[Package], root: &str) -> Vec<Package> {
    let mut by_name: BTreeMap<&str, Vec<&Package>> = BTreeMap::new();
    for package in packages {
        by_name.entry(package.name.as_str()).or_default().push(package);
    }
    let resolve = |entry: &str| -> Option<&Package> {
        let (name, version) = match entry.split_once(' ') {
            Some((name, version)) => (name, Some(version)),
            None => (entry, None),
        };
        let candidates = by_name.get(name)?;
        match version {
            Some(version) => candidates.iter().copied().find(|p| p.version == version),
            None => candidates.first().copied(),
        }
    };
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    let mut out = Vec::new();
    let mut queue: VecDeque<&Package> = VecDeque::new();
    queue.push_back(resolve(root).expect("the lockfile names this crate"));
    while let Some(package) = queue.pop_front() {
        if !seen.insert((package.name.clone(), package.version.clone())) {
            continue;
        }
        if package.name != root {
            out.push(package.clone());
        }
        for dependency in &package.dependencies {
            if let Some(next) = resolve(dependency) {
                queue.push_back(next);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.version.cmp(&b.version)));
    out
}

// The packages this workspace builds from local source, by name, read off the `[patch]` tables of
// the manifest beside the lockfile — the only manifest whose patches cargo honours, and so the only
// place a local root is written. Inline `name = { path = "..." }` entries alone; a patch cargo
// applies through any other spelling leaves its package unnameable above, which stops the build.
fn patched(workspace: &Path) -> BTreeMap<String, PathBuf> {
    let Ok(text) = fs::read_to_string(workspace.join("Cargo.toml")) else {
        return BTreeMap::new();
    };
    let mut roots = BTreeMap::new();
    let mut in_patch = false;
    for raw in text.lines() {
        // A `#` outside quotes opens a comment, whether it stands at the head of the line or after
        // the entry; what follows it is not read.
        let line = match raw.find('#') {
            Some(at) if raw[..at].matches('"').count() % 2 == 0 => &raw[..at],
            _ => raw,
        }
        .trim();
        if line.starts_with('[') {
            in_patch = line.starts_with("[patch.");
            continue;
        }
        if !in_patch {
            continue;
        }
        let Some((name, rest)) = line.split_once('=') else { continue };
        for item in rest.split(',') {
            if let Some(path) = scalar(item.trim().trim_start_matches('{').trim_end_matches('}').trim(), "path") {
                roots.insert(name.trim().to_string(), workspace.join(path));
            }
        }
    }
    roots
}

// One digest over a tree, so local source names its own bytes: every regular file at or under each
// entry, in relative-path order, each contributing its path, a NUL, its byte length and its bytes.
// The order and the framing are the digest's own, never the filesystem's, so the same tree answers
// the same digest on any host — and a reader with the tree can compute it again.
fn digest(base: &Path, entries: &[&str]) -> String {
    let mut files = Vec::new();
    for entry in entries {
        collect(base, Path::new(entry), &mut files);
    }
    files.sort();
    let mut hash = Sha256::new();
    for relative in &files {
        hash.update(relative.as_bytes());
        hash.update(&[0]);
        let bytes = fs::read(base.join(relative)).expect("a file just listed under the base is readable");
        hash.update(&(bytes.len() as u64).to_be_bytes());
        hash.update(&bytes);
    }
    hash.finish()
}

// Every regular file at or under `relative`, spelled with `/` so a digest does not turn on the
// host's separator. Anything that cannot be listed stops the build: a tree read short would be
// hashed short, and an identity naming bytes nobody hashed is the one thing this must not produce.
// A symlink is refused rather than followed — its target's bytes stand outside the tree, where no
// rerun trigger watches them.
fn collect(base: &Path, relative: &Path, out: &mut Vec<String>) {
    let full = base.join(relative);
    let kind = fs::symlink_metadata(&full)
        .unwrap_or_else(|error| panic!("{} is readable: {error}", full.display()))
        .file_type();
    if kind.is_symlink() {
        panic!("{} is a symlink; the digest covers this tree alone", full.display());
    }
    if kind.is_file() {
        out.push(relative.to_string_lossy().replace('\\', "/"));
        return;
    }
    let entries = fs::read_dir(&full).unwrap_or_else(|error| panic!("{} is listable: {error}", full.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|error| panic!("every entry of {} is readable: {error}", full.display()));
        collect(base, &relative.join(entry.file_name()), out);
    }
}

// SHA-256 as FIPS 180-4 defines it, so local source is identified by the same digest a lockfile
// spells for a registry package, and a build script needs no dependency of its own to say so.
const ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

struct Sha256 {
    state: [u32; 8],
    block: [u8; 64],
    filled: usize,
    length: u64,
}

impl Sha256 {
    fn new() -> Self {
        Self {
            state: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
            block: [0; 64],
            filled: 0,
            length: 0,
        }
    }

    fn update(&mut self, mut bytes: &[u8]) {
        self.length = self.length.wrapping_add(bytes.len() as u64);
        while !bytes.is_empty() {
            let taken = (64 - self.filled).min(bytes.len());
            self.block[self.filled..self.filled + taken].copy_from_slice(&bytes[..taken]);
            self.filled += taken;
            bytes = &bytes[taken..];
            if self.filled == 64 {
                self.compress();
                self.filled = 0;
            }
        }
    }

    // The message length in bits closes the last block, after a single one bit and enough zeroes.
    fn finish(mut self) -> String {
        let bits = self.length.wrapping_mul(8);
        self.update(&[0x80]);
        while self.filled != 56 {
            self.update(&[0]);
        }
        self.update(&bits.to_be_bytes());
        self.state.iter().map(|word| format!("{word:08x}")).collect()
    }

    fn compress(&mut self) {
        let mut schedule = [0u32; 64];
        for (index, word) in schedule.iter_mut().enumerate().take(16) {
            let at = index * 4;
            *word = u32::from_be_bytes([self.block[at], self.block[at + 1], self.block[at + 2], self.block[at + 3]]);
        }
        for index in 16..64 {
            let previous = schedule[index - 15];
            let recent = schedule[index - 2];
            let s0 = previous.rotate_right(7) ^ previous.rotate_right(18) ^ (previous >> 3);
            let s1 = recent.rotate_right(17) ^ recent.rotate_right(19) ^ (recent >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(s0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let t1 = h
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(ROUND_CONSTANTS[index])
                .wrapping_add(schedule[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, added) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(added);
        }
    }
}
