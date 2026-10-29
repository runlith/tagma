---
id: 01a155b9-1a73-72f3-9f91-30deb8076d85
title: A repeated run Stop while the first is still ending its command answers "commands still held"
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15595-ab3e-73dc-8fec-d1c647649b52",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/stops.ts
---
A second ESC during a run stop with a running command (SIGTERM grace ≈2 s) showed a red `thread-commands-standing … 1 commands still held` banner. A run's sweep walks under one key `thread-stop:<thread>:<run>`; a repeat, while the first pass awaits the host, skips the command's already-settled stop and reads its row as held. Fix: `Terminals.stopCommands` runs same-key passes in turn — the repeat awaits the first and answers by its outcome. Proof — the "a sweep repeated while its first pass is still ending a command answers that command ended" itest (red without the fix).
