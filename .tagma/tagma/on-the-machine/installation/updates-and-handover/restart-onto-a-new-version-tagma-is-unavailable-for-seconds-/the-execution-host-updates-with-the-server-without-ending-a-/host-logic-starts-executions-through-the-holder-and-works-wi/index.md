---
id: 01a1271e-2479-7971-9b0c-4ec70308b97d
title: Host logic starts executions through the holder and works with received fd
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ec6e946bdd8
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/execution-host/src/nativeLaunch.ts
  - kind: file
    ref: packages/execution-host/src/registry/assembly.ts
---
In the line's worktree. The registry starts through the holder port instead of `launchNative` (`registry/assembly.ts`, `nativeLaunch.ts`, `ptyLaunch.ts`, `pipeLaunch.ts`). PTY and pipes are read and written by the native library over fd; the input writer is non-blocking and knows the current act's offset after every write; `Bun.spawn` and the start in `PipeChild.ts` are gone. Exit and cost come from the holder, removal is the logic's command after the group ends; the claim is the holder's copy, the logic takes none of its own (`host.ts:168`). EOF on the channel to the holder: the logic closes new starts with "holder lost", sends signals itself by birth witnesses, records a leading exit without status (`registry/work.ts:117-127`), and exits after the last execution. The server raises the holder instead of `host/host.js` (`executions/host/boot.ts`); the bundle carries the holder (`buildArtifact.ts`, manifest). Process usage accounting counts the holder and the logic. Proven: the current host integration and system tests pass over the holder; an integration test — holder killed, executions alive and served, a new start refused with that cause.
