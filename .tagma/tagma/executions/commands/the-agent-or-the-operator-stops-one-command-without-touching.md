---
id: 01a14c14-6895-75c6-80f2-47bda6e02fd0
title: The agent or the operator stops one command without touching its agent, and sees what the stop actually covered
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c2848a96fa
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/acts.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CommandActs.svelte
  - kind: file
    ref: packages/executions/src/stopLadder.ts
---
**Value.** An unneeded or hung command is removed on its own: the thread whose command was stopped keeps working and receives its outcome.

**How.** The stop button on a live command in the feed; for a queued one — dequeue; `stop_command`.

**Behaviour.**
- The stop runs down one ladder of the host: hang-up to the terminal or interrupt to the command, then terminate and kill to whatever still stands; the receipt names the step each process ended on.
- The answer is three groups: confirmed endings, resources left running, and unmeasured; only the first is completion.
- The reason is recorded as declared: an expired deadline is not passed off as someone's act.
- Destroy follows the same ladder but may drop output the kernel has not handed over yet.

**Limits.** Any command of its own project can be stopped; in review mode this asks the operator. An agent as a whole is not stopped this way.
