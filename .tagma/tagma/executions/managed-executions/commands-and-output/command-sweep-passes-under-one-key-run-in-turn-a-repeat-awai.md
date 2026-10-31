---
id: 01a155b9-5aac-7e8b-b1ed-7c53e0f64948
title: "Command sweep passes under one key run in turn: a repeat awaits the pass in work"
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a155b9-1a73-72f3-9f91-30deb8076d85
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/stops.ts
---
A run's sweep walks under the constant `thread-stop:<thread>:<run>` key, so a second Stop of the same run repeats that key. The repeat never stops what is settled and reconciles the outcome against `command_wait` rows; while the first pass awaits the host (SIGTERM, then kill after grace), the command row still stands, and a repeat running alongside would answer "commands still held" — the reader's Stop would show a refusal over a stopped run. Awaiting the pass in work turns the repeat into a read of the outcome the first pass established. A pass that loses its fiber leaves the parent key uncertain before giving up its turn; that aggregate key is not a host request, so an unanswered host lookup cannot prove the sweep absent.
