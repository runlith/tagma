---
id: 01a16e05-2d87-7ddc-8333-c93ee9f3c3e0
title: The in-memory FileSystem is separate from the host's files and user
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/memory.ts
  - kind: file
    ref: patches/@effect-vfs%2Fmemory@0.9.0.patch
---
The stand assembles a ready @effect-vfs/memory with Crypto so unit tests go through the real Effect FileSystem contract with no second filesystem implementation. This entry loads separately from preload. One layer build owns one volume: reusing a layer in one graph shares data, an independent build or Layer.fresh gives another volume. The starting workplace is `/`, the temporary directory `/tmp`; initial-state data is written with plain FileSystem operations.

This is a POSIX volume in memory, not the host's filesystem and user: direct node:fs/Bun calls do not intercept, devices and crash durability are not modelled. Files are dense, one file's upper limit is 4 GiB minus one byte; the original caller is privileged. This version's access check ignores readable/writable, so host permission checks stay itest. Glob supports plain wildcards, classes and list braces, but no extglob, numeric brace ranges or symlink-directory traversal. Watch events have absolute paths; order and grouping parity with native watchers is not promised. The shared conformance checks portable file operations, but not the readiness and event stream of a watcher. The owner-copy patch aligns its cp with the real Effect FileSystem cp: merging with overwrite=false keeps existing leaves and moves new ones; missing parents created; replacing a leaf does not change its other hard links. Moving a volume through TreeTransfer keeps hard links and symlink text, and copy makes independent files and leaves a relative symlink pointing at the source object. A shared conformance checks these differences as the patch trap: source memory is red on it, the real adapter and the fixed dependency green.
