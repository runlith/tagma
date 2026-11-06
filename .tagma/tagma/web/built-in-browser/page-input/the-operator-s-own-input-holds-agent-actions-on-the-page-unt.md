---
id: 01a18500-e4f2-7632-815c-0a9f371c55ee
title: The operator's own input holds agent actions on the page until it has been quiet for five seconds
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184e9-acb7-7aa5-b270-ce2073c47652
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/operator.ts
---
The operator takes a page over by touching it, with no control of his own (rule 0f144655), so the engine must judge from his input alone when he is done. The bound is human time, not machine time: it is the same on every machine, since the producers' latency — a local socket from desktop main, a viewer's RPC — is milliseconds. Five seconds outlasts the pauses inside one piece of work — between keystrokes, words, a scroll and a glance — and is shorter than an agent's turn, so the agent's retry after the refusal usually finds him done. A shorter bound lets the agent type into a field he paused on; a longer one keeps a page from the agent long after one stray click.

The bound must stay well above desktop main's report pace (one report a second while input continues): the quiet time is measured from the last report, not the last keystroke.

The check stands before each acting step, never inside one: a step already running is not torn, and a sequence stops before its next step with the steps it completed. Reads stay open, so the agent can watch what the operator does. Only presses, wheel, keys, text and drags count; a pointer passing over the page takes nothing over.
