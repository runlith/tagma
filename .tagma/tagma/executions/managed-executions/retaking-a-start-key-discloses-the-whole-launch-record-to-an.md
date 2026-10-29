---
id: 01a0cace-12d9-7748-8938-b4553371f42d
title: Retaking a start key discloses the whole launch record to any same-project caller
ord: 58
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/reads.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
---
Repeating a taken start key answers `Terminals.standing`, which returns the whole record — the command record with its command line, or the terminal record with target tuple, holder, holdings and cwd — with no requester comparison. `operationFor` (the read road) gates Whole-vs-Digest on exactly that match — but the start-retake road skips it. Operation ids travel in refusals and messages, so any same-project caller repeating the id reads another actor's launch.

Done when a retaken start refuses on requester mismatch or answers the digest a non-requester is owed — proved by a test repeating a taken key as another principal.