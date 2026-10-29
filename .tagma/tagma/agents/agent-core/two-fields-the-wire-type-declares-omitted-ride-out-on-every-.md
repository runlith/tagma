---
id: 01a0c98b-8821-7af8-97a0-6ef8ba48beac
title: Two fields the wire type declares omitted ride out on every serialized run, and the exactness gate cannot see it
ord: 123
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/protocol/http.ts
    symbol: SerializedThreadRun
  - kind: symbol
    ref: packages/agent/src/protocol/http.ts
    symbol: serializeRun
  - kind: symbol
    ref: packages/agent/src/thread/rows.ts
    symbol: ThreadRunRow
---
`SerializedThreadRun` declares twelve fields of the run row omitted from what crosses to a client. `serializeRun` destructures five of them out — the approval mode, the interactive flag, the settled-notified instant, the stream tail and the resume count — overwrites the five date fields with ISO strings, and spreads the rest. `handedOverAt` and `settledNotifyAttempts` are in the omit list and not in the destructure, so they ride out in the spread on every serialized run.

Nothing catches it. The exactness gate beside the type compares the declared shape against the row's type, not the value the function builds, so the gate passes while the payload carries two fields the type says are absent. Both are JSON-serializable — a `Date` and a number — so they reach the client silently rather than failing on the way out.

What leaks is crash-recovery bookkeeping: when a run was handed from one process to another, and how many times this host has tried to publish its settlement. A reader is told none of that exists, and a client built against the declared type will neither expect nor ignore it. The cost is not that the numbers are secret; it is that the wire's declared shape and its actual shape disagree, which is the one thing a wire type exists to prevent.

Done when the function omits exactly what the type omits, and whatever is added to that omit list next cannot be forgotten in the destructure — the gate comparing the built value rather than the row's type would be one way, and is worth weighing against simply keeping the two lists together.
