---
id: 01a14c13-c481-7acc-8aa6-03d3421798ba
title: The server counts how much disk space a worktree takes and how much of it is ignored
ord: 12
tags: ["feature"]
fields:
  {
    "state": "dormant"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d12f8bdbf8
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees/space
  - kind: file
    ref: apps/tagma/server/src/worktrees/contract/wire/space.ts
---
**Value.** Planned for cleanup: visible which worktree is heavy and how much `node_modules`, builds, and other ignored stuff take in it.

**How.** The worktrees module's live `space.scan` stream, operator only.

**Behaviour.** A folder walk with progress counts the real on-disk size, hard links once, and answers with the heaviest top records and the git-ignored share; if git didn't list the ignored, the freeable isn't counted, and the answer says so.

**Limits.** No screen and no agent tool calls this stream: the capability is built but unreachable.
