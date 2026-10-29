---
id: 01a16e65-02fa-7219-bea3-66c58cd7dc7e
title: "`logAt` and `unpushedAt` read git history as a stream of frames, not as one string"
ord: 112
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16e50-3c93-75ed-bf4d-1eb8361face6
sources:
  - kind: file
    ref: packages/git/src/history.ts
---
Acceptance [[361face6]] required filtering history without a full buffer, but this item is undone. The subject filter is fixed in e6d6b631cb, the buffer remains:
- `logAt` (`history.ts` ~474–475) collects a growing prefix of records through `Stream.mkString` in `Git.ts`;
- `unpushedAt` (~427) buffers the whole subject range and splits it synchronously.

Total work is linear, so CPU is unaffected. But memory and the synchronous split grow with the unpushed range length and history length, with no upper bound. The workspace-merge found this while working on the worktree-branch deletion decision.

The producer must emit records by delimiter, frame by frame, with filter and limit over the stream. Spans, refusal and cancel stay. Deferred until the x10 measurement ends: several agents now edit Git-kit and BranchRefs.
