---
id: 01a122eb-4ac5-7373-8592-79ccb406e324
title: A child agent takes its own model switches (Fast included), and spawn_agent can name them explicitly
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1228a-efcd-745e-8fdc-e3aa9f4403c1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12290-5778-7136-b392-919d416cb6e8
sources:
  - kind: file
    ref: packages/agent/src/collaboration/modelChoice.ts
  - kind: file
    ref: packages/agent/src/collaboration/native/threads.ts
---
Operator: if Sol has Fast on, agents started on Sol also run with Fast; and a direct ask — "start Sol without Fast" or "with Fast" — decides that one launch.

Done: `spawn_agent` (the native tool and the operation) has `switches`. `askedSwitches` in `collaboration/modelChoice.ts` checks them against the model chosen for the child; a switch or value the model does not offer refuses with `switch-unoffered`. One owner assembles the child's final switches, `bornSwitches` in `collaboration/native/threads.ts`, in this order: first the operator's standing choice for the child model, over it the parent's switches when the child runs on the same model, and on top what the launch named. The `inherited` flag on `ModelSwitch` is removed: the rule is now one for all switches.

Proof: `ThreadSpawnBirth.test.ts` (inheritance on the same model, the standing choice for another model, explicit override, refusal), the whole `packages/agent` test set, typecheck of llm/agent/server/app.
