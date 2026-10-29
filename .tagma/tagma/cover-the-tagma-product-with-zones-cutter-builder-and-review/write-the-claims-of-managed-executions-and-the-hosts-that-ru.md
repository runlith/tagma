---
id: 01a0ca97-13d2-76d3-a4f7-5514f28131ab
title: Write the claims of managed executions and the hosts that run them
ord: 211
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caba-0638-7598-ae48-9763a958b908",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/terminals
---
Read `apps/tagma/server/src/terminals/` whole — about thirteen thousand non-test lines, with Terminals.ts, TerminalStore.ts and the host boot, custody, activation, recovery and replacement files as its spine, and the command admission, policy, access, output and reader files beside them.

Write the claims of [[80346cf6]]: what admission decides and on what evidence, what custody means when the holder leaves, what a host replacement guarantees and what it reads that standing from, what an incarnation identifies, what a command's deadline and its stop each do, and what a reader of a command's output is given. [[e0ee2866]] already states several facts over these files from the invocation's side — read it and qualify rather than restate.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].