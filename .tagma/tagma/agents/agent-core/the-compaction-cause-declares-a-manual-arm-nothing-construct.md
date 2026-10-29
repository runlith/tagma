---
id: 01a0c9a4-d9d8-76ad-ba1e-7b0ade3e52c9
title: The compaction cause declares a manual arm nothing constructs, in a union the durable receipt carries
ord: 127
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
    symbol: ThreadCompactionDecision
  - kind: symbol
    ref: packages/agent/src/transcript/entries.ts
    symbol: ThreadCompactionReceipt
---
A compaction decision names its cause as one of four: manual, overflow, measured or projected. The comment beside the union says `manual` is the operator asking. Nothing ever constructs it. The decision function returns only the other three, the explicit-compaction road builds no decision at all, and the one receipt constructor copies whatever the decision carried — so no path produces the value.

It is not merely a dead local. The same four-way cause sits on the durable transcript receipt, so the value is part of what a reader is promised a stored compaction can say, and a consumer switching on it has an arm that can never be taken. What a durable vocabulary declares is a contract with every reader of the record, including ones written later against the type rather than against the code.

The neighbouring word is alive and should not be confused with it: the compaction MODE is manual or automatic, and the explicit road does set it. It is the CAUSE that has no producer.

Two endings, and the choice is about what the record should say. If an operator's compaction ought to be distinguishable in the stored receipt from one the budget forced, then the explicit road should build a decision carrying the cause, and the value becomes real. If the mode already carries that distinction, the cause should lose the arm — and losing an arm from a durable union is its own small migration, which is the reason to decide it rather than leave it.

Done when the cause is either constructed on the road that means it or absent from both the decision and the receipt, and no reader is left with an arm nothing can produce.
