---
id: 01a18887-a164-7d57-91d8-b822bfb3c770
title: "A directory without a usable identity is no registered root: lookups pass over it instead of failing"
ord: 29
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/registry.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/coverage.ts
---
Registration refuses a directory whose stat gives no safe-integer inode or no birthtime, so every registered root carries a usable identity. A directory without one therefore can never equal a root or be a root's ancestor key, and the lookups asking only that — `FileRoots.matching`, the ancestor walk of `probe`, `Coverage.follow` — treat it as "not a root" and go on. Registration and a probe of the resource itself still refuse `identity-unavailable`: there the identity is the answer.

The case is ordinary on macOS: directories of the sealed system volume (`/usr`, `/bin`, `/etc`, `/System`) have inodes above 2^53, which Effect's `FileSystem.stat` reports as `ino: None`. Before this, every path under `/usr/local` — placing `/usr/local/bin` from a message, or a command with that `workdir` — failed with "The filesystem did not supply a usable device and inode."