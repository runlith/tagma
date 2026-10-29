---
id: 01a12801-198f-7f6e-8cb8-98d2fb1dffee
title: The unread file keeps the last observation of a hook-queue read failure
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a127ef-4a2f-7da7-a56a-051ed17b7667
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/pendingWrites.ts
    symbol: keepUnreadOp
---
`capturedAt` bounds the evidence to the moment the hook-queue read failed; restored access does not cancel that fact. The current state comes from a fresh queue read, so a record delivered after recovery disappears from its answer, while the saved evidence stays for tracing the lost accounting.
