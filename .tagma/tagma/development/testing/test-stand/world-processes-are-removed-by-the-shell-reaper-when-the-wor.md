---
id: 01a16b72-6cb2-7d75-a632-ed40cb987f4b
title: World processes are removed by the shell-reaper when the worker's stdin closes, and what survives the exit is found by the next run's sweep
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/watch.ts
---
Bun reports no worker end: preload hooks walk every file, and the `exit` handler never runs when the worker is killed by signal or crashes. So the pid holding the world (`hold` from `@runlith/testbed/fixture`) is written into one `/bin/sh` stdin per process; when the worker leaves any way, the kernel closes this pipe and the shell kills everything on the list. Held processes and their descendants are not judged by the guard at the file's end. A shell that left before the worker (exit or EPIPE on write) is replaced by a new one handed the whole held list: otherwise writing into a dead pipe dropped the file's verdict, and what was held after that nobody removed.

The shell kills each listed process together with everything below it in the process table at that moment, including children that took a session of their own. The same closure follows every kill of the testbed: the file-end verdict's leftovers and the `sweep`'s stranded processes. A native holder's commands are the case: each runs in a session of its own, so once its holder is killed they are reparented to launchd, and as platform binaries (`/bin/sh`, `/bin/sleep`) they show neither a mark nor a cwd to any later reader — the closure has to be taken before the parent is killed.

What is on no list and below no killed process survives the worker. The first next run's `sweep` finds it: by the `RUNLITH_TEST_RUN` mark whose owner is dead, or by cwd inside a dead run root. An owner turned zombie counts as dead: otherwise a run starting before launchd reaped the worker would miss the survivor. macOS gives other processes no environment of platform binaries, so such a survivor is visible to `sweep` only by cwd. The kernel reports a cwd by its real path (`/private/tmp/...`) while the run root is spelled `/tmp/...`, so a cwd is matched against both spellings of the root; matching only the spelled root never found a process on macOS.
