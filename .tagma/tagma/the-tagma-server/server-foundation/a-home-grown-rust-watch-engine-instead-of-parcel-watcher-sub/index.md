---
id: 01a14d45-a9c1-7b93-9bb3-0081e4811875
title: "A home-grown Rust watch engine instead of @parcel/watcher: subscription, lossless merging, subtree resets and a journal on parcel's source model, under the same process and protocol"
ord: 29
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c5a-4c1f-719c-8aa5-3b838d8a01b6
  - kind: relates
    to: 01a14c8b-1ab3-729f-bb5e-5a7de611425d
  - kind: relates
    to: 01a14c8b-1ab4-7c7a-a077-61b56b77ed62
sources:
  - kind: dir
    ref: packages/watch
---
The watch process ([[8d8a01b6]]) gets a home-grown Rust engine instead of `@parcel/watcher`. The protocol, the root-change record socket, marks and the process life already written in TypeScript (`packages/watch/src/watcher.ts`) stay. Only what the parcel addon does now changes: subscribing to a root, events, snapshots and "what changed since the snapshot".

## Why

**Parcel is no longer maintained well enough to lean on.** Verified 2026-10-18.
- The last commit in `parcel-bundler/watcher` is 20 July 2026. Ours is the latest version, 2.6.0.
- [PR #266](https://github.com/parcel-bundler/watcher/pull/266) fixes a race that loses events: an event arriving while a batch is delivered disappears. By the author's measurement it is one loss per ~11,200 double writes and 13 per 1.84M creations. The PR has been open since 28 September, the maintainers silent.
- [Issue #271](https://github.com/parcel-bundler/watcher/issues/271): on macOS a double free of the stream crashes when `unsubscribe` coincides with the watched directory's deletion.

**Parcel's semantics get in our way.** `EventList` deliberately drops a path created and deleted in one batch ([issue #72](https://github.com/parcel-bundler/watcher/issues/72)). FSEvents names a replacement over a standing file a creation, so an "atomic write and immediate delete" faster than ~50 ms yields no event at all ([[f93f3ebd]]). The kit's flat subscriptions walk around it by reading the directory membership; recursive ones have no walk-around. One more loss: on `MustScanSubDirs` FSEvents names a subdirectory while parcel returns a pathless error, and the whole root must be rescanned.

So the engine would need patching and maintaining by us under any choice.

**Why Rust, not a C++ fork.** Parcel's source is 4,173 C++ rows, the need here about 2,000: FSEvents 338, inotify 236, Windows 282, the core ~900, N-API 268. A fork and a rewrite cost nearly the same work: both drop N-API, rewrite the event merge, fix the race, add the journal UUID and set up the build. The remaining arguments decided:
- **Rust already builds with us:** `packages/execution-host/native` (cargo, a cdylib through `bun:ffi`, carrying into the release, signing in `sealRelease`). C++ would be a second native language with its own pipeline.
- **Memory safety:** the whole #271 error class goes.
- **Semantics ours from the first row**, not edits over someone else's core written for a bundler.

Parcel's value is the solved non-obvious places of every OS. They carry over with the sample at hand: parcel's source reads as the reference, each backend's logic carries close to it.

**Rejected as a dependency: `notify` (Rust, 13,225 rows).** It is alive (8.2.0 of 17 October 2026), but on macOS it lacks what is needed here (master source of 2026-10-18): the stream starts hard "from this moment", a reset arrives pathless, there are no OS-side exclusions, and adding a path rebuilds the watcher stream. FSEvents would still be written by hand, and `notify` would stay a second event source under our merge.

**References** lie in `.external/parcel-watcher` (b46c53f) and `.external/notify` (d3104e4). Parcel is the main sample of backend logic; `notify` is the sample of Rust inotify and Windows code, its backend tests and its issues as a case source. Known from it already: FSEvents breaks the process fd 0 when paths across all streams exceed about RLIMIT_NOFILE/10.

## What the engine does

A `packages/watch/native` crate (cdylib), loaded into the watch process through `bun:ffi`, as `execution-platform`. Events are born on OS threads; they never reach JS by callback from another thread: the engine writes batches into its own channel (fd), the watch process reads it in its loop. The channel shape follows `execution-platform` (`channel.rs`, `reactor.rs`).

**Calls** — what `watcher.ts` now takes from parcel:
- `subscribe(root, recursive, exclusions)` → a subscription with event batches;
- `unsubscribe` — answers after the OS stream closes;
- `mark(root)` → a journal position: on macOS an FSEvents event number and the volume's journal UUID; on Linux and Windows a tree snapshot (every file's `stat`) into a file;
- `since(root, mark)` → changed paths or "don't know".

**Batch events:** `created`, `updated`, `deleted` with a path; `dropped(subtree)` — a reset after which the subtree must be re-read; `ended` — the root is gone or the stream died.

**Merging** — one for all backends:
- the last event on a path in the batch wins. "Created and deleted" is never dropped: when the OS does not say plainly whether the path existed before the batch, `lstat` of the path at delivery decides — no path → `deleted`, present → `updated`;
- delivering a batch takes the events and the error under one lock: an event arriving during delivery stays for the next batch (the essence of PR #266).

**Backends.**
- **macOS, FSEvents.** A stream of its own per subscription, file events, up to 8 OS-side exclusions, the rest filtered by the engine. `MustScanSubDirs`, UserDropped, KernelDropped → `dropped` with the event's path. `since` is a stream with `sinceWhen` up to `HistoryDone`; the journal UUID (`FSEventsCopyUUIDForDevice`) lives inside the engine, `journal.ts` goes. The barrier cookie from `watcher.ts` stays: fseventsd history lags a just-made edit.
- **Linux, inotify.** A watch on every directory except excluded ones: an excluded directory costs no watch. A new directory is walked over right after its watch is set, and files that appeared before it are delivered as `created`. `IN_Q_OVERFLOW` → `dropped(root)`. `ENOSPC` on setting → a subscription error with a reason, the process stays alive. The wd → path map outlives a directory rename.
- **Windows, ReadDirectoryChangesW.** Buffer overflow → `dropped(root)`, long paths. For now it only compiles and is checked by reading: there is no Windows machine, no Windows release.

**Not carried over:** Watchman, kqueue, WASM, FreeBSD, N-API, the parcel bundler's `DirTree` — except what inotify needs for the directory map and the Linux/Windows snapshot.

## What changes around it

- `watcher.ts`: parcel calls become engine calls. The flat-subscription directory-membership read goes — the merge no longer loses deletions. A client's `dropped(subtree)` arrives as a rescan of that subtree, not the whole root.
- **The `platform/watch` contract.** A subtree reset reaches places as `rename` with the directory path: consumers already read the named directory with a status on it, which covers the subtree. A full `unnamed` stays for `dropped(root)` and a process loss.
- **A release:** `@parcel/watcher` leaves the kit's dependencies and `CARRIED_PACKAGES` in `installation/cut/release.ts`; the cut carries our dylib, `sealRelease` signs it. The build hash (`client.ts`) counts from the engine dylib, not parcel's `package.json`.
- **The graph:** the [[e611425d]] and [[6b77ed62]] explanations are corrected by the same change — parcel, its merge and the flat-subscription walk leave them. [[f93f3ebd]] is closed by this work.

## Known problems — tests before carrying over

Before carrying a backend over, the performer walks parcel's issues (open and closed), `notify`'s issues and parcel's work-arounds in the VS Code layer (`src/vs/platform/files/node/watcher/parcel/parcelWatcher.ts`) for that OS. For every problem concerning us — a test on the kit's behaviour: "did X — Y arrived". What of the found became a test and what did not and why goes in the task.

Mandatory cases:
1. An atomic write over a file and immediate delete in one batch → `deleted` in a recursive subscription.
2. Deleting and fast recreating → `updated` or `created`, the file alive.
3. Renaming a directory with files → events on old and new child paths; `since` after such a rename names the new paths (issue #52).
4. Mass creation (10,000 files in batches) → not one lost event (the PR #266 race).
5. A new directory with files written into it at once → every file named (the inotify race).
6. Deleting the watched root during `unsubscribe` → `ended`, the process alive (issue #271).
7. More than 8 exclusions on macOS → the excluded never arrives.
8. A reset → `dropped` with the subtree — a merge test with a backend double.
9. Linux: exhausting `max_user_watches` (lower the bound in a container) → a subscription error, the process alive; queue overflow → `dropped(root)`.

## Acceptance — verified by the performer

1. The kit's existing itests and `platform/watch/tree.itest.ts` pass with no changes to their expectations.
2. Mandatory cases 1–8 green on macOS, 1–5 and 9 on Linux in Docker (`oven/bun`, arm64; x64 when available).
3. Windows: `cargo check --target x86_64-pc-windows-msvc` passes; behaviour unproven.
4. On a private `tagma:try`: a server restart with a live watch process, an edit during handover visible, the graph tree's first refresh a status on the named path (as in the [[8d8a01b6]] acceptance).
5. The cut contains the engine dylib and no `@parcel/watcher`; the dylib is signed Developer ID with hardened runtime.

## What the operator checks

Not a close condition: after a server restart Load shows no git on idling checkouts.
