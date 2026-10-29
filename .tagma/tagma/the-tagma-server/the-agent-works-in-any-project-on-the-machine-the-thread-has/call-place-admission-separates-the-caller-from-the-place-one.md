---
id: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
title: "Call place: admission separates the caller from the place, one place field on all doors, the native call carries the place from prepare to read-back"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12726-f0e8-7337-8d27-3d0fd0cb3795",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: dir
    ref: apps/tagma/server/src/invocation
  - kind: file
    ref: apps/tagma/server/src/cli/mcpTools.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/place.stest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/journal/callRange.ts
---
Implemented: the spec's "Invocation", "Native door", and "One place semantics on all doors" sections. The actor's home, authority, and `Caller.files` stay; the chosen place defines the call's services. A place/subject contradiction yields `place-mismatch`; a foreign project yields the single `other-project` condition.

## Common place contract

`CallPlace` is a `Context.Reference<Place | null>` in `platform/contract/service/place.ts`; `Place` in `platform/contract/wire/place.ts` carries `projectId`, `checkout`, and `branch`. `checkout` addresses the graph copy; `CallerWorkspace.root`/`origin` is the physical workplace. Invocation assembles `CurrentProject`, `GraphCall`, `CurrentGraph`, `ServedTree`, `ChangeScope`, and `CallerWorkspace` for the place; actor, `SignedSession`, authority, and scratch stay home.

An operation takes an explicit selector via `place: true` and input `project: string | number`. Admission normalizes transport and payload before prepare. `Bound.place(input, caller)` declares the subject; the graph uses one locate and a per-call crossing context, and the name/id/`global`/`tagma` selector belongs to `graph/serving/selector.ts`. An input `bodyFile` or batch file is read in the caller's scope and selects no place. For files, `Operation.filePlace` uses `ChangeTarget` from `@runlith/files/change`: resource for contents, entry for directory records; `PermissionSubject.entry` keeps this runtime-tool semantics.

Native preparation holds the chosen context until execution. For mutations and settle operations the physical place is stored by `(threadId, operation, key)` in the machine store; a repeated preparation does not redirect the key to another subject or checkout, and settlement reads the stored place's journal. Read-only preparation without settle opens no writer receipts. The home workspace is preserved when restoring the same place.

## Delivery check

`composition/testing/place.stest.ts`: 4 scenarios passed in 22.58 s — native/CLI/MCP proxy select B, explicit mismatch keeps the typed refusal, B is isolated on create/batch/cursor, a new catalog reads the lost response and refuses the changed subject of the old key. `placeApproval.test.ts`: trust/review require approval of a foreign project, bypass and the home act pass. Narrow typecheck of the `perform`, `nativePlace`, and `admit` owners passed; the full typecheck is unproven due to SIGKILL and unfinished neighboring changes. Enforced rules found no violations over the delivery.

Independent Sol xhigh and Opus high read the delivery; confirmed findings were fixed at their owners. The full MCP stdio wire, a physical server restart, and a worktree switch after approval were not measured with this set. The operator's running server was not restarted.

Code: `d50483167d`, `47ac10b3b2`; receipt migration: `17af3a7412`. The system file also carries the contribution of graph task `02cc739d52`.
