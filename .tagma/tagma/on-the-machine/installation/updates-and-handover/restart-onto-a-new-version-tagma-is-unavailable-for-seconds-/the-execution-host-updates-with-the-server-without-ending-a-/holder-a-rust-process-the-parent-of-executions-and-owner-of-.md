---
id: 01a1271e-2479-7971-9b0c-4ec6e946bdd8
title: "Holder: a Rust process — the parent of executions and owner of their fd — and its port in the host logic"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/native/src/pty.rs
  - kind: file
    ref: packages/execution-host/src/native/PipeChild.ts
---
In the host line worktree ([[d86d6647]], "Delivery order"). The POSIX holder binary in `packages/execution-host/native`, a single-threaded loop. PTY start (carried from `native/src/pty.rs`; the slave closes only after the child got it, otherwise the window size resets to 0×0) and pipes (posix_spawn, carried from `src/native/PipeChild.ts`). A leader exit is watched with `waitid` and `WNOWAIT`, the status and rusage removed with `wait4` on the logic's command; a signal to the leader and group goes before removal, refused after. Writer claim; fd copies to the logic over SCM_RIGHTS on a socketpair; input close together with the holder copy; release; starting the logic from `bundle` and restarting with a pause; its own session. In the logic — the holder port in its contract and the POSIX client (`recvmsg` in the native library); the adapter its own module (`set_module`). Start with `native/src/pty.rs`, `native/src/identity.rs`, `src/native/PipeChild.ts`. Proven by an integration test of the client with a real binary: PTY and pipes started, fd copies received, I/O flowing; a leader exit watched without removal, a group signal after the leader exit reaches a live member, refused after removal, rusage arrives; a second client after the first left gets the same fd and keeps reading from the same byte with the same children pids.
