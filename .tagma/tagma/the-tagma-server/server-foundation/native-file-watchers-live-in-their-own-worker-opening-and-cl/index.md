---
id: 01a144b2-e660-7c7d-88fc-f7b26ad2af90
title: "Native file watchers live in their own Worker: opening and closing a watch never stops the server event loop"
ord: 21
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14178-3a0a-703c-8270-f5d8b2fb89d9
sources:
  - kind: dir
    ref: apps/tagma/server/src/platform/watch
---
**Why.** On October 16 after a restart (pid 95159, build `034965e76f`) the server event loop stood in native `fs.watch()` and `FSWatcher.close()` several times in a row: 11.4 / 11.2 / 9.0 / 7.7 / 7.5 / 5.4 s and dozens of 0.3–2 s stalls. CPU for such a stall is 0.2–0.8 s — the thread waited, it didn't compute. Every live-connection break of the window (13:53:44, 13:54:45, 13:55:33, 13:56:20) fell at the end of such a stall; HTTP operations of 5–20 s and SQLite "running 5–23 s" stood behind them. What the user sees: switching projects opens after seconds, then "The live connection to the Tagma server could not be read".

**Mechanism** (Bun 1.4.1 sources in `.external/bun`: `src/runtime/node/fs_events.rs`, `path_watcher.rs`; installed Bun 1.4.3):
- On macOS all process `fs.watch` share one `FSEventStream` on a CF thread. `register_watcher`/`unregister_watcher` take that loop's mutex on the thread calling `watch`/`close`. `schedule()` on the CF thread holds the same mutex for the whole rebuild: Stop/Invalidate/Release of the old stream and Create/Start of a new one with all paths — each step talks to `fseventsd`. When `fseventsd` answers slowly (in the incident 6.6 GB RSS under memory-pressure warning), every open or close waits for the rebuild started by the previous one.
- Bun merges identical `(realpath, recursive)` into one native watcher: a second `fs.watch` on the same path adds a handler and doesn't rebuild the stream. The stream restarts only when the first or the last watcher of a path appears or leaves.
- The mutex is process-wide, but only the thread calling `watch`/`close` takes it. Events arrive on the JS thread that owns the `FSWatcher`.
- On Linux a recursive `fs.watch` walks the tree with `inotify_add_watch` synchronously on the calling thread at subscribe — the same cost growing with the tree.

Measurement (one sample on the operator's machine, Bun 1.4.3): 60 directories × 3 open/close rounds. On the main thread a single `watch()` stood up to 173 ms. The same loop in a Worker held the Worker up to 93 ms, and the main loop no longer than 1 ms. An `fs.watch` event inside the Worker reached it.

**What results.** Neither opening, nor closing, nor `hold`, nor the watch probe executes a native call on the server event loop. A slow `fseventsd` delays only what waits for the watch itself — the first read of a checkout whose watch is still opening (the first read already goes after opening) — not the whole server and not the live connection.

**Design** — platform module only, `platform/watch/`:
- `native.worker.ts` — the Worker, the only place in the process calling `fs.watch` and `FSWatcher.close`. Holds an `id → FSWatcher` table and decides nothing. Protocol: `open {id, at, recursive}` → `opened {id}` or `failed {id}`; `close {id}` → `closed {id}`; events as one `events [{id, kind, file}]` message per tick; `error {id}` on watcher `error`.
- `native.ts` — the server side. Raises the Worker on first open and holds it `unref`: the Worker doesn't keep the process alive. Native-watcher table keyed by `(at, recursive)` with a place count: the first place for a key sends `open` and waits for `opened`, later ones wait for the same answer and don't touch the Worker, the last one leaving sends `close`. Returns: open a place — an Effect ending when the native watcher is registered or refused, with a flag for "new native watcher created"; close a place with a flag for "native watcher removed"; remove a set of places and wait for `closed`.
- `tree.ts` `watchAll` changes only the native layer: `watch()`/`close()` become `native`. `WatchTickets`, `heard`, `watchReading`, groups, `withholding`, `leaveToExit` stay. `restarted()` fires only when opening or closing a group created or removed a native watcher: only then does Bun rebuild the stream. The key by written path is conservative: two spellings of one realpath produce a redundant announcement, as today, but never skip a real restart.
- Before its work `withholding` waits for `closed` for native watchers removed by held groups. A mass change starts once the stream is already assembled without them — as today after synchronous `close()`.
- `live.ts` opens the probe directory through `native` and writes into it after `opened`. The proof from the [[0a116765|restart note]] stands: a probe event can only come from a stream assembled after its registration, and the process has one stream no matter which thread called `watch`.
- The probe is asked once per series, when the series quiets (or 5 s after the first restart of a series that won't quiet) — not on every restart — that's the [[b2fb89d9|probe task]]. Closing a group costs one rebuild instead of three. The probe answer settles a place's debt only for restarts up to its question, and silence counts from the probe's registration in the Worker, not from the first restart: otherwise the ceiling would fire while the Worker still stands in a slow rebuild and would send rescans without proof.
- Lost Worker (`error`, `messageerror`, `close`): places of open native watchers hear `{rescan: 'error'}`, and places whose open hasn't been answered yet hear `{rescan: 'lost'}`; their groups close, owners reopen as after any loss; the next open raises a fresh Worker.
- Process exit: after `leaveToExit` nothing is sent to the Worker; process exit releases the watchers, as the [[a315b656|exit note]] describes.

Linux and Windows go the same way with no branching: the tree walk of a recursive Linux subscribe leaves the loop too.

Unchanged: the `TreeWatch` contract, events and rescans for owners above (`CheckoutWatch`, HEAD watching, graph recovery, plugins, document folders), ticket count per place.

Outside this spec: how many times checkouts re-read on `unnamed` after series (that count falls here only together with the rebuild count); stopping SQLite read processes when the client drops the request on project switch; the state of `fseventsd` on the machine.

**Proved by the implementer:**
- the platform contract tests pass on the new layer with no meaning change: `tree.itest.ts`, `live.itest.ts`, `restarts.test.ts`;
- new contracts: a lost Worker — every place hears `error`, and the next open watches again; opening a group whose places are all already watched doesn't raise `streamRestarts` and sends no rescans; a series of N restarts asks the probe once;
- before/after measurement on one machine: opening and closing N groups — max main-loop lag, `streamRestarts`, group open time, Worker RSS;
- the [[a315b656|exit]] and [[0a116765|restart]] notes are fixed in the same change: the watch thread waits for the rebuild, not the event loop.

**Checked by the operator:** fast project switching doesn't drop the live connection, and `read_performance` shows no `watch` and `close` frames among stalls.
