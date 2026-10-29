---
id: 01a15c50-c9b6-761b-8ff5-19bc74b02f5f
title: A live pipes record with no output gains an empty output from a load-time logic step, and the journal knows only the current shape
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a129a8-7e55-7dff-93d9-3e6ff99c1d93
  - kind: relates
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
sources:
  - kind: symbol
    ref: packages/execution-host/src/RecordUpgrade.ts
    symbol: outputStreams
  - kind: symbol
    ref: packages/execution-host/src/subscriptions.ts
    symbol: sealedPump
---
The next logic continues an unsealed record of a logic that never knew `output` across an update. A load-time step, before executions assemble, once appends an empty `output` to its journal's initial state and creates its directory; so reopen and journal reading know only the current shape, and such a record's `output` starts at reopen. Rejected: a journal that itself accepts stateless-of-`output` — then every record opening would check the old shape.

The step never touches a sealed record: its `output` was written by nobody, and reading such a record's `output` refuses with the host's `StreamMissing` — at server doors that is code `terminal-host-refused-StreamMissing`, and a subscription refuses until confirmed — instead of answering empty: an empty answer would pass unwritten output off as a program that printed nothing. By that code the window tells such a record from a read failure and shows its stdout and stderr apart. Such a record's stdout and stderr read as before.
