---
id: 01a18893-8a31-737e-bc5b-1d5b36acd5fa
title: Delegation depth set per thread from the Team menu, like the rest of the menu
ord: 23
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1512b-cda7-7000-b4dd-66af4fadc5c0
  - kind: relates
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
---
Everything in the composer's Team menu edits only this thread and its team, except Depth: `agent.subAgentDepth` has no thread layer, so the Depth line only shows the project depth and leads to Settings. A stepper there would write the project and break the menu's "this thread only" scope.

What it would take: depth in the thread copy of the team configuration (`TeamLayer`, `packages/agent/src/collaboration/team.ts`) or its own thread layer; the spawn bound (`makeSubAgentDepths`, `threads/harness/state.ts`) reading the thread copy before the project; `promote_thread_team` carrying depth into the project and Undo returning it; the Depth line in `TeamMenu.svelte` becoming a stepper as in the menu mockup. Proof would be an itest showing a child's spawn bound follows the thread copy.

Open: whether operators change depth per thread often enough to need it, or the project setting suffices.