---
id: 01a1a80b-8e9a-7e0d-a391-a0dac40ff196
title: Unbounded kernel limits remain absent instead of becoming numeric capacity
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/src/limits.rs
  - kind: file
    ref: packages/execution-host/src/posix/ProcessAbi.ts
---
An unbounded resource is not a finite capacity measurement. The native boundary represents that distinction explicitly, and the host decoder preserves it as absence; any other ceiling must remain exactly representable so a capability profile never rounds an unknown bound into a promise.