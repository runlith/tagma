---
id: 01a175e1-b116-7055-8be6-30fa13792520
title: Tagma on Linux x64 and arm64
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
Tagma installs and runs on Linux x64 and arm64: window, server, agents, terminals, update. The spec rests on [[fb401399|cut for the stated platform and feed with a per-platform archive]]. Each part's details are written before its work, from reading its code.

## What the code says

- **Execution holder.** The Rust core needs a Linux module behind the `Platform` trait: now the only module is macOS ([[4a736f36]]). The native library (`packages/execution-host/native/src/lib.rs`) wires its modules only under macOS, though `usage.rs` already carries a Linux branch. The POSIX adapter in the host logic is shared for macOS and Linux anyway ([[921755ee]]).
- **Install.**
  - Package format picked in the work.
  - `sh` launcher portable.
  - APFS clones (`cp -c`) replaced with a plain copy with a space check — already there as the fallback path.
  - App integrity at update checked without `codesign`.
  - SQLite engine for Linux already declared.
- **Window and machine.** Window behavior, input (key hold and paste), CoreAudio sound helper, sleep prevention (`caffeinate`), opening apps and editors (LaunchServices). Each gets a Linux variant or a declared absence with a cause.
- **Whisper** builds for Linux.

## Where checked

Linux arm64 VM on a Mac with Apple silicon, x64 — through Rosetta inside it. Real x64 iron — testers.
