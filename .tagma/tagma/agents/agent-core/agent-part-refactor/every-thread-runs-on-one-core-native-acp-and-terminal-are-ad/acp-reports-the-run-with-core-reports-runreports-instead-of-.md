---
id: 01a11ca5-7ddf-7f42-a891-bd5f0054a96e
title: "ACP reports the run with core reports: RunReports instead of HarnessJournal, HarnessRuns, HarnessStream; run end in the driver write"
ord: 10
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd5e610af73e
---
What: [[35a07ee2]], "Journal and live tail" plus the end of the run. `threads/harness/turns.ts` and the `HarnessJournal`, `HarnessRuns`, `HarnessStream` ports go away; the driver reports `step`, `fate`, `ended`, `live` as plans in the step's write; the protocol row's `ending` and `ProtocolReactor.flushed` are deleted. The full word-fate contract comes in: `RunReports.fate`, both inbox implementations, the `signal` record, and excluding unconfirmed requests from the end's processed requests; [[6168d447]] consumes that contract.

The protocol-row migration with `ending` from "Cut 1" [[a63eba68]] belongs here: a `running` run closes with this end carrying ending and the outbox notification, with ending removed on terminal runs.

In-turn compaction of a live run from main (bfd2324f62: `COMPACTING`, `compact.inTurn`, `stepAnswered`) stays in the adapter; `protocolStep.stest.ts` and `protocolMethods.stest.ts` pass with no change to their assertions.

Proof: protocol and compaction system tests with no change to the visible-behavior assertions; test: an instrument result never lands in the journal before its call; end of run and protocol row in one write.
