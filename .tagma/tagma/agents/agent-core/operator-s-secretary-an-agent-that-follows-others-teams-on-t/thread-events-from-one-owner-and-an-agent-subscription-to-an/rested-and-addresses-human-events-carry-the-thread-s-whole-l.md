---
id: 01a16510-d7f4-7c71-ad20-52fc7612c630
title: Rested and addresses-human events carry the thread's whole last answer, not the list-row excerpt
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1650e-8a0e-7171-a68b-aa40929594bf",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a16503-2038-72ab-9b6b-2a47755d2212
---
The `rested` and `addresses-human` events carry the thread's whole last answer, not the list-row excerpt.

The event row puts `thread.saidLine` (`threads/events/happened.ts` — `said` on `rested` and `addresses-human`). That is the one-line excerpt made for the thread row in the list. The subscriber got "Answer ready, checked the mechanism in code. Writing." or a report start cut with an ellipsis. Reading the answer itself took a second call, which costs more than handing the full text over at once.

Operator decision: the event carries the turn's whole last answer. Past the output envelope, the same mechanism as a long tool output applies: part of the text plus the full address. No separate cut for events. This also closes [[755d2212]]: a question hidden mid-answer is no longer lost.
