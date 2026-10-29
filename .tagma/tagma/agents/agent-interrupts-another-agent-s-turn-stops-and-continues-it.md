---
id: 01a14b6d-b1e8-7dc1-8401-d789cd950139
title: Agent interrupts another agent's turn, stops and continues its child's run
ord: 6
---
An agent takes another agent off the wrong path without losing its work: interrupts the running turn with a reason, stops its child's run, and resumes one that was cut.

**How.**
- `interrupt_agent` — one or several recipients: the current turn breaks off, the next turn opens on the reason. An agent that is not working is left alone. Reaches any agent except its own thread and its ancestors (`own-lineage` condition, the operator's question in review).
- `stop_agent` — stops the child's active run: the same act as the operator's Stop. The turn ends `aborted`; the run's foreground calls and foreground commands are lifted, the thread's background work and the transport process stay, the next word goes without a restart.
- `continue_agent` — opens one new run of the cut child (stopped, cut by a restart, or fallen) over the saved history and queue; the answer is the new run.

A CLI thread calls `interrupt_agent`, `stop_agent`, and `continue_agent` as operations over Tagma MCP.

**Limits and refusals.** `stop_agent` and `continue_agent` act on its own child; another's thread needs the operator's consent (`not-a-child` condition, asked from review mode), without it — `not-a-child` refusal. `continue_agent` refuses a running child (`thread-running`) and one whose last turn finished (`not-interrupted` — new work goes through `send_task`), and a transport without continuation — `transport-cannot`. A repeat under the same key answers with the same, a different meaning under the key — `key-reused`. A child stopped by the parent sends no report to it; neither does the interrupting agent get one.

**Links.** Reports; the operator does the same with its Stop, Continue, and `stop_run` / `continue_thread`.

Code: packages/agent/src/collaboration/sendTools.ts#sendTools, packages/agent/src/collaboration/CollaborationTools.ts#collaborationTools, packages/agent/src/collaboration/collaborationVerbs.ts#INTERRUPT_AGENT, packages/agent/src/collaboration/collaborationVerbs.ts#CONTINUE_AGENT, packages/agent/src/collaboration/reach.ts, packages/agent/src/collaboration/treeActs.ts, apps/tagma/server/src/threads/ending.ts
