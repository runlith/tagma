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
    ref: packages/agent/src/agent/AgentRunState.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
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

Done when a census after full collection over a long hosted run with many calls stays flat in these owners, measured through the real door, and the door's existing contracts stay green. The short final-code real-door sample used `agentLoad.bench.ts`, two hosted ACP agents, 20 s warm-up and 120 s load, rate multiplier 5, no subscribers and no seeded history, on macOS arm64/Bun 1.4.4. It completed 120/120 window calls without failures. Across its full-GC cuts, recorded completions were 18→149; tracked calls and ledger memos were 0→0, run payload records 0→0, ToolDefinitions 564→564, and all FiberImpl nodes 240→249. Global heap still rose 149,999,926→163,089,174 B, so this establishes the call-owner release, not a whole-server plateau. The earlier rate-20 pre-fix cuts held 58→325 tracked calls, 116→650 ledger memos and 58→325 run payload records. The first post-fix rate-20 arm accumulated request backlog and cannot establish comparable throughput. A separate frozen-worktree A/B/A used code `dc53b52c`, two agents, rate multiplier 20, 15 s warm-up and 60 s load with no snapshots: original A1 completed 179/241 window submissions under load average about 20, changed B completed 241/240 with outstanding 1→0 under load about 11, and original A2 completed 237/240 with outstanding 1→4 under load 10.8→19.4; all had zero failures. B versus A2 differed by four completions, 1.7%, rather than reproducing the earlier drop. These are single shared-machine samples, not a controlled capacity estimate. B predates the review corrections confined to parked adoption and native replay counting; the workload exercises ordinary hosted calls. Both review defects were separately reproduced and corrected through the door tests.
