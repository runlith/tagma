---
id: 01a16649-cb94-7b04-a9eb-70712e327c65
title: A late subscription to a closed entry answers `completed` for a stream that ended with an error
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16625-0733-71a0-a046-0352a6cea63c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16624-d717-7dee-8615-3f88715d8dc8
sources:
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
  - kind: file
    ref: packages/executions/src/RecordFiles.ts
---
Subscribing to the bytes of an execution the host already closed and stored goes through `sealedPump` (`packages/execution-host/src/subscriptions.ts`). It answers `completed` to the first empty read. `RecordFiles.readStream` yields an empty read at `durableThrough`, ignoring the stream's ending (`held.positions.ending`). So a stdout that ended with `error` reaches a late subscriber as finished output, while a live one after 18f7200955 gets `unavailable`. The shell command (`executions/worlds/shell/results.ts`, `following`) shows such cut output as whole.

Reading a closed entry must carry the stream's ending, and the subscription must answer `completed` only on `eof`, as in the live path. Test: a subscription to an execution that ended with `error` on stdout and was closed by the host ends `unavailable`.
