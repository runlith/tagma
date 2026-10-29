---
id: 01a127af-c14d-7f11-84ef-57d03a807a7c
title: The holder shared core and the native library work through the macOS platform contract
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
---
In the same worktree, carve out the Rust holder's shared core and the native library plus the real platform contract per the terminal-quality spec [[7df613b0]]. The current working macOS implementation fills it whole; the loop, protocol, table, and logic lifecycle do not depend on OS mechanisms. Start with `native/holder/src/{holder,spawn,events,table}.rs`, `native/src/{lib,channel,reactor}.rs`, and the TS adapter; one owner changes both sides of the boundary. Linux and Windows are not declared supported in this task and are not faked with empty adapters: an unsupported platform gets an explicit typed refusal at load. Two shared-protocol places found by the step-1 review change here: the SIGNAL frame carries the signal name, not the number from the logic's `os.constants.signals` with a `0..32` check in the holder core (`PosixHolder.ts:329`, `holder.rs:426`); the capability set is declared by the holder in HELLO by its platform, not a TS adapter constant (`PosixHolder.ts:24`). Done when real macOS PTY and pipes work through the platform contract, exit observation, acts on work, and resource handover keep their old guarantees, and a second adapter needs no shared-loop or wire change.
