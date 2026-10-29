---
id: 01a1278d-8205-7cda-9971-7eb4b6306ce4
title: "Birth in place: spawn_agent project births a child with a home in another project, its placement, type, and scope"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1278d-b747-7ba6-92a3-34bd7c2c0f54",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
---
The spec's "Birth" section. Rests on the place contract [[37d7c9ad|place contract]] (`CallPlace`, `Place`, `place: true`).

Do: `spawn_agent project` carries the place through `BirthRequest`/`BirthInput` to both facet writers (`threads/harness/births.ts`, `native-harness/rows/native.ts`; the external child — `threads/birth/externalRows.ts`) and enters the birth digest (`packages/agent/src/collaboration/births.ts`). The child's home is the place's project; placement (`threads/harness/engine.ts`, `threads/birth/placement.ts`) resolves in it: the place's main checkout by default, `worktree: new` cut from the place's checkout; the parent's assignment, scope, and resources do not carry over. Type and profile come from the place's catalog (`ThreadTypes.resolve`). Depth, team budget, and delegation are lineage properties, with the ceiling at the team's root. A history fork does not make A's instructions effective in B. `gateProject` in `threads/birth/acts.ts` stops requiring parent and child homes to match; the thread/project pair check when addressing an existing thread stays (rule `30cfaf9e`).

Done: integration test — `spawn_agent project: B` births a child with home B, B's main checkout, and a type from B's catalog; its report reaches the parent in A; after a restart the child is in place.

## Delivery

`spawn_agent project` (name or id; `global` refuses `global-home`) is resolved by the kit port `CollaborationPlacement.home(parent, selector)` → `SpawnHome {projectId, parentProjectId, worktrees}`; `threads/harness/engine.ts` fills it. A project matching the parent's home counts as absent. Prepare on both doors resolves the home once and carries the id into execute (`bornElsewhere`/`bornAt`), so confirmation does not leave for another project. The id enters `BirthRequest.project` and the birth digest. Consent for `worktree: new` is taken from the child project's `agent.worktrees`. The `other-project` condition is declared in the kit (`@runlith/agent/permissions`): the native tool raises it in prepare, the operation via `place: true`.

The birth place is `BirthPlace` (`threads/contract/wire/birth.ts`): a root binding with an optional `projectId`, or a lone `{projectId}`. Both facet writers (`EngineBirths.record`, `ExternalBirthRows.child`) write the home from it. For a foreign home the parent's scope, archive, world state, and assignment do not carry over: by default the child stands in the main checkout, `new` is cut from the project's main checkout. Type and profile come from `ThreadTypes.resolve({project})`. The depth ceiling is read from the team root's project. A child born by fork into another home (`child.rehomed`) receives the system prompt anew. Retrying the same key for an external child also verifies the home. The first birth in a foreign place answers `law-unread` with the place's law (the place's performer, neighboring work).

Verification: `composition/testing/threads/birthPlace.stest.ts` (2 scenarios, ~3 s): home, type, report, `other-project` in trust, restart; worktree under B's policy with A=allow/B=ask. Fork into a foreign home verified by reading the chain, unmeasured by test. Code: `8bbe29c2e4`, `8d69db9628`.
