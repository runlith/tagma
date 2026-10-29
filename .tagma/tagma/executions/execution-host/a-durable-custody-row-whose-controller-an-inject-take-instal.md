---
id: 01a0c973-32f0-7b43-b609-4058b8f0f683
title: A durable custody row whose controller an inject take installed before the fix is not swept, and holds control until the holder's next take
ord: 64
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c717-a237-76e9-957d-dec2ab09a4ae
---
Found reviewing [[ab09a4ae]]'s fix (`8bd19e79b8`), which refuses every custody act presented through an inject binding.

A durable custody row written before that fix can carry a controller installed by an inject take. Nothing sweeps it: the refusal applies to acts presented from now on, not to state an earlier accept wrote. The holder's next control take displaces it (`ExecutionCustody.ts:242-249`), so the row heals on the next real take — but until then a scope that should never have held control still holds it, and that is the exact outcome the fix exists to prevent.

Fix at the owner: decide whether an inject-installed controller standing in durable state is read as a controller at all, or whether the state is reconciled when the fix's own vocabulary is what reads it. This is a decision, not a mechanical sweep: the repo forbids a standing second layer that audits what the first should have got right, so if the answer is "only the next take displaces it", that is the answer and this task records it.