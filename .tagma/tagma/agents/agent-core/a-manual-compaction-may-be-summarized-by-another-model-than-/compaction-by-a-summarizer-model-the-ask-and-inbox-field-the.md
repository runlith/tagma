---
id: 01a0d980-79cc-7222-9327-daa9fce8a039
title: "Compaction by a summarizer model: the ask and inbox field, the host resolver with rule, chain and spendability, foreign execution with passes and fall-through, the continuation context, the entry record and the choice read"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d980-e519-7c02-b9d3-f3d50924a094",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d980-451f-7376-b8a0-a342478a03df
---
Implements the backend of [[478a03df]]: §4 all parts except Surface and Warmth, with the contract in §10 and acceptance 1–6 and 9 (7 belongs to the warmth task, 8 to the surface task).

Kernel (`packages/agent/src/thread/compaction`): `summarizer` on `ThreadCompactAsk` and the inbox compaction body; the host port resolving when a request is taken; building the segment under the summarizer's selection and capacity, skipping the deployment's own form when the summarizer is not the thread's deployment; successive passes where the window is smaller; fall-through over chain members on provider failures; the synthesized continuation context for a deployment with its own form; `summarizer` on the compaction entry.

Server (`apps/tagma/server`): the two settings keys; a spendable answer over `AccountQuota` and provider accounts; the resolver filling the port; one choice-read operation computed by the same function as the resolver; the `summarizer` input on the compact door (socket and the `tagma` CLI's compact).

Done when acceptance 1–6 and 9 hold, shown by tests at the layers the rules allow, the claims named in §8 are written or rewritten from the code and verified, and the change is committed. The surface task waits on this one for the choice read's shape.