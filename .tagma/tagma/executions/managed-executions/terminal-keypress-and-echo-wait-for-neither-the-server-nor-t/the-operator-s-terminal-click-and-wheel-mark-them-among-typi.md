---
id: 01a17bc1-6619-732f-bee8-de0ca6edd107
title: "The operator's terminal click and wheel mark them among typists again: the lane carries the `mouse` cause"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17aff-0013-783e-93b0-82187374bf6c
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: packages/executions/src/protocol/lane.ts
---
Before b1d0f87858 the window distinguished click and wheel (`mouse`) from hover and focus-report (`raw`), and the server's `typedInto` counted the operator's `mouse` as typing and their `raw` as not. The lane protocol (`LaneCause`) has no `mouse` cause: the window sends clicks as `raw`, the `Inputs` event arrives with `raw`, and the operator's click in a TUI no longer marks them in `TerminalWriters` nor makes their view settle the grid. The `mouse` cause must travel from the window through a lane act to the `Inputs` event; telling click from hover in the window returns together with its test.
