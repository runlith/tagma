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

A world process's children not on the list survive it. The first next run's `sweep` finds them: by the `RUNLITH_TEST_RUN` mark whose owner is dead, or by cwd inside a dead run root. An owner turned zombie counts as dead: otherwise a run starting before launchd reaped the worker would miss the survivor. macOS gives other processes no environment of platform binaries (`/bin/sh`, `/bin/sleep` and others signed by Apple), so such a survivor is visible to `sweep` only by cwd.
