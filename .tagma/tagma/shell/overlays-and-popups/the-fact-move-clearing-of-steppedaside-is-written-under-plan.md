---
id: 01a0c858-ca90-7fab-b868-240476e05b3b
title: The fact-move clearing of steppedAside is written under plan and thrown away by its own result
ord: 21
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a8f7-73a5-b243-ee70026e29b7
sources:
  - kind: symbol
    ref: packages/primitives/src/overlay-plan.ts
    symbol: plan
  - kind: symbol
    ref: packages/primitives/src/OverlayQueue.svelte.ts
    symbol: outsideChanged
  - kind: symbol
    ref: packages/primitives/src/OverlayQueue.svelte.ts
    symbol: runPlan
---
`overlay-plan.ts` states the protocol's intent beside `steppedAside`: a request that gave the screen up "does not candidate again, or policies naming each other in a ring trade the screen forever. Cleared by the driver when a fact moves or a request arrives, leaves or reopens." The driver does attempt the fact-move half — `readFact` calls `outsideChanged()`, which rebuilds `this.history` with an empty `steppedAside` — but that write is discarded, so only the arrive/leave/reopen half actually clears.

**Why it is discarded.** `plan()` snapshots the set on entry — `const steppedAside = new Set(history.steppedAside)` — and every exit returns that local copy inside `finish()`. `readFact` is the callback `plan` invokes *during* that call, so its `outsideChanged()` mutates `this.history` while `plan` is working from the argument it was handed. When `plan` returns, `runPlan` does `this.history = result.history` and overwrites the cleared value with the set that was copied before the fact was ever read. There is no path by which the mid-plan clearing survives the assignment.

**What it costs.** A fact moving is exactly the change that is supposed to let everything which stepped aside ask again. Without it, a request that yielded the screen stays out of the candidate list until some request arrives, leaves or reopens. So when a blocker rises and takes the promoter off screen, a waiter that stepped aside for it is not reconsidered and the screen can sit empty with a request that could fill it sitting suspended — the state the whole `steppedAside` mechanism exists to leave, once, rather than to persist.

The queue's own suite does not catch it: `OverlayQueue.test.ts` carries comments describing the intended recovery ("lets the snack bar back", "raised once … while the dialog was blocked") but asserts the final frame and a bounded raise count, both of which hold either way.

**Where to fix it.** At the producer, which is the seam between the driver's memory and the planner's: either have the driver clear its own `steppedAside` before calling `plan` — so the cleared value is what `plan` copies — or let the fact reading report the move back through the result rather than by writing `this.history` under a call that is about to overwrite it. Do not fix it by reordering the assignment in `runPlan`: the returned history also carries `promotingId` and `cooling` that the pass legitimately updated, and dropping those to save the set would trade one defect for two. Whichever way it goes, a test must fail first on the empty-screen case above, since the present suite passes with the defect in place.
