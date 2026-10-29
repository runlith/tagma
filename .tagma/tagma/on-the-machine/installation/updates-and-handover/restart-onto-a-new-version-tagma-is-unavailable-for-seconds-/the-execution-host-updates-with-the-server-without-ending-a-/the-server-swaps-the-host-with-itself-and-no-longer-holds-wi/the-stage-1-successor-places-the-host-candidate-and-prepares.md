---
id: 01a129b5-8b8f-7b10-b77d-a492d2a71914
title: The stage-1 successor places the host candidate and prepares it, and the predecessor's last act over the host is handover
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Part 2 of [[2e350fc3]]: atomically placing `bundle.next` and the load entry moves to stage 1 (before STANDING_BY); after the successor is ready the predecessor calls `HostLifecycle.prepare`; a refusal removes the candidate and cancels the successor with the predecessor answering. At stage 2 the ticket through quiesce and `yield(ticket)` is the last act over the host while the client is alive; EOF after Yield reads as handover. At stage 3 the successor waits for its own build's digest registration, then takes custody. The existing `SuccessionSteps` port grows (`installation/process/succession.ts`, `executions/host/offer.ts`, `executions/assembly.ts`, `composition/runtime.ts`). A change of only policy or share goes without copying the unchanged bundle (`registry/departure.ts:41` does not unconditionally require `bundle.next`). Proven by the [[212d752c]] stand on one's own instance: matching digest and entry — no Yield; a changed bundle — same pid, generation, and cursor; a stage-1 refusal with the predecessor alive; an ndjson frame larger than a chunk whole and once.
