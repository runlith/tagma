---
id: 01a1696f-9c19-712f-abc1-abc6d5c27a25
title: "A thread does a job later at the user's word: in N minutes, tomorrow, on schedule"
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14a56-2822-7be5-9132-c1c5ecff045e
  - kind: relates
    to: 01a1233a-897c-783a-afb3-103fd50acfdc
---
**Question.** Does a thread need to do work later at the user's word: "find X in half an hour and write to me", "check tomorrow morning", "do Y every day at 9".

**Motivation.** An agent works only while its turn runs. It has nothing to defer work with by time: `bash` refuses a command of one `sleep` (`sleeps-only`), and rightly — sleep holds the turn and is not interrupted by a user message. Without a door only bypassing the guard remains, as in [[ecff045e]].

**Three different cases.**
- "When it finishes — write" already works without sleep, when the process was launched by the agent itself: the command or background-call end notification that wakes the thread, `wait_terminal`, the child's report. Not part of this idea.
- "In N minutes do X" — a one-time timed assignment.
- "Every day", "tomorrow", a chain by time — a repeating assignment.

**The shape, if built.** At the user's direct request the agent sets the thread an assignment: a time or a grid and what to do — and ends the turn; nothing holds the machine. In time the server opens the thread's turn with that assignment. The assignment is visible in the thread, can be cancelled, survives machine sleep and server restart. The foundation is the "Schedule" module ([[d50acfdc]]): it already wakes by time and does not accumulate missed ticks, but currently only owners — modules and plugins — declare schedules, not the user through conversation.

**Boundary.** The guard against useless sleep stands: the agent resolves its own waits by fact — an answer, a process exit, an event — and by time only at the user's request.

**What will decide the choice.** How often users ask for deferred work; the assignment's place in the thread interface; what to do with a thread's assignment whose moment arrives while it is busy or archived.
