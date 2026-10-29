---
id: 01a128d0-ffef-741a-a456-1aeb87d3c468
title: Fork CPU tempo is measured by live threads' base priority, not by the task summary
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/testing/tempo.ts
---
At fork creation macOS inherits the effective QoS, but `proc_taskinfo.pti_priority` may still hold the task's initial value instead of the threads' effective priority. So the adapter's testing entry reads the base priority of all listed live threads; an empty, partial, or changed sample is a read refusal. Priority 4 alone does not prove Darwin BG: XNU also sets it under CPU-only suppression, with no BG for I/O and network. So `background` additionally requires the requested darwinbg from `PROC_PIDTBSDINFO.pbi_flags` (`PROC_FLAG_DARWINBG | PROC_FLAG_EXT_DARWINBG`, `proc_get_darwinbgstate`): XNU always turns that request into an effective BG with I/O tier and background sockets. `getiopolicy_np` won't do for this: it answers about the caller's requested I/O policy, not the target's.
