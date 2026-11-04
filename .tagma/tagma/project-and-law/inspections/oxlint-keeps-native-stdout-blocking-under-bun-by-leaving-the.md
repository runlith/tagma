---
id: 01a1a79c-6fa2-76e0-8f1f-4f357e16b387
title: Oxlint keeps native stdout blocking under Bun by leaving the Node stream unopened
ord: 62
tags: ["explanation"]
sources:
  - kind: file
    ref: patches/oxlint@1.86.0.patch
---
Oxlint writes diagnostics through Rust's blocking standard I/O. Opening Bun's `process.stdout` changes the inherited descriptor to nonblocking, but Bun exposes no Node `_handle.setBlocking` to undo it; oxlint treats a native `WouldBlock` as successful output, leaving JSON truncated when the pipe fills. The dependency patch leaves Bun's inherited descriptor untouched while retaining oxlint's Node setup.