---
id: 01a1520d-d830-738b-b878-20699c5f7df9
title: After answering the first standalone question the wait slot shows the next open question
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-f13f-7600-9274-8b6e02ae3a9c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d80c12ca5d
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/run/pendingSlot.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.ts
---
Before the fix `slotAfter` returned `null` when closing the question holding `pendingInteraction`, never picking the next open question. `Questions.approve` admits several standalone questions from different acts: the second stays in the journal while the slot is held by the first. In the original code answering the first left the second reachable through `Questions.open` but dropped it from the attention projection; the same gap appeared when a parked question pushed a standalone one out. Fix at the slot-projection owner, keeping hosted/parked/standalone apart. Proof: a public scenario in approver.stest.ts checks two approvals, the answer to the first, the second in snapshot and attention, then an empty wait after the second; 5 pass, 62 assertions. An owner test confirms parked→standalone on clear; native/hosted/withdrawal/answer suites — 100 pass. A confirmed P2 review fix landed in native storage: the SQL seed takes live rows by partial index in each layered arm and only the entry id from the pending suffix, keeping ordinal and rewind metadata. The storage test checks a real EXPLAIN, inherited prefix, and pending reopen/answer; it passed, existing row/run contracts — 134 pass with no budget warning after splitting by storage rows and lifecycle. The old exact prompt matcher fixed for an allowed optional pendingDefinition. Agent typecheck — 799 files error-free. The last full server typecheck (5117 files) is green except an unrelated ruleSources.test.ts:43/55, TS2769 (string|boolean|undefined array vs readonly string[]); no errors in my own files. The cold-rollout reader stays a separate task [[624608d8]]; the SQL fix is never presented as transcribed-file speedup.
