---
id: 01a1a82f-0340-78dd-a5ec-36c6206cd24e
title: A Linux birth is placed to its kernel tick from the exact boot instant
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/linux/clock.ts
  - kind: file
    ref: packages/execution-host/native/src/clock.rs
---
The kernel keeps a process start as boot-relative clock ticks (`USER_HZ`). `/proc/stat` `btime` floors the boot instant to a whole second, so a birth derived from it reads up to a second early, and a question about a past instant gets a definite wrong answer: a reused pid born just after a restart was accepted read as the predecessor. The native library therefore reads the boot instant as `CLOCK_REALTIME` minus `CLOCK_BOOTTIME`, and the reader treats a birth as the tick-wide span it may lie in. A span wholly inside or outside an interval answers; a span straddling a bound answers unreadable, which every consumer takes as unknown rather than as born or not born. A wall-clock step after the reader loads shifts derived instants by that step.