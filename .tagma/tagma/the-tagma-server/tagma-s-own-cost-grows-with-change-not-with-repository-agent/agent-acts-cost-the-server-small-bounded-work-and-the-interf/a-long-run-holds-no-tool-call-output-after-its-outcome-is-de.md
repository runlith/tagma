---
id: 01a19471-c11f-7184-8092-d9bf92fd4cda
title: A long run holds no tool call output after its outcome is delivered
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-941a-74d3-8eef-408e0480f0ac",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunState.ts
---
Section F of [[2afe6fec]].

Measured on the live server (instance `1e33b7f0`, build `head-20261031T174937279Z`, about 20 agents, 2026-11-01): between heap snapshots `600ef19b` and `8039e995`, 18 minutes apart, objects shaped `{call, ctx, hooks, name, readBack}` — the `TrackedCall` entries of `owned` in `packages/agent/src/agent/door/ToolExecution.ts` — grew from 817 to 1,570. One held a 2.8 MB tool output in `readBack`. `owned` and `costs` are cleared only on `ledger.onEnded`, so a hosted ACP run that lasts an hour keeps every call it ran.

`AgentRunState.records` likewise keeps every call's input and output for the whole run, and `upsert` scans the array on each write. In the first snapshot one record's `preview` was a substring view that kept its whole 3.9 MB source string alive.

Beside them `FiberImpl` grew from 878 to 1,127 fibers (17 → 35 MB dominated) and `ToolDefinition` from 6,832 to 9,377. Whether the same lifetime holds them is not established.

What stands when done:
- a call's tracked state and its output leave memory once its outcome is delivered and confirmed, keeping the read-back contract of [[2522c65f]];
- the run state keeps only what its rules read, within a bound;
- a preview never pins its source text;
- fibers and tool definitions of finished calls are released.

Done when a census after full collection over a long hosted run with many calls stays flat in these owners, measured through the real door, and the door's existing contracts stay green.
