---
id: 01a1526d-9614-7c6d-95c8-3d4f4a12819d
title: "First step after restart does not recompute the prefix chain digest: the chain lives in the history row"
ord: 35
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a15242-d7b8-75cd-adc7-b2b5b5059c61
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
---
After [[eeb8d7a5]] every history message arrives with a stored digest and price, but on the first step after a restart the meter still rebuilds the prefix chain digest: sha256 over every message in JS, in one synchronous pass. Per the [[b5059c61]] measurement that is 21–27 ms CPU per 10,000 messages on an M2 Max and, by estimate, 65–110 ms on a weak machine — above the ~50 ms of [[7a910861]]. Every resumed thread pays it, all at once after a restart.

Do: compute the chained prefix value (digest of everything up to and including this message) at write time for new rows only, and store it in the history row next to digest and price (ADD COLUMN nullable, rule d81b1676). The meter takes the stored chain of the last message and reads only the tail without one. Full chain recomputation stays for rows written before the migration and after a form step that changed the message.

Proof: a counter — after reloading history from the store the first step computes sha256 for no message carrying a stored chain, and the meter answer equals the answer over a recomputed chain.

## Pre-build measurement (2026-10-19)

The task premise did not confirm. The probe was removed after measurement. Machine — M2 Max, one sample, load average ~17–20.

- On the server `@runlith/utils/sha256` resolves to `sha256.node.ts`, i.e. native `createHash`, not JS. The prefix chain is one 64-byte `update` per message: 10,000 messages take **0.35–0.5 ms** (`join` and hashing together).
- The whole first `requestHashed` of a fresh meter over 10,000 messages with stored measure costs **~2 ms** wall and CPU once the code is JIT-warmed. The first call in the process costs 13 ms wall and 18 ms CPU: that is JIT warmup, paid once per process, not per thread. The earlier 21–27 ms is the same single cold call under load.
- The stored chain cannot be continued from a hex value: native `Hash` exports no midstate. So the chain definition would have to change to iterated `c_k = sha256(c_{k-1} ‖ d_k)`. On cold paths (prefix rebuild after folding, old rows) that costs 3.7–5.7 ms per 10,000 messages instead of 0.4 ms — 10x more.

Outcome: storing the chain saves ≤0.5 ms per 10,000 messages (estimated ~2 ms on a weak machine) and makes folding more expensive. Proposal: close the task unbuilt; the lead decides.
