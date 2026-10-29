---
id: 01a11ca4-c166-7a7f-8760-a6167bc9d0d0
title: "Remainder of unified questions: vendor hook/protocol questions into Questions and the pendingInteraction slot as a journal projection"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9128a5e5740d
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
---
Left undone of [[4a024c48]] and [[fb39e560]] after commits af43d3f62b, 1009fab8c3, e8483d8937, e030911f98, 42a55e2daf, 9dca5851b5:

- Passed to spec-transports: vendor questions move into `Questions` as part of the [[9116e494]] migration. The description below is a reference for them.
- Vendor questions over hook (`judge_harness_call`, `record_harness_outcome`) and over ACP (`ProtocolAsks.asked`) still live in `facet.question` with `hook`/`protocol` sources; the `consent` source, the `harness_consent` table and `ConsentReceipts` are deleted. A key is needed — the vendor call's id, missing from the hook payload so far; the driver maps the answer into allow-once/reject.
- The `pendingInteraction` slot is written by native `PendingQuestions.record`, `ThreadInteraction` (claim/answer/expire/stop/clear) and `Questions` (standalone, rewrite): journal and slot written in one transaction, but the slot's write owner none. Native questions stay under run parking (`ApprovalParking`), not in `Questions`.
- `/approves` offers only Inherit, Nothing and already named selectors: the flow-mode act and condition list (from `read_operations`) never loads into the app.
- The fake-clock `approval-pending` test after 50 s of the door and the slot-migration test unwritten (the road checked with a 0 wait header).
