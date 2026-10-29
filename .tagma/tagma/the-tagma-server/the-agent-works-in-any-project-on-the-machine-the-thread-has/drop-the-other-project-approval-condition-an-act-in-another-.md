---
id: 01a13aea-805b-7b1a-af72-b2448607618e
title: "Drop the \"other project\" approval condition: an act in another project on the machine is judged by the mode just like at home"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ae2-2ed4-729f-980c-d5b67c7c396a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13ae2-e8d4-788e-a105-08a292d9ddaa
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
---
Operator decision: a registered project on one's own machine is not a risk boundary. Reading another project's graph (including global) asked in Trust; writing asked in Trust on top of the usual Review.

Do: remove `OTHER_PROJECT` from `@runlith/agent/permissions` and everyone raising or declaring it — `graphRaises`/`GRAPH_*_APPROVAL` (`graph/contract/wire/operations/shared.ts`), `placeApproval` (`platform/contract/wire/conditions.ts`, `invocation/registry.ts`), `otherPlace` (`invocation/admission/place.ts`, `approval.ts`, `nativeDoor.ts`), `touch_path.raises`, `spawn_agent` (`homeRaised`); the dead preparation `projectIds`; the `placeApproval.test.ts` test.

Done when: the server and `packages/agent` typecheck is clean, the affected tests are green, and reading and writing in another project under Trust goes without a question.

Landed: `320d2f7294`, `c73e521fd8`, `d17dfd1d48`. Typecheck is clean; the affected unit, integration, and system tests are green; `placeApproval.test.ts` holds the "place does not change the verdict" contract. Deliberately not done: a question opened under the old condition before the server update is not re-judged and stays pending until answered, as when a thread's mode changes.
