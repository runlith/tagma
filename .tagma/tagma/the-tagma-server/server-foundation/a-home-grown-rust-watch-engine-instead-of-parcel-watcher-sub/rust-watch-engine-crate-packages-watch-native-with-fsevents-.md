---
id: 01a14d49-bfd7-7ef2-b74f-966fcb4613ea
title: "Rust watch engine: crate packages/watch/native with FSEvents, inotify and Windows modelled on parcel, lossless merging, subtree reset, journal; parcel goes away"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14d45-a9c1-7b93-9bb3-0081e4811875
sources:
  - kind: dir
    ref: packages/watch
---
The whole spec [[e4811875]]. Start from `.external/parcel-watcher/src` and `packages/watch/src/watcher.ts`; first a catalog of known OS problems (parcel and notify issues, VS Code workarounds) with a test for each one that applies to us. Proof is acceptance 1–5 of the spec. Closes [[f93f3ebd]].

## Catalog of known problems and what became a test

Read 2026-10-18: all 140 issues and 132 PRs of parcel-bundler/watcher (64 issues and 31 PRs with comments), 369 issues of notify-rs/notify (95 with comments, the rest by title), notify backends and their tests, parcel workarounds in VS Code (`parcelWatcher.ts`, `baseWatcher.ts`, `nodejsWatcherLib.ts`, `common/watcher.ts`). Full catalog with sources — 70 entries; below are the ones relevant to the engine. Kit tests: `events.itest.ts`, `burst.itest.ts`, `limits.itest.ts` (Linux, needs rights to change `fs.inotify.*`), `client.itest.ts`; crate tests — `batch.rs`, `shared.rs`.

**Became tests** (macOS and Linux unless stated otherwise):
- "Created then deleted" is dropped, deletion of a replaced file disappears (parcel#72, #71, f93f3ebd) — overwrite over a file and deletion → `delete` (case 1).
- Deletion plus fast recreation (parcel#117, PR#113) → file alive (case 2); a recreated directory is watched again (parcel#117, P-lin-12).
- Renaming a directory with children and `since` after it (parcel#52, #123, PR#60) → new child paths live and in `since`, further writes in the moved directory visible, old paths not created (case 3); wd→path map after rename (PR#103, notify#555).
- A directory moved past the root keeps sending events under old paths (PR#270, notify#555) → no events.
- Batch delivery race (parcel#265, #272, PR#266) → 10,000 files in batches: each named or covered by `dropped` (case 4). FSEvents under load on the machine itself says UserDropped — that is an honest root reset, not a loss.
- A new directory written into immediately, and a `mkdir -p` chain (parcel#97, #243, notify#727) → every file named (case 5).
- Double free of the stream on `unsubscribe` while the root is deleted (parcel#271) → 10 rounds, same process, serves the next subscription (case 6). Root rename → `ended` (parcel#66, notify#770); a root renamed and immediately recreated at the same path leaves no dead subscription: `ended` on Linux, new directory events on macOS.
- More than 8 exclusions on macOS (`FSEventsBackend.cc:236`) → excluded ones don't arrive (case 7, `client.itest.ts`: 8 OS exclusions + a ninth from the engine).
- Reset with a subtree, reset at the root's ancestor (parcel PR#196, notify#1018) → merge test with a backend double in `shared.rs` (case 8).
- Linux: `max_user_watches` at subscribe (PR#263, notify#266) → refusal naming the limit, process serves the next one (case 9); queue overflow (`IN_Q_OVERFLOW` was silently skipped) → `dropped` of the root and then events, including in a directory created during the overflow: the engine rewalks the root and installs the missing watches (case 9); `ENOSPC` on a new directory after subscribe (parcel stayed silent, `InotifyBackend.cc:178`) → `ended` with the limit; inotify instance limit (parcel#159 hung) → refusal, next subscription opens after the limit is lifted.
- Rename changing only case on a case-insensitive volume (parcel#65) → `delete` of the old spelling, `create` of the new one; volume-name check (`getattrlist`), no `open`.
- A FIFO renamed over a file hung the FSEvents thread (parcel#268) → subsequent events arrive.
- Links are not resolved (parcel#76, notify#17, #47) → nothing arrives through a link.
- An exclusion cuts the subtree at the name boundary (parcel#171, PR#257) → `ex/…` absent, `exx` present.
- Names with NFC and NFD keep their bytes (VS Code `parcelWatcher.ts:521`).
- Two subscriptions to one root with different exclusions (parcel#240, #187) and closing one (shared wd on Linux) → each hears its own.
- A Linux/Windows snapshot comparing only mtime (`DirTree.cc:130`) → replacing a file with the same time shows in `since` (the snapshot stores inode and size).
- Flat subscription (parcel#92) → only its own entries (`client.itest.ts`).
- fseventsd history lags behind a fresh edit (P-mac-15) → an edit an instant before `changedSince` is visible (`client.itest.ts`, cookie barrier).

**Accounted for in code, not a test** — with reason:
- EINTR on inotify reads (parcel#253, PR#261): the read repeats on EINTR; the watch thread spawns no children, so a signal can't reliably be delivered to the engine thread in a test.
- `inotify_rm_watch` → EINVAL on an already removed watch (parcel#129, notify#709): the result is ignored; the path is covered by the Linux run of case 6.
- ENOENT/ENOTDIR/EACCES while walking (parcel#85, #88, notify#579): the directory is skipped; the test container runs as root, so EACCES can't be reproduced.
- `IN_UNMOUNT` (notify#627): subtree reset and re-installing watches; a test would need a mount inside the watched root — not written.
- Slow consumer (notify#463): the OS thread never waits for JS — the batch accumulates in engine memory, merging by path.
- FSEvents thread stop hung on the run loop (notify#942, #1026, #208): there are no run-loop threads; the FSEvents thread stands on its own dispatch queue and closes with Stop/Invalidate and a queue barrier; covered by the 10 rounds of case 6.
- Clone and type-only events (parcel#67, notify#259): such flags produce no events; there is no reliable way to reproduce `cp -c` without noise.
- fd 0 breaks on paths longer than ~RLIMIT_NOFILE/10 (notify `fsevent.rs:572`): each subscription has one path, and the server holds dozens of subscriptions — far from that bound; the engine sets no subscription-count limit.
- Windows (P-win-1…9: use-after-free on cancel, zero completion = overflow → `dropped`, 64 KB for SMB, root via `ERROR_ACCESS_DENIED`, unaligned entries, long `\\?\` paths): accounted for in `windows.rs`, only `cargo check`, no machine.
- Double saves (P-all-19) and writes to an open file with no events until close (P-mac-18, P-win-7) are OS traits, independent of the engine.

**Not accounted for**:
- Non-UTF-8 names on Linux (P-all-18): the protocol carries strings, a path goes through `to_string_lossy` — such a file arrives garbled and is judged as deleted.
- Renaming the root's ancestor on Linux (P-lin-13): inotify says nothing about the root, so the engine keeps serving relative paths.
- Old paths of files inside a renamed directory (case 3 of the spec names them): the old directory path arrives as `delete`, on Linux so do its subdirectory paths — but not file paths; FSEvents and Windows don't name them, and the engine keeps no file tree. Readers treat a deleted directory as a subtree; the test checks the old directory path and the children's new paths.
- A subtree reset reaches readers as `rename` with the directory path; the checkout tree additionally turns a reset inside `.git` into git-tag moves under it, and a working-subtree reset into re-reading the exclusion list (test in `tree.itest.ts`).
- Hard links (notify#374, notify#245): the OS doesn't report them, no test needed.
- The rest (parcel build and install, glob exclusions, N-API, watchman/kqueue/wasm) doesn't concern the engine.
