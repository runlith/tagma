---
id: 01a14c14-6895-75c6-80f2-47b9a59ab4ef
title: "An agent command has a life: the agent and the operator shift it on a running command, and going past the ceiling asks the operator"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ba005523c3
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/LimitEditor.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/commands/acts.ts
  - kind: symbol
    ref: packages/agent-tools/src/CommandWork.ts
    symbol: COMMAND_LIFE
---
**Value.** A hung command does not load the machine forever, and honestly long work can be extended on the fly without restarting it.

**How.** Life in the `bash` call; `change_command_limit`; the clock button on a live command in the feed opens the life editor.

**Behaviour.**
- When life runs out, the command is killed, and the answer explains who set the limit and what to do next: give more, split the work, ask the operator to change the rule, or take a terminal.
- The change resolves against the deadline revision the caller saw: a changed revision answers with what stands now instead of overwriting another's move.
- Any project participant can shorten or extend up to the ceiling; the ceiling comes from the rule the command started under, or the command's longest life. Going past the ceiling is an exception with a reason, and for the agent it asks the operator.
- The whole life or the remainder from the current moment can be named; the remainder needs already running clocks.

**Limits.** Terminals have no life. An already finished command answers with its ending and decides nothing anew.
