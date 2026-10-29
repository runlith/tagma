---
id: 01a15b5f-d36f-79b5-b2ae-826a26950d67
title: Server start passes hold the event loop for seconds, and the first thread-list window waits for it
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b5f-fd7b-79cd-8067-a2444e84ae3c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15b5e-88be-7366-9ba7-0f8cfb894faa
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/store.ts
---
The first thread-list window after server start arrives after seconds: the event loop is busy with start passes at that time, and the ready read waits for it.

**Measurement (one operator machine, server telemetry).** The ten longest `ThreadFeeds.openList` runs — 1.6–5.1 s, all in the first 15–45 s of process life. In the longest (trace `252aef38639f19627a97c6cd3ffea338`) `ThreadListReads.rootWindow` took 4.4 s, its `sql.execute` 4.3 s with `db.exec.ms` 234 and `db.queue.ms` 4: the query ran fast, the rest was event-loop waiting.

Loop freeze frames in the same window: 1701 ms blocked (stall `98aa2083-725d-4ab1-a991-3d1a8c3c0ef5`, profile `4f8b1c6d-16c5-41dd-9e23-3e2393684183`), 1220 ms in `packages/sqlite-process/src/ReaderPool.ts:220`, 509 ms `accessSync`. Operations overlapping the first freeze: `Retirer.pass`, `Holdings.judge`/`Holdings.inputs`, `FileRoots.read`/`check`, `Git.*` (status, objects), `harnessInstall.refreshedFor`, `ThreadSettlementOutbox.notifySettledRuns`, `Plugins.start`, `Store.permit.wait`.

**To do.** Find which start work synchronously holds the loop (by profile, not by guess) and remove the cost at its owner — by the rule on unbounded synchronous computation on the loop: cut to what the work touches, the rest goes to the owner's worker. Goal — a project-list open right after start no longer than a warm one (hundreds of milliseconds), on any machine, not just this one.

**What held the loop.** The 1701, 1220, and 509 ms freezes are `blocked` (loop CPU near zero, process CPU near a core) with a sample gap in the profile; the 1249 ms freeze in the `openList` window is the same gap with a busy loop. These are GC pauses: under sampling the JSC sampler (`CpuProfiler`) counts `CodeBlock::hash()` — SHA1 over the UTF-8 of the whole source of every newly sampled CodeBlock — and for the bundle program and every class field initializer the source is the whole `bin/server/http.js`: 77 MB in the developer cut, 57 MB of it the inline map. The operations named in the freeze ran across the pause and did not cause it. Proven on one's own instance: `BUN_JSC_logGC=1` shows GC pauses of the same length as the freezes (422–1620 ms); with the sampler off there are no pauses past 50 ms; the symbolized `sample` is a GC helper thread in `SHA1::processBlock < CodeBlock::hash < SamplingProfiler::processUnverifiedStackTraces` while the main thread waits; a separate 60 MB file with a class with fields under the sampler gives a 337–346 ms pause, the same class without field syntax — 1 ms.

**Done.** The developer cut puts the map next to the bundle instead of inside it: [[8c935cbb]]. Measurement (own instance, two starts before and three after, machine load 9–18 on 12 cores, one sample): total GC pause per start 1539–1971 ms → 326–551 ms, worst `/health` wait over the first 40 s 684–1011 ms → 277–442 ms. `ThreadFeeds.openList` was not measured on this instance: it holds no threads there, and the "hundreds of milliseconds on any machine" goal is not met by this delivery. The remainder — hashing the bundle code itself — is removed by [[e645796e]].
