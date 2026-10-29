---
id: 01a118eb-3e7e-7085-8f2e-2cd787916291
title: Collaboration splits into tree, delivery and reports; report collection is linear in child count
ord: 13
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
---
Goal: collaboration is split into tree, delivery and reports. The sender may be a process outside the thread. An observer collects hundreds of children's reports with work linear in the number of children and new reports, and report content does not change in the process.

## Now

- **Report collection.** The team command is read whole, filtered and sorted in memory (`Commands.ts:481-494`). `latestRun` is read per inactive row of the page (`:486-501`). `ThreadEnvelopes.ts:635-706` repeats a status read per observed change. When children finish one by one, rows and sorting grow quadratically in the child count — that is a code-reading estimate, not a measurement.
- **Reports.** An explicit final answer closes the owed requests and stores the full answer transactionally (`ThreadEnvelopes.ts:267-341`). The automatic end report carries the last message as evidence of the end and does not close the final-answer obligation (`reportTexts.ts:4-11`). Workflow takes `arrival.text` as the member result (`collaborationWorkflowMembers.ts:43-46`). Each report wakes the observer separately.
- **Sender.** `deliver` takes the caller's claimed `senderThreadId` (`ThreadEnvelopes.ts:43-49,192-199`), and `access(sender)` treats the sender as a thread.
- **Mixed subjects.** `ThreadSpawnTree` holds the tree structure, door assembly and settlement. `ThreadEnvelopes` (750 rows without imports) is report transport and policy.

## What is built

- **`collaboration/Tree`** — births, names, lineage.
  - The tree's native adapter appears in the [[7337d0bb]] cut, which removes it from `Commands.ts`; here it splits by subject.
- **`collaboration/Delivery`** — envelopes, keys, sender: a thread or an outside caller with `caller` ([[b771b4db]], [[9f3bb3f9]]).
- **`collaboration/Reporting`** holds for every report:
  - full text and address;
  - the explicit final answer vs automatic end distinction;
  - the link to the obligations being closed.

  Several standing reports wake the observer once, without changing content. A compact projection is an explicitly chosen read with a link to the full answer: it does not replace the workflow result and does not close the request for the author.
- **`collaboration/Door`** — verbs, tools and voice as source contributions ([[8451c5c9]]). Fork is granted by a grant.
- **The team list** is filtered and paginated with a keyset in the store, latest runs are read in a batch. A child status change is handled as a delta, without re-reading the team.

## Acceptance criteria

- A fixture over C children, with one-by-one and batched completion scenarios. Reads, rows and bytes read, records processed and bytes are counted.
  - Full collection is O(C + R) in children and reports.
  - Fixture sizes are minimal while distinguishing linear from quadratic growth.
- Test: several standing reports wake the observer once, and its read returns every report whole with its kind (final or end).
- Test: a workflow member result is the full answer, not a projection.
- Test: an outside caller sends an envelope and waits for the answer; the envelope's sender is its `caller`.
- `lowerings` records leave with their birth's end.
- `ThreadEnvelopes.ts` (or its successors) is at most 650 rows without imports; the debt record disappears.
