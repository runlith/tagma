---
id: 01a151df-e920-73d7-9b09-09de86120678
title: Feed, snapshot and evidence wire schemas decode records closed by browser-set kinds
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-5640-7f4a-9526-239d66e50fc2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/snapshot.ts
  - kind: file
    ref: packages/agent/src/thread/persisted.ts
---
The feed, snapshot and evidence wire is decoded closed by the request-context `ThreadEntryKinds` reader. The app assembles `EntryKinds` from server owners at boot; `Door` and `Live` pass that reader to every call and subscription. The open `threadTranscriptEntrySchema` is removed; app projections take already-decoded records instead of hand-parsing unknown.

An unreadable record with stored type/id becomes a diagnostic row carrying the original `ThreadEntryUndecodable`, without dropping neighboring snapshot records. Damaged optional metadata does not block the diagnostic; valid metadata is kept. The stub is created only on ingress, never encoded back, and does not change the source journal record.

Checked: agent entryWire 2/2; producer feedPairs 10/10; browser feedPairs 11/11; Door 16/16; a real RPC subscription 1/1; projection/contributions 7/7; EntryKinds 9/9. Agent, chat-ui and app typechecks passed. App was repeated once after others' typechecks finished: 0 errors, 1 unrelated a11y warning in CastView.svelte:243; the first run was stopped by the 10-minute limit with no diagnostics. A read-only review by [[01a1520d-0917-7afa-84e5-145c51353430|the reviewer]] found one P2: damaged optional metadata blocked recovery; fixed at ingress and covered by strengthened existing tests.

Not proven: the last full server typecheck ended `Found 4 errors in 2 files`: 3 in external-harnesses/protocol/asks.test.ts:36 and 1 in native-harness/places.itest.ts:90, on parallel works' rows. No errors shown in this delivery's files; others' changes were not fixed.
