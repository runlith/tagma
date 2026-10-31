---
id: 01a19256-aeb7-7a68-a95c-b37109d1b3f5
title: The window declares its processes with a creation-time precision measured against the kernel's start
ord: 40
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/declared.ts
---
The server turns a declared pid into Tagma's own process only when the kernel confirms that exactly one process of that pid started within `precisionMs` of the declared `createdMs`; a pid reused by a stranger must fail this test. So the window sends the precision it can vouch for, and it stays far below the shortest span in which an OS can reuse a pid.

Measured on macOS arm64, Electron 44.8, 2026-10-31 (one machine): six processes per launch (main, GPU, a utility, three renderers) over four launches, Electron's `creationTime` against the kernel's `proc_pidinfo` start (`PROC_PIDTBSDINFO`, microseconds) differed by at most 0.49 ms — the rounding to a whole millisecond the declaration applies. Electron reads the kernel's own start there. macOS therefore declares 10 ms. Linux and Windows are not measured; they declare 1 s until someone measures them, and the figure is a guess, not a result.

`desktop/src/declaring.e2e.ts` checks every declared process of a launch against the kernel's start on macOS, so a constant the real Electron breaks fails there.