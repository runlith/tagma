---
id: 01a13236-97b0-7d5b-ba78-395eedb1d077
title: A command's post-gap output continues from retainedFrom, so the agent gets the genuine tail
ord: 31
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12863-bb0b-7715-800b-75f8f5bacc7b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/worlds/shell/results.ts
    symbol: bytes
---
An ordinary (non-streaming) command evicts the record start, and a Bytes subscription lagging behind eviction ends in `gap`. The shell-command output reader never stops there: it reads the stream's `retainedFrom` from the execution state and resubscribes from there until the stream finishes. Otherwise ShellRun would show the last lines of what it managed to read before the gap — the output's middle disguised as its end. The skip surfaces through retention `partial` in the command verdict. Resubscribing requires `retainedFrom` strictly past the old offset: that never loops on stale state.
