---
id: 01a0d980-7971-7cb6-9acf-322b66e5d6fb
title: "Warmth reads cold after an account switch: the context reading records the account its request went out on"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d980-e4a0-77e0-9a6d-190ab88e1770",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d980-451f-7376-b8a0-a342478a03df
---
Implements the "Warmth knows the account" part of [[478a03df]] (§4, §10 `invalidatedBy: 'account'`, §11, acceptance 7).

Start at `packages/agent/src/thread/cache/ThreadCacheWarmth.ts` and where the context reading is written (`thread/run/ThreadContextAnchor.ts`, `ThreadEventDoor.ts`). The account must be the one the request actually used: where the thread names none, the server resolves the owner's default per request (claim 3b72ae26), so find where that resolved account can come back to the reading, at its owner, not by re-deriving it in the agent. Warmth's input gains the account the next request would use. A reading without an account never invalidates on account.

Readers that switch on `invalidatedBy` name the new value: the app's `warmthWords`, the collaboration directory's agent facts, and the thread projection's `warmthLine`.

Done when switching a provider's default account makes a thread with no account of its own read cold with `invalidatedBy: 'account'`, old readings still read as before, claim b264e59a is rewritten from the code and verified, and the change is committed.