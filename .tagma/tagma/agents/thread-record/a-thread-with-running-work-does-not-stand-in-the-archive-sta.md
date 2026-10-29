---
id: 01a11267-f36e-7af6-a2c1-66b3f1e01bec
title: "A thread with running work does not stand in the archive: starting a run or a session lifts the archive mark with the same write"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/threads.ts
  - kind: file
    ref: apps/tagma/server/src/thread-record/status.ts
---
The `archivedAt` mark means the thread is put away and no work runs in it, and so it is read. Executions refuse such a thread ownership of a new command and terminal custody (`live` is the mark's absence), the change record stops counting it a live holder of retained lines, the agents directory and `wait_agent` read it as a finished address.

So the mark and work do not stand together. `archive_thread` stops the runs and the CLI under the thread before setting the mark. Starting admitted work lifts it with the same write that opens the run (`runningRunId`) or moves the status to `running`: otherwise a new command or landing gets `terminal-no-owner`. The scheduler holds an archived thread's automatic messages and tasks in queue until its explicit return ([[e35a759f]]).

One exception by the archive's own grammar: an agent's run that puts away its own line runs to the end already under the mark.

A thread that returned on its own leaves the archive group. If a run returned the group root, `archive_thread archived: false` on that root returns nothing more, and those put away with it return one by one.
