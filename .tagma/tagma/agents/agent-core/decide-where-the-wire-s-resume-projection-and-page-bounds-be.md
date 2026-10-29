---
id: 01a0c959-540c-7d1b-964e-88be3d7b5f1f
title: "Decide where the wire's resume projection and page bounds belong: their floor is what keeps two of the kernel's three direction debts standing"
ord: 21
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: file
    ref: packages/agent/src/transcript/cap.ts
  - kind: symbol
    ref: packages/agent/src/thread/ThreadWireDeltas.ts
    symbol: threadWireDeltas
---
[[94d54cd1]] records the kernel's floor crossings as per-file debt: eleven files across three directory pairs. Two of the three are one unanswered placement question.

Both crossings are the same two exports of `protocol/resume.ts` — the resume projection `threadWireDeltas` and the page bounds in `protocol/cap.ts` — read from below. `ThreadAggregate.ts` calls the projection to serve `attachFrom`, which is the whole of the `thread/` → `protocol/` debt in the shipped sources. `ThreadSnapshots.ts` bounds its window and its turn-root walk by the page caps and computes live deltas through the same projection, which is the whole of the `thread/run/` → `protocol/` debt. Moving a type declaration down would not answer either, because what is read is a function and a pair of numbers, not a shape the wire projects.

The reading that settles it: `resume.ts` imports only thread-floor ports and transcript types, so nothing in it forces the harness floor — it could stand below the code that reads it. It sits with the wire because the policy is held to move when the client protocol moves — ownership the graph states, not necessity the code forces. Whether that ownership is still wanted is a product placement question, not something the code decides; no reading from below can answer it, and the zone cover met it twice from opposite sides without being able to.

The third debt, `thread/` → `thread/run/`, is a different kind and is not part of this question: it is gated on a refactor that has not happened — it dies "where the run machine becomes six owners and that service does not exist" — so it stands until that work is done, not until someone decides something.

Done when the two `protocol/` debt pairs are either retired by moving the projection and the bounds to the floor that is decided for them, or kept with the reason recorded as a choice rather than as an open debt (in the graph over this file, which now carries no prose itself) — and when claim 72838d25, which counts three standing debts, is corrected to whatever number then stands.
