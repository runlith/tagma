---
id: 01a1892e-55e3-7a79-94fc-0f2544e425d4
title: Plugin end hooks reach only threads that ran natively since the server started
ord: 65
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/pluginHooks.ts
---
A hook runs with the thread's working directory, and only a run knows it: the world a thread stands in is resolved when its turn opens. So the plugin hook rule remembers each thread's project and place when its rules first run, and the archive and delete events of `ThreadRecords` (`shelfRecorded`, `removalRecorded`) end exactly those threads, once. A thread archived or deleted with no native run in this server's life fires no `SessionEnd`; resolving a world just to tell a plugin it ended would cost more than the hook is worth, and adding an ending port to `threads` would put a plugin concern into a lower module.

`SessionStart` is the mirror: the first step of a thread's first run, told apart by the thread's history holding no answer of the model. The run's own view of the transcript cannot tell it: a native launch reads only the entries of the run it opens. A continued, recovered or forked thread already holds an answer, so it is not started again.