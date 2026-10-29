---
id: 01a16513-cae1-7883-a974-5362106566b2
title: A turn opened by the operator's word neither wakes a subscriber nor asks the addresses-a-human decision
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1650e-8a0e-7171-a68b-aa40929594bf",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-90515fc6ae4f
---
A turn opened by the operator's word neither wakes a subscriber nor asks the "addresses a human" decision.

2026-10-22 case. The operator wrote Navigation Checker "answer briefly please", it answered and stood. The subscriber got "rested", woke, and retold the operator an answer the operator had already read. The event owner does not look at who opened the turn: the operator's word counts only for `stopped` (`run.stoppedBy === 'reader'` in `threads/events/happened.ts`). Meanwhile the parent lines already tell this fact apart — `forOperator` in `threads/collaboration/childUpdates.ts`.

Operator decision: a turn the operator's word opened is the operator's own conversation.
- `rested` on such a turn does not wake a subscriber. The row arrives quietly, marked that the operator spoke in this turn.
- `addresses-human` is not derived for such a turn; the model decision is not called.
- Turns opened by anyone else wake as before.

The "the operator opened the turn" fact is derived once, at the same owner that already tells it apart for parent lines. No second derivation.
