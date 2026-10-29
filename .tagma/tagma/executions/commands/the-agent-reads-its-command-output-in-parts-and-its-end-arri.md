---
id: 01a14c14-6895-75c6-80f2-47bbffb12110
title: The agent reads its command output in parts, and its end arrives as a notification
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bc1f435015
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/output.ts
  - kind: file
    ref: apps/tagma/server/src/executions/commands/reader.ts
---
**Value.** A background command is not restarted for its result and not waited on by sleeping: the agent reads only what is new, and the command's end itself wakes the thread.

**How.** `read_output`; for an agent with shell it is a direct tool, and the notice of the command going to background prints its ready call.

**Behaviour.**
- The first read answers with the tail, each next one only with what arrived after the previous read; stdout goes before stderr, and the answer can be cut to the last lines. The chosen tail is read to the end across segment boundaries; UTF-8 inside it holds even if a character is split between reads.
- Reading a finished command that does not carry its whole output (not the first, cut by tail or window) names the file where the host keeps its output.
- The read answers at once and waits for nothing. If the thread read its command's end whole together with the checkout measure, no second notice of it comes.

**Limits.** Only its own project's commands are visible; observing another's command gives nothing over it.
