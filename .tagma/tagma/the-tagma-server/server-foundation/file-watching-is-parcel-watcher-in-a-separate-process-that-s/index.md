---
id: 01a14c5a-4c1f-719c-8aa5-3b838d8a01b6
title: "File watching is @parcel/watcher in a separate process that survives server restarts, one stream per root: an idle checkout costs nothing, graph-tree freshness and post-restart checks cost O(changed)"
ord: 27
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10323-2fc7-78fa-8d6d-620a6ce62961
  - kind: relates
    to: 01a117dd-98e5-7df2-86cb-e3f89c88344d
  - kind: relates
    to: 01a13ba2-803d-7614-a6da-35301e154af5
  - kind: relates
    to: 01a14bf1-c8c1-7ce0-9d6e-628bc57e2aa9
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b3dd761187
sources:
  - kind: dir
    ref: apps/tagma/server/src/platform/watch
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/freshness.ts
    symbol: treeSeen
---
File watching stops being the server's main overhead. An idle checkout costs nothing. A change costs as many files as it touched. A project's first open after a server restart never reads the whole graph tree.

## What stands now and what it costs

**The shared Bun stream.** Every server watch — Bun's `fs.watch` opened by the watch Worker (`platform/watch/native.ts`). On macOS Bun holds one FSEvents stream per process and rebuilds it on every watcher open and close. A rebuild may lose events, so after a rebuild series the platform sends every standing group `unnamed` ([[0a116765]]). Every `unnamed` is a full `git status --untracked-files=all` of that checkout.

**Cost, measured 2026-10-17 on the operator's machine** (one sample each; a server with ~20 checkouts):
- Over 21 minutes the stream rebuilt 113 times. Every runlith worktree got ~51 `unnamed`, i.e. a full status about every 25 s, including where nobody worked.
- One full runlith status is 0.62 s CPU, 0.49 s of it in the kernel: `lstat` and directory walks. A single-path status is 0.07 s.
- The server's git children: 1.18 cores before fsmonitor, 0.32 after. fsmonitor cheapened every rescan, but the rescan count stayed the same.
- Around Bun's weak spot grew a brace: the watch Worker, so a rebuild never stops the loop ([[07a7171a]]); the stream probe and restart series (`live.ts`, `restarts.ts`); leaving without closing watchers ([[a315b656]]).

**Mass changes.** `bun install` or a branch switch give thousands of named events. Named paths over 16 KiB in weight read full ([[5d61cfcf]]), so such work in one checkout also costs full reads.

**The graph tree under a live watch.** `FreshnessGate.refresh` (`graph/serving/freshness.ts`) calls `readTree` on every watch, and it calls `treeSeen` (`graph/tree/freshness.ts`) with the graph tree's full status (`paths: ['.']`, `untracked: 'all'`). The paths the watcher named are thrown away by refresh: editing one block costs a status of the whole tree.

**A cold open** ([[a6b4b6b7]], measured on a trial server, one sample). A first open of a team project with a ready mirror (16.7k blocks) after a restart takes 3.3 s, 2.7 s of it the tree's git status. The server calls git with `GIT_OPTIONAL_LOCKS=0` (`platform/git/ownGit.ts`), git never writes the refreshed index, and with stale stat data it rehashes files. That breaks law [[c57e2aa9]]: a 1 s ceiling, a 50–100 ms goal.

## The fix

### 1. The watcher is `@parcel/watcher` in a separate process

**Why it.** A ready native watcher for macOS (FSEvents), Linux (inotify), Windows and FreeBSD; VS Code and Orca stand on it ([[9496f66b]]). Verified by a 2026-10-18 run (Bun 1.4.3, `@parcel/watcher` 2.6.0, darwin-arm64):
- runs under Bun over N-API;
- each subscription has its own `FSEventStreamCreate` (`src/macos/FSEventsBackend.cc`). While one subscription was removed and reopened, the neighbouring root's subscription got all its events;
- `ignore` cuts a directory off on the OS side (`FSEventStreamSetExclusionPaths`);
- `writeSnapshot` and `getEventsSince` answer what changed since a snapshot.

So the cause goes, not its consequence: opening and closing one watch no longer touches the rest, and there are no "just in case" rescans.

**Rejected.**
- **A home-grown Rust watcher.** It would give pinpoint sub-tree rescans on reset, inotify control, and a USN journal on Windows. But that is three implementations with their build and checks on every OS, and maintaining them is ours. None of those advantages is needed now: a reset in one root after this change costs rescanning one root, releases go out only for Mac. When parcel hits a bound — frequent resets in large checkouts or the inotify limit — a home module stands behind the same port, and no other code is touched by it.
- **A `core.fsmonitor` hook on our own watcher.** Git's built-in daemon is enough: it is on macOS, on Windows, and on Linux since git 2.55.
- **Bun `fs.watch` with one more compensation layer.** The compensations are already there, and they are exactly the current cost.

**A separate process.** Native-code failure in the server process would take the operator's server down; VS Code keeps parcel in a utility process, Orca in a child. One watch process per machine, on the `@runlith/sqlite-process` model (its own `child.ts`, channel, native asset in the bundle). A `subscribe` call no longer waits on fseventsd on the server's JS stream, so the watch Worker is not needed.
- **Process loss.** Owners hear it the same as losing the Worker now: open subscriptions' places get `error`, places whose opening never answered get `lost`. Owners reopen watching, the next opening raises a new process. The server keeps running.
- **The process survives a server restart** (clause 4).

### 2. Layers and contract

- The **`@runlith/watch` kit** (`packages/watch`): the watch process (`child.ts` over parcel), channel and client with `subscribe(at, {recursive, ignore}, listener)`, `writeSnapshot(at)` and `since(at, snapshot)`. It knows nothing of the server.
- **A port in `platform`.** The core never knows the variant ([[6f758080]]): `platform/contract/service` declares the watcher port in the same shape, composition binds it to the kit client. `platform` ([[edf810fe]]) never imports the kit; composition ([[13182a9f]]) imports it. The new module's card is kit kind, its entries and imports written by `set_module` in the same change.
- The **`platform/watch` public contract does not change**: `watchAll`, `watchTree`, `TreeWatch`, `WatchEvent`, `TreeShift`, `withholding`, tickets. Consumers (`workspace/watch`, `graph/serving/freshness`, `graph/serving/recovery`, `checkout-files/documents/folders`, `plugins/supervisor`) do not change. One subscription per "path, recursiveness" pair stays shared by the places with that pair.
- **Events.** `create` and `delete` go as the current `rename` with a path (membership changed), `update` as a named path. A reset and a subscription error (`MustScanSubDirs`, Dropped; parcel returns them as a pathless error) give `unnamed` to that subscription's places only.
- **OS-side exclusions.** A checkout tree's recursive subscription excludes `.git/objects` and directories git wholly counts ignored. The list comes from `git ls-files --others --ignored --exclude-standard --directory`. It re-reads on an `ignore` movement, and the subscription reopens with `unnamed`. So `bun install` in `node_modules` spawns no events and never turns the read full.
  - Decision and cost: the operator's explorer does not live-update inside an excluded directory. An opened ignored directory re-reads when opened (`read_directory` reads on demand anyway). Orca does the same.
  - FSEvents excludes no more than 8 paths on the OS side ([[9496f66b]]). How parcel treats the rest is verified by the performer; when it does not filter them, the filter stands in the watch process.
- **`withholding` stays with a new reason.** A tree being deleted must not pour thousands of events over its own owners while it is removed. Holding closes the subscription, the hold's end opens it again with `unnamed`.
- **`read_watches`** ([[dd761187]]). The `streamRestarts` counter and its grammar text go. A place shows its subscription's resets among rescans.

### 3. Graph-tree freshness costs O(changed)

**A live tree.** The gate piles the watch's named paths since the last refresh. A refresh with named paths reads a status on them only (a literal pathspec, the same command-line bound as in [[5d61cfcf]]) and compares HEAD against the stamp. A full tree status stays for the first read, `unnamed`, a reset, a command-line-bound overflow, and a change to `.gitignore`, `info/exclude` or `core.excludesFile`. An ignore-rule change alters the status of files that never changed themselves.

**A cold tree.** The mirror stamp (`treeHeadStamp`) keeps three things: HEAD, the last read's dirty-path set, and the journal position — a parcel snapshot with the volume's UUID.
- **Invariant.** A snapshot is valid for the mirror state only when written before the status read that gave that state. Post-snapshot events the read already saw arrive again — harmless. A pre-snapshot change the read never saw would be lost.
- **Opening after a restart.** When the snapshot exists and the journal UUID matched: `since(snapshot)` gives the changed paths; the status reads them and the former dirty paths; staged changes give `git diff-index --cached HEAD` (compares index against HEAD with no working-file hashing); HEAD compares against the stamp, as now. With no snapshot, a mismatched UUID, a path list past the bound, or an ignore-rule file among the paths — a full read, as now.
- **The journal UUID** (`FSEventsCopyUUIDForDevice`) reads through `bun:ffi` to CoreServices in the watch process, no home build needed. Parcel itself never checks whether the event number outlived an fseventsd journal wipe or a volume swap, and then `getEventsSince` would silently return a short list. Derived from the source, not reproduced.
- **Snapshot cadence by OS.**
  - **macOS:** the snapshot is an event number, 1.5 ms over a 17,010-file tree (measured); it writes on every refresh.
  - **Linux and Windows:** the snapshot is a tree walk with `stat`, ~160 ms over the same tree (a `brute-force` backend measurement on this Mac, one sample). It writes only at graph close: a snapshot, then the last refresh. The old snapshot stays valid, because post-snapshot events are a superset of the needed ones; after a server crash it is used.
- **Rejected.**
  - **Refreshing the user's checkout index** (`update-index --refresh` or a status without `GIT_OPTIONAL_LOCKS=0`). That is an `index.lock` write under the user's and agents' git commands.
  - **A home stat cache of tree files in the mirror.** That is O(tree) on every open and a second derivation of what git already knows ([[51c66cb6]]).
- **Stealth storage.** There the tree is Tagma's own repository. Its index may update with no journal: cheaper, and it removes rehashing. A derivation — the performer verifies by measurement.

### 4. The watch process survives a server restart

The server restarts often: updates, an operator restart, a place handover to an install. The watch process never leaves with it. It keeps watching the roots it held and piles changed paths. A new server opening a place on a root the process already holds gets "what changed since the last delivery" — named paths or a rescan — instead of a first full read.

**Why.** The only way to make the post-restart check O(changed) on every OS. inotify has no journal that outlives a process stop, and a home native module does not change that. Without a long-lived process Linux and Windows walk the tree after every restart, and on large graphs that breaks [[c57e2aa9]]. On macOS the FSEvents journal gives nearly the same, but the process still spares snapshots and UUID checks in the ordinary case.

**The process life** is as the execution host's ([[7b9b56cc]]): survives a server restart and a place handover, ends with the install's Stop and its removal. A new server finds the process by a channel in the data directory. No process — raises a new one.

**Buffering while there is no server.**
- Per root piles a path set, not an event queue. Under the bound the root answers named paths, past it one rescan. The bound derives from the machine's memory ([[fe83acfa]]).
- A reset and a subscription error with no server mark the root for rescan. A vanished root (a worktree deleted with no server) answers rescan, and its subscription ends.
- The subscriptions held are the root set the last server declared. A root the new server never opened within the term after connecting is closed by the process. The term is a memory-and-descriptor price, not correctness.

**A release swap.** The old release's process never serves a new server: a new build sends other builds' processes to exit. No separate snapshot before the swap is needed: the mark the base's foundation saved before its own read already carries the snapshot (clause 3). The new process takes `since(snapshot)` once for those roots. On macOS that is the journal, on Linux and Windows one walk per update — rare.

**A machine reboot** loses the process. Then the clause-3 journal or snapshot applies, and without them a full read.

**The cold tree-check source order:** the watch process → the journal or snapshot → a full read.

**Rejected: a watcher inside the execution host.** Its crash would touch agents' terminals and commands. The process is separate, with the same life model.

## Numbers: measured and expected

| What | Now (measured, one sample) | After (estimated) |
|---|---|---|
| The server's git children with no work | 0.32 cores | ~0.05 cores |
| Full statuses of an idle checkout | ~1 per 25 s | 1 per open |
| Editing one block under a live watch | a whole tree's status | a one-path status, ~0.07 s |
| Cold open of a 16.7k-block team project, macOS | 3.3 s, 2.7 s of it git | ~0.6 s: journal 10 ms (measured), the rest `GraphPool.open` 0.6 s |
| Same on Linux and Windows, after a server restart | 3.3 s | ~0.6 s: the process answer from memory plus the rest |
| Same on Linux and Windows, after an update or reboot | 3.3 s | ~0.8 s: a 160 ms walk plus the rest |

**Bound.** After a Tagma update or a machine reboot Linux and Windows walk the tree once by `stat`. On a million blocks that is ~9 s (a linear estimate), and at those moments law [[c57e2aa9]] does not hold. parcel itself takes Watchman when installed.

## Deleted

- `platform/watch/native.ts`, `native.worker.ts`, `live.ts`, `restarts.ts` and their tests.
- The `RESTARTS` branch and the rebuild counter in `tree.ts`; `leaveToExit` and its call in `composition/server.ts`.
- The `streamRestarts` field in `contract/wire/watch.ts`.
- Explanations [[0a116765]], [[07a7171a]], [[a315b656]] go to the trash in the same change: their mechanism goes. The performer writes a new `#explanation` of the watch process and its loss rules.

## Not included

- **A checkout row's first read after a restart from the journal.** Checkout rows are not stored across runs, while fsmonitor already cheapened the full read. A separate task when measurement shows need.
- **The window watches only visible checkouts.** After step 1 an invisible checkout costs one subscription and nearly nothing. When measurement shows otherwise, a task.
- **Snapshots around bash** ([[6ce62961]]) — a separate idea.
- **A new worktree's mirror rebuild** — the [[1e154af5]] owner, not git.

## Order

Step 1 (the watcher) and the live part of step 3 are independent. The cold part of step 3 stands on step 1's snapshots. Step 4 stands on step 1 and may land separately after it. [[a6b4b6b7]] performs step 3.

## Acceptance — verified by the performer

1. **Root independence.** Opening and closing a place on root B gives no rescan to root A's place (the platform's itest on a real watch process).
2. **A reset is local.** A subscription error gives `unnamed` to its own places only (a platform test with a port double).
3. **Process loss.** After `SIGKILL` of the watch process places get `error`, the checkout row reopens the watch and sees a file edit again, the server answers (itest).
4. **Idling.** A server with no work and ~20 checkouts for 20 minutes: no more than one full read per idle checkout; git-children CPU before and after from `read_machine_load`. Numbers in the task.
5. **A mass change.** `bun install` in a watched checkout gives no full read (`CheckoutStatus.reading` spans).
6. **A live graph tree.** Editing one block file gives a refresh with a one-path status (span).
7. **A cold open.** The first `read_block` in a 16.7k-block team project after a trial-server restart < 1 s. A swapped journal UUID, a deleted snapshot and a `.gitignore` change give a full read.
8. **Equality.** A cold tree's dirty-path set after a journal read matches the same tree's full status (a one-off check, the result in the task).
9. **Linux.** parcel under Bun on Linux opens a subscription and delivers events. When that cannot run inside the work, it is named unproven.
10. **A server restart.** A block-file edit made while the server is down shows in its first refresh as a named path after start. No full tree status (span). A buffer overflow gives the root's rescan (a test with a process double).
11. **A release swap.** The old release's process is replaced. An edit during the swap is never lost: `since(snapshot)` gives it.
12. **A release.** The cut contains the watcher's node file for its platform, `sealRelease` signs it, notarization passes.

## What the operator checks

Not a close condition. After he restarts the server himself, fans and Load show no git on idling checkouts, and a project opens after a restart with no seconds-long pause.
