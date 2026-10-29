---
id: 01a13f68-4ad9-7078-b46e-aa69e611e724
title: Fill ThreadRoots from Assignments, with no dependency on Placing
ord: 15
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13dcf-befa-7092-b69c-20473c961b0c
---
The `change-record/contract/service/threadRoots.ts` port gets the thread root through `Placing.rootOf`, though it only projects the live `selection.rootId` from `Assignments.read`. Move that projection to Assignments/workspace and wire it to ThreadRoots in composition; leave GateRefusal at the boundary where the caller needs it. Start with `threads/birth/placement.ts`, `threads/assembly.ts`, `change-record/record/feed.ts`, and `composition/testing/changesFeed.itest.ts`: the fixture currently builds a Placing with eleven dependencies for rootOf's sake. Done when ThreadRoots is served by the assignment owner with no Placing, live/non-live/null and the typed failure are kept, root changes after move are verified, and the changesFeed integration is green. This is separate workspace/change-record work, outside moving threads to Effect.
