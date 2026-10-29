---
id: 01a12ad9-cc78-7562-9ca4-ac35889eb35a
title: submit_work lists already-landed or reverted files as still held
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "left lists 14 paths (incl. deleted departure.itest.ts, departingLogic.ts, and debug edits reverted to byte-identical) while git status shows them clean",
    "command": "submit_work paths=[packages/execution-host/src/posix/Reactor.ts] → 7172100a53",
    "expected": "left lists only paths where this session's lines still differ from HEAD"
  }
---
Filed from project `runlith`.