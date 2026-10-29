---
id: 01a1512b-cda7-7000-b4dd-66af4fadc5c0
title: "Delegation depth in the thread copy: Depth in the Team menu changes only this thread and its team"
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a150e6-3b13-7463-991d-5577e61d2614
  - kind: implements
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
---
`agent.subAgentDepth` has no thread layer, so in the Team menu the Depth line only shows the project depth and leads to Settings. Otherwise the menu edits only this thread and its team, and a stepper writing to the project would break that. Needed: add depth to the thread copy (`TeamLayer` from `packages/agent/src/collaboration/team.ts`) or raise a separate thread layer for `agent.subAgentDepth`. The spawn bound (`makeSubAgentDepths` in `threads/harness/state.ts`) must read the thread's copy of the team configuration before the project configuration, `promote_thread_team` must carry depth into the project, and Undo must return it. Then the Depth line in `TeamMenu.svelte` becomes a stepper, as in the mockup. Proof: an itest shows the child's spawn bound follows the thread copy; in the menu depth changes at one thread.
