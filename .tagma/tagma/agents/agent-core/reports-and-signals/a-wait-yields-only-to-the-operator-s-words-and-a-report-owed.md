---
id: 01a1355b-ce16-7ed3-920c-10e236195728
title: A wait yields only to the operator's words and a report owed to the agent; other signals wait for the next step
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent-tools/src/shellShapes.ts
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
---
A wait yields only to the operator's words and a report owed to the agent; other signals wait for the next step. Yielding means: a call that only waits ends with `wait-ended`, and a foreground command moves to the background; nothing is killed. Both cases are input the agent waited for: the operator addresses it, and a report answers work it gave away. A report arrives once per task, so repeated waiting after it is bounded by child count.

Agent messages, command-end notices, and other signals never yield the road: they are frequent, and waiting cut on each would make the agent wait in circles. When both words and a report arrive, the call is told the operator's words.

On a turn whose agent loop runs outside Tagma, only words and reports the transport already handed that turn's agent count (`TransportRuns.handed`). A word the agent will never see — withdrawn before handoff, a line waiting for the next turn, a vendor turn that does not read words mid-turn — never breaks the wait: otherwise the agent would cut waiting for words it never sees.

A line that only sleeps is refused by `bash` before launch: `sleep` with empty commands (`echo`, `printf`, `true`, `:`, `date`), no substitutions and no file write. It checks nothing and only holds the turn, while the turn end gives the same wait for free: any arriving input opens the next turn.
