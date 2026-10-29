---
id: 01a0c99b-eef6-7ddd-a1f9-199bd2b49e17
title: A drive failure leaves a workflow run durably running with no verb to end it, and the stopped status nothing ever writes
ord: 132
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/workflow/engine.ts
  - kind: symbol
    ref: packages/agent/src/workflow/run.ts
    symbol: WorkflowRun
  - kind: symbol
    ref: packages/agent/src/workflow/storage.ts
    symbol: WorkflowRunStorage
---
A workflow run ends in one of four states: running, completed, failed or stopped. The engine writes three of them. Nothing anywhere writes `stopped` — the status is declared on the run, accepted by the store's `finish` and carried by both fills, and no code in the package ever passes it. There is no stop verb either.

That would be dead vocabulary on its own. What makes it a defect is where the missing ending is needed. A step that settles badly ends its run in that step's own words, which is the designed road. But a failure of the DRIVE rather than of the step — a member start the plane refuses, a thread that is gone, a seam or condition that throws, a step a record names and an amendment removed — fails the drive and leaves the row exactly as it was. The run stays `running`, durably, with no lease held and nothing scheduled to take it up. Nothing will ever move it again, and there is no verb a person could use to end it.

The product above reads that state as stopped and says so, which is the worst of both: the run is not stopped, nothing stopped it, and the word that would make it true is the one the engine never writes.

Two questions to settle, and they are separable. Whether these drive failures should end the run — as failed, with the reason, or as stopped — or whether they should be retried, since some of them are transient and the run is durable on purpose. And whether a stop verb should exist at all, given the status already does; a status nothing can produce is either a missing verb or a field that should go.

Done when a run cannot be left durably running by any failure the engine can meet, and `stopped` is either written by something or removed from the vocabulary.
