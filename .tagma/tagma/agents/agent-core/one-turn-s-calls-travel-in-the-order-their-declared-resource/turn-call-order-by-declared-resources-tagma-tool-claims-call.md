---
id: 01a15122-0429-71e2-a251-d21e7667839d
title: "Turn call order by declared resources: Tagma tool claims, CallOrder for native and hosted, the \"queued · after\" feed lane"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15100-0c57-718e-a62d-8c7a5883e1bf",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15113-e4c9-763e-bcc6-16a807c34834
sources:
  - kind: file
    ref: packages/agent/src/agent/turn/tools.ts
---
Full spec [[07c34834]] implementation: `Tool.claims` and a `mutates`/`effect`-based default only for Tagma tools and operations (MCP and plugins do not take part, rule [[7a4ff805]]), exact claims from owners per the spec table, `CallOrder` instead of `pendingWrites`/`hostedOrder`, a dependent's preparation in its own turn, a same-batch refusal with the resource, `after`/`waitedMs` in the call record and feed, a `tool-ordered` note, removal of the bypass from the `artifacts` skill. The model still emits all calls in one turn; order lives inside the server. Proof is the spec's acceptance criteria.

Result (commit a6831a3d6e). Proven: criterion 1 — `AgentStepOrder.test.ts` and `ToolExecutionCalls.test.ts`; 2 — `preparedSubjects.itest.ts`; 3 partly — `native-harness/skills/stepOrder.itest.ts` in one turn with real tools: published bytes equal recorded ones (without claims at `publish_artifact` the test is red three of three), `cat` sees the `edit`, `write fromFile` after the source `write` passes without `file-changed`; 4 — `hostedCalls.ts`; 5 — `operationWrites` in `cli/mcpTools.ts`, the old catalog test green; 6 and 8 verified.

Unproven: `[write X, create_block bodyFile X]` in a project with another root and in global — no server itest with graph operations written, `read(all)` at `GRAPH_ACT` holds the order; price numbers (criterion 7) — no `tool-ordered` notes yet, the operator's server unrebuilt. `glob` and `ls` claims stand uncommitted inside another cursor move (session 01a15122-6a81-7159-9f97-466209423a9c); until their commit both tools travel the `read(all)` default.
