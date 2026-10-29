---
id: 01a151df-e920-73d7-9b09-09d4cc3ca850
title: A mutating act in another project executes only after that project's law has reached the model
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-f130-7288-b1a4-5256485048d5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/instructionRule.ts
  - kind: file
    ref: apps/tagma/server/src/threads/working.ts
---
A mutating act in another project executes only after that project's law has reached the model. Native and hosted ACP admit a foreign-place mutation only under a law available before the call's assistant message. Reading passes at once and records the place; a built but unsaved guide and a same-batch neighbor's post-tool guide never grant admission. A full orientation before reading is not required: a reading refusal would cost the model a step for nothing.

`WorkPlaces` separates place recording from delivery proof. The history owner keeps an incremental `toldStateOf` projection with position and assistant-batch snapshots; a mutation reads only the address answer and `GraphOrigin`. The projection restores from history, updates on new messages, resets on compaction, and rebuilds on history replacement. Hosted uses the existing order: the result and guide commit after `reached`, once the assistant with both toolCallIds is already written. The [[9105ff3f|places explanation]] and the capability description are brought to this guarantee; no migration needed.

Checked: 19 index, held-history, history, native-places, and hosted-ACP tests passed; three more placePolicy and instruction tests passed. Two parallel native refusals, write-after-read, pre-COMMIT refusal, compaction, and a hosted race with launch before message print and a second call after the first guide checked. Message-touch count at index lookup zero for short and long history alike. Cross-project place.stest 4/4. Server `bun run typecheck` over 5107 files passed. One readonly review found a same-batch skip and a repeated linear history scan; both findings fixed.

Unproven full `hookPlace.stest.ts` and `http/placedCall.stest.ts`: the last run expired again after 30000 ms building mirrors and left two sqlite-process children on cancel. 388 assertions done in placedCall before the limit; a stale graph fixture fixed. The cause — test-mirror startup/cleanup — moved to [[21d412fb|test-mirror task]], deadlines not extended. Delivery boundary: law before mutation — native and hosted ACP; HTTP/MCP — law in the first refusal, a parallel call may pass it; hook — after writing.
