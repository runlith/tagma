---
id: 01a140d2-b2f7-7eb2-abd0-3e6aeb838142
title: The holder on macOS judges BG by the requested external darwinbg, not by priority
ord: 8
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/native/holder/src/macos/sys.rs
    symbol: tempo
---
`tempo` compares the `PROC_FLAG_EXT_DARWINBG` bit from the same `PROC_PIDTBSDINFO` that proves birth against the target. That is exactly what `setpriority(PRIO_DARWIN_PROCESS)` sets and removes from another process, and XNU always makes an effective BG with I/O and network out of it. `pti_priority == 4` also happens under CPU-only suppression, and then lowest would answer Held without exhibiting BG. `getpriority(PRIO_DARWIN_PROCESS, pid)` will not do: XNU reads the caller's policy in it, not the target's.

A self-applied internal darwinbg the holder neither removes nor counts as its own.
