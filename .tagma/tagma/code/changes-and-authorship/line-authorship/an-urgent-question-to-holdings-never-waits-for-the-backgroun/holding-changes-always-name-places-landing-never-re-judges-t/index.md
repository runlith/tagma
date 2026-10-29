---
id: 01a14c4e-7d20-7f6a-b9ef-01d723424bc6
title: "Holding changes always name places: landing never re-judges the whole checkout"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/service/held.ts
  - kind: file
    ref: apps/tagma/server/src/landing/contract/service/held.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/judges.ts
    symbol: judgedChange
---
Holding changes always name places: landing never re-judges the whole checkout.

At the end of landing, `discharged` (`landing/land/submit.ts`) calls the `HeldRows.moved(threadId)` port (`landing/contract/service/held.ts`) after `retirement.pass`. Composition fills it with a publication to `HeldFeed` without places: `markHeld` in `composition/http/handlers.ts` and `rows` in `native-harness/turns/context.ts`. `judgedChange` (`holdings/judges.ts`) answers a placeless change with `threadMoved`: `shift('all')` at every judge where the thread holds lines — a full re-judge of every held path of the checkout.

That publication is redundant. The port is only called once retirement has taken lines away, and `Retirer.leave` (`retire/driver.ts`, `told`) has already published every departed line with its place and holder. The thread's change feed, retirement and the text collector receive the same event from `told`. The extra publication only adds a full re-judge after every landing.

## Decision

- The port call in `discharged`, the `HeldRows` port in landing, and its wiring in both compositions are removed.
- The `judgedChange` branches for placeless changes are removed: `threadMoved` and `touched` by `rootId`. `Judges.touched`, which `moved` uses for a judge not yet open, stays.
- `HeldChange.moved` becomes required: a holdings change always names places.
- `threads.lifetimes.call(ctx.rows)` puts `ThreadRows` into the call context, but no code reads that tag. If the build confirms there are no readers, the tag goes with the `ctx.rows` wiring.

## Acceptance

- typecheck and the landing and retirement itests are green.
- After `submit_work`, `Holdings.judge` batches carry only the departed lines' places (`holdings.paths`); there is no full re-judge after landing.
