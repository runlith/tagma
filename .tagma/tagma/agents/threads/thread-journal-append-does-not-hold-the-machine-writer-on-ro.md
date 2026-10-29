---
id: 01a10284-da13-7e0c-9742-a42ac9c48cea
title: Thread journal append does not hold the machine writer on rollout file I/O
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe2273f0f381",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWriter.ts
---
**What.** A thread journal append does not hold the shared machine writer on rollout file I/O.

**Why (perf audit 2026-10-03).** `threads/journal/log.ts:49-117`: `append(event, tx)` inside an open machine write unit calls `floor.mint` (`rolloutWriter.ts:25-31,184-225,244-293`), which serializes the payload and awaits `open → writeFile → close` of the rollout file on every event; the first append also checks or creates the file and restores the tail. One thread's disk extends the hold for all agents. Before a tool call `runStepTools` awaits durable `commitEffects` (`packages/agent/src/agent/turn/tools.ts:94-108`), so the tail lands on the agent's critical path.

Measured (instance 57f3a082): `Store.permit.wait` for `ThreadStore.kernel` — 7456 ms (`b26affbebcaf8c40`) and 7200 ms (`bb2462b51d417808`), for `ThreadRunStore.patchRunning` — 7463 ms (`c00ee96cbaed5922`); `planStep 6cfd5a222b6e8962` — 5000 ms, of which writer wait 1516 ms, execute 1321 ms, `ThreadStorage.append` 906 ms with no child spans. Append p50 ≤1 ms, p99 ≤256 ms — the problem is tail. The file I/O share is unmeasured. The shared mechanism is S5 in [[c6c8ba34]], the file/SQL seam S4 in [[5610ee2b]].

**Direction.** First give append child spans (encode, file, SQL). Then split the ordered durable rollout append and the short SQL projection so encoding and file writing run outside the machine writer. The journal stays the source of truth; keyed replay, version check and recovery stay — no fire-and-forget.

**Done when.** No rollout file I/O runs under the machine writer; a failure between file and SQL writes is recovered by the same recovery (contract test); spans show writer wait, encode, file and SQL separately.
