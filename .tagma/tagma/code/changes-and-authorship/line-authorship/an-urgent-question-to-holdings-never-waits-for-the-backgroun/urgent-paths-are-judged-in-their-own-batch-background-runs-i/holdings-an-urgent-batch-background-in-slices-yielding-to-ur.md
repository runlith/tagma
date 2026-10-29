---
id: 01a14c4e-7d20-7f6a-b9ef-01db395d6de3
title: "Holdings: an urgent batch, background in slices yielding to urgent work, a worker only for now, each batch its own trace"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c20-33ed-7ba1-8f9f-0c865b054f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c4e-7d20-7f6a-b9ef-01d649c55a3e
---
Build [[49c55a3e]]: urgent paths are judged in their own batch, background runs in slices that yield to urgent paths between paths, the `Walks` pool keeps a worker for `now` only, and `drain` forks without a parent span.

Start from `next`, `judge` and `answer` in `holdings/judge.ts` and from `Requests` in `holdings/requests.ts`: the remainder paths of an interrupted slice need their waiters returned to the queue instead of a `null` answer. Pool — `poolSize` and band choice in `lines/walks.ts`.

Proof:
- the spec's two acceptance itests;
- a bench with numbers before and after;
- a memory measurement of the added worker.

## Result (f527c7b900)

Measured on the operator machine, one sample, 2026-10-18:
- bench `holdings.bench.ts`: an urgent path answers in 46 ms at 500 background paths and 63 ms at 5,000; the whole background takes 0.45 s and 2.76 s. Before the change an urgent path fell into the same batch and waited for all of it — roughly the whole background; concluded from code, the old code never ran.
- the added worker at rest: +16–19 MB RSS (three runs).
- the Holdings itest on a paused background fold and the walks itest for the reserve worker are green; 169 change-record and landing itests are green.

Not proven: that a file in Changes opens in fractions of a second under load — that is the operator's check.
