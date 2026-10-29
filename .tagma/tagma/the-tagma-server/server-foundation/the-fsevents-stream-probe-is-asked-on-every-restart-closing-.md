---
id: 01a14178-3a0a-703c-8270-f5d8b2fb89d9
title: "The FSEvents stream probe is asked on every restart: closing a group costs three stream rebuilds instead of one"
ord: 20
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1415a-e83c-72af-8b27-acb829207044
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/restarts.ts
---
Every watch-group open or close reports `restarted()` (`platform/watch/tree.ts`), and it immediately asks the probe (`restarts.ts` → `live.ts ask`): it closes the former probe watcher and opens a new one. On Bun on macOS that is two more rebuilds of the shared FSEvents stream per close, and the JS stream waits each out under the CF-thread mutex. In the operator's 15 October server-stop stall profiles (`read_performance` stall 815df620: 3.5 s) almost all the time stood in `live.ts retire → close` and `ask → watch`, not in closing the groups themselves.

Process departure is past this ([[a315b656]]), but in work the same price is paid on every close series — worktree removal, graph eviction from the pool, surface unsubscription from many checkouts: N closes give 3N rebuilds and N probe cycles instead of one.

What to do: ask the probe once per series — when the series falls silent — while keeping the proof from [[0a116765]] (a probe event comes only from the stream assembled after the series' last restart). Proof: measuring a series of N closes before and after (rebuild count by `streamRestarts`, close time), and `restarts.test.ts`/`live.itest.ts` on the same rescan contract.
