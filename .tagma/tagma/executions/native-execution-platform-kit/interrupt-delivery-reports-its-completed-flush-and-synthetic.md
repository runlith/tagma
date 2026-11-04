---
id: 01a128f3-2660-7b02-bb52-7f08834c93bc
title: Interrupt delivery reports its completed flush and synthetic echo boundary
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a128f3-3e3d-7ac0-9b34-2d2b06237037
  - kind: relates
    to: 01a1a893-53a7-73ab-a1d6-7674dd7fcc6e
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: file
    ref: packages/execution-host/native/src/macos/terminal.rs
  - kind: file
    ref: packages/execution-host/native/src/linux/terminal.rs
  - kind: file
    ref: packages/execution-host/native/src/control.rs
---
A master write accepted by Linux can remain behind full slave input, and TIOCSIG itself does not flush the line discipline. The native adapter owns the delivery choice: macOS retains its write-first path; Linux signals directly and explicitly flushes the slave when NOFLSH is off. A completed flush is reported even if later signalling fails, so accepted paste is abandoned at the actual delivery boundary. A signal without kernel echo is paired with a snapshot of queued readable output; synthetic echo follows that boundary, respects ECHOCTL and is absent under EXTPROC. Bytes already read ahead remain owned output rather than being discarded by a later kernel flush.