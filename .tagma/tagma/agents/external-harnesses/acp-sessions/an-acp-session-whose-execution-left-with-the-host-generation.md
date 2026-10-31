---
id: 01a1785a-8e92-7566-9207-3284b19639ee
title: An ACP session whose execution left with the host generation ends via the ordinary process-exit road, never touching the process itself
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17840-e1b7-7cec-8268-b118346e149c
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
    symbol: ProtocolProcess
---
The ACP driver never drives an execution below the host's current generation (`Terminals.lost`): it opens no lane, writes no handshake or prompt, never reads the output road — its `Terminals.records` refuses such an execution with `record-lost`, and that refusal used to drag the session into `uncertain`, and a repeat drive right back there, without end. But the end travels the same road as an exited process: the same execution's row first gets `Recovered`, then `TerminalEndings.decided` (for a lost one — `Unwatchable` and custody dropped), `Exited` with `LOST_LINE`, `asides.exited` and `finish`.

A runner the current host proves absent takes this same road: its live-state read must succeed, no stop is issued, and no protocol lane is opened. A failed host read is not absence.

A shortcut straight to `finish` is wrong here. `Recovered` moves a receiptless recorded request into `uncertain`; a bare `Exited` would have counted such a prompt refused and returned to the inbox words the old process may already have executed. And without `asides.exited` the thread would keep a copy of the dead runner's session, which recap and thread names lean on as live.
