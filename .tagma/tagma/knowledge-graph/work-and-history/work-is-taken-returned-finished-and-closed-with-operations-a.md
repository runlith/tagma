---
id: 01a14bc5-0df5-77c8-b1a2-693cdef49593
title: Work is taken, returned, finished, and closed with operations, and the holder is written in the node
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/shared.ts
    symbol: HELD_ELSEWHERE
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/work.ts
    symbol: WORK_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/ending.ts
    symbol: tasksLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/holding.ts
    symbol: taskHolding
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/workBehaviours.ts
    symbol: holder
---
**Value.** The graph shows who does what: work is taken, returned, and finished with operations, the holder is written in the node, and the end keeps author, cause, and commit. Parallel agents never do one job twice.

**How.** `claim_block`, `release_block`, `finish_block`, `close_block`, taking at block birth, and the same verbs in `apply_batch`; thread birth onto work — `create_thread` with `work`; in the app — the status chip and block menu, where work offers "Start agent on this".

**Behaviour.**
- A node with a holder-carrying tag can be taken. Retaking your own work changes nothing.
- Work held by another session can be intercepted, returned, or finished. Such an act carries the "held by another session" fact, and in review mode the operator sees whose work is touched.
- Work taken from the app or CLI is held by the operator.
- A thread born onto work takes it in its own name in the same act, before its first turn; someone else's taken work is intercepted the same way as `claim_block`. When it cannot be taken, no thread remains.
- An end comes in two kinds: "done" (the work happened) and "closed" (dropped, answered elsewhere, or no longer needed). A node nobody holds ends at once.
- A spec or task with open child work never ends until that work ends. The gate stops an agent, while the operator passes it with a separate call and in a batch.

**Limits.** Replaced work is neither taken nor finished. A node with no lifecycle never ends.
