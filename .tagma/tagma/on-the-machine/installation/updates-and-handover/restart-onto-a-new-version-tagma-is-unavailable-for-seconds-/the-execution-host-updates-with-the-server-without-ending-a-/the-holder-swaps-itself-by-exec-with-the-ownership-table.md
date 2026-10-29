---
id: 01a1271e-2479-7971-9b0c-4ecc9d2e407b
title: The holder swaps itself by exec with the ownership table
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ecba39607f1
sources:
  - kind: dir
    ref: packages/execution-host/native
  - kind: file
    ref: packages/execution-host/native/holder/src/handover.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/macos/succession.rs
---
In the line's worktree. Check mode: a new holder reads the old table. Exec — when the holder file in `bundle.next` differs from its own, only with permission and with the logic gone. The new holder recreates event observation from scratch (kqueue does not survive `execv` even without `FD_CLOEXEC`), asks every kept child about an exit that happened during exec, and continues the generation; a failed exec returns `bundle.prior` and the old logic. The table holds only kernel facts. Start with the holder binary in `packages/execution-host/native`. Proven by a system test: a swap with a different holder (holder and children pids unchanged, a child that exited during exec delivers its code, the rest as in a logic swap) and with an unreachable holder binary (everything keeps working).
