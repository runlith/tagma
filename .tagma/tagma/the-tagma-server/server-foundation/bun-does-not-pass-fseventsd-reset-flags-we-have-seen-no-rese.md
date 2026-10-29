---
id: 01a1402c-9a31-727a-8c4f-c790886e9882
title: Bun does not pass fseventsd reset flags; we have seen no resets, and losses happen only at stream restarts
ord: 18
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a1401c-b7a1-79ae-adaf-979487097634
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
---
**Answer:** we have no silent losses without a restart. Bun does not pass fseventsd reset flags, but no resets were seen in the experiments. The task grew from a misread experiment: a check after 0.5 s mistook delivery latency for loss.

**Experiment** (15 October, Bun 1.4.3, load 5–7, one run each; scripts were in the fix-graph-open thread's scratch and were not kept). Next to the Bun watcher on the same directory stood a native FSEvents stream (C, `FSEventStreamCreate`) with the same 0.05 latency and `NoDefer | FileEvents` flags. It printed `MustScanSubDirs`, `UserDropped` and `KernelDropped`. 200 files written per round, 16 rounds; check after 0.5 s, total after 4 s more.
- **Without restarts:** after 0.5 s Bun and native both missed equally (27 and 60 records). After 4 s 0 and 0 undelivered. No reset flags. That is fseventsd latency under load, up to ~2.4 s.
- **With restarts** (opening and closing another watcher): Bun never heard 143 records, native 0.
- **Loss window at a restart:** a write every 5 ms, a probe watcher opened on the 60th, 12 rounds. Each round lost 0–10 records, all written 5–60 ms BEFORE the restart; nothing written after the restart was lost. The probe watcher heard its own event after 10–70 ms.

**Bun sources** (`.external/bun`, branch `bun-v1.4.2`, file `src/runtime/node/fs_events.rs`; revision 1.4.3 `c6da4a4d3` is not in the clone):
- `events_cb` does not read reset flags;
- an event with the watched directory's own path is dropped (`path.len() <= 1 && !is_file`), while `MustScanSubDirs` arrives exactly so;
- one stream per process, recreated on every `register_watcher` and `unregister_watcher` with `kFSEventStreamEventIdSinceNow`;
- no dropping queue on the JS side (`node_fs_watcher.rs`, `path_watcher.rs`).

If fseventsd ever drops events, Bun will swallow it — that is a Bun defect, unobserved here.

**Done along the way:** the platform proves the stream delivers again (a probe in `platform/watch/live.ts`) and only then sends `unnamed` after a restart series (note 0a116765). The contract test in `tree.itest.ts`: every write is either heard by name or followed by an `unnamed`.
