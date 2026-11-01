---
id: 01a19471-c11f-7184-8092-d9c0a990be94
title: Folded thread histories held in server memory stay within a resident budget
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-8e6b-7d29-8c7d-8b57bd55cb0a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/heldHistories.ts
---
Section F of [[2afe6fec]].

Measured on the live server (instance `1e33b7f0`, about 20 agents, 2026-11-01), heap snapshots `600ef19b` and `8039e995` 18 minutes apart:
- objects shaped `{stored, history, guidance}` — the `Held` of `native-harness/transcript/history.ts`, kept per unit in `foldsByUnit` and as `standing` in `HeldHistories` — grew from 43 to 85, 11 → 39 MB dominated;
- `HeldHistories` entries grew from 35 to 43, 27 → 32 MB;
- `HistoryIndex` grew from 0.6 to 9.4 MB.

Bun's snapshot records no edge from Map or WeakMap storage to its entries, so which holder keeps the 85 `Held` objects is not separated.

`HeldHistories` bounds 128 MiB of `JSON.stringify(message).length * 2`: an estimate of serialized size, not resident memory, and the weighing serializes each new message once more. Its `publish` also builds a Set of the whole history on each call.

What stands when done:
- every in-memory history holder declares a resident bound and evicts past it;
- a unit's folds leave memory with the unit;
- weight is known without serializing the message again.

Done when a census after full collection stays flat over a steady run whose threads together exceed the bound, and the history owner's contracts stay green.

## Outcome (`582431e21c`, `16722f218b`)

- **Which holder:** in snapshot `8039e995` the 85 `{guidance,history,stored}` objects are tops with no inbound edge, each exclusively dominating ~1.3 MB of messages. A `HeldHistories` entry reaches its standing by an edge, so they were values of `foldsByUnit` maps whose units stayed reachable after their work; a reachable unit also kept its completed after-commit tails, which capture the published history, and a write that never settled kept its claim until the unit's collection. Which caller retains the units was not established: in an N=10 ACP bench (finite turns, 300 s) units with folds stayed at 0–5 after full collection and the oldest lived 11 s, so the leaking path is outside that workload.
- **Fix:** the store ends every unit ([[cd6c3a69]]); folds, claims, reader placeholders and the unit's tail queues are released there. `HeldHistories` bounds 128 MiB resident, weighing messages from sizes their producers already know and updating a thread's weight by what changed ([[ac751462]]).
- **Calibration** (Bun 1.4.4, one 12-core 32 GB macOS arm64 machine): parsed messages cost 1.18–1.22 × serialized bytes for 2,000–8,000 text-heavy messages built from repository sources, 2.19 × for 20,000 messages of ~120 B; resident = 1.2 × serialized + 160 B per message fits both.
- **Proof run** (same machine, `agentLoad.bench.ts --agents=10 --warm=240 --seconds=300 --rate=4 --message-bytes=300000 --turn-min=20 --turn-max=50`, heap after `gcAndSweep`): histories reached 226.9 MB serialized (largest 32.1 MB). Exclusive `HeldHistories` retention was ~20 MB in 3 entries at the warm cut and 0.04 MB at the loaded cut; folded `Held` outside the cache was 35 B at warm and none at loaded. Total heap still rose 491 → 653 MB: `FiberImpl` dominators +31 MB and ownerless strings +167 MB, the running hosted runs' own histories, which no history holder retains.
- Tests: `heldHistories.test.ts` and the `history.itest.ts` unit-end case fail without the fix (checked by disabling each release) and pass on three seeds.

Open: running hosted runs keep their whole history resident and are not bounded by this cache; evicting such a thread forces a second copy ([[389d12ed]]).
