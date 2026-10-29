---
id: 01a13219-0b79-7f64-9acd-32ab64adf15a
title: "The graph.recovery feed reopens ~1300 times a second: for a non-stealth project the stream ends after one element and the client opens it again at once"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13219-2e07-7c16-a179-6c062c403b33",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/Recovery.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/recovery.ts
---
The `graph.recovery` feed reopens ~1300 times a second without stopping: `RpcServer.graph.recovery` — 2.4–4.7M completions per hour on each holding hour (11.10 through 12.10, across server restarts), ~1 ms each and Success; followed by as many `invocation.admit`, `graph.resolveProject`, `Projects.byId`, `ProjectPolicy.read`.

Cause in code:
- `RecoveryServing.follow` (`graph/serving/recovery.ts`) answers a non-stealth-mode project (`here === null` or a team checkout) with `Stream.make({ recovery: null, … })` — one element — and the stream ends.
- The client `Recovery` (`app/src/lib/features/graph/Recovery.svelte.ts`) holds it through `Live.hold` with `ending: 'again'`: a finished stream that delivered an element immediately opens again (`Live.ts`, `attempt` → `attempt`), with no pause; the empty-answer guard does not trigger because an element was delivered.

To do: the feed lives while it is held — `follow` for a project without isolated recovery answers with one state and never ends. Check whether other feeds share the "one element and end" shape under `ending: 'again'`; where they do — the same root. If `Live.hold` with `ending: 'again'` can spin on any finite stream, that is the client-wire client's defect, fixed at `Live`, not with a consumer flag.

Landed as commit `a7d86cb7a0`: the recovery feed stays open in team/plain and switches the watcher on a storage-change event; Live repeats finished streams with a pause, a successful empty stream no longer drops neighbouring subscriptions. Recovery contracts — 4/4, Live — 6/6; review by Sol xhigh and two Muse xhigh finished, confirmed findings fixed. Full typechecks are not green: server — 2 errors in unrelated composition catalog files, app — 49 errors in 4 unrelated installation/chrome files; the changed files have no errors. The root speech lifecycle needs a separate fix — [[e06f769a|finished-listener feed task]]; finished snapshots keep delivering a changed Given with a pause of at most 1 s after the previous pass ends. No frequency drop was measured on the running server: the fix takes effect after an operator restart.
