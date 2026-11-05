---
id: 01a1a82f-0340-78dd-a5ec-36c6206cd24e
title: Linux birth intervals include both the kernel tick and the boot-clock sampling bracket
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/src/clock.rs
  - kind: file
    ref: packages/execution-host/native/src/lib.rs
  - kind: file
    ref: packages/execution-host/src/posix/linux/clock.ts
---
A process start is a boot-relative kernel tick, so neither a whole-second btime nor an unbracketed wall-clock subtraction can place it exactly. Preemption between clock reads can make the subtraction arbitrarily early. The native reader brackets each realtime reading with boottime readings and retains the narrowest sampled interval; the adapter adds that uncertainty to the start tick's interval. It answers an accounting interval only when the complete span proves inclusion or exclusion, otherwise unreadable. Display uses the lower estimate. A wall-clock step after the retained realtime sample remains outside this cached mapping's guarantee.