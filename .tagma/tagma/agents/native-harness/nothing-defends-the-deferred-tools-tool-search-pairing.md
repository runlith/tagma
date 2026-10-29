---
id: 01a0c8cb-04b0-7a61-a0bc-0e38d7884fad
title: Nothing defends the deferred-tools / tool_search pairing
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
---
The pairing holds today only because `AgentScope.ts:57` merges `tool_search` into any catalog holding a deferred tool — established outside this package, checked nowhere inside it. The only refusal here guards the reverse direction. The deferred suite covers the bare route alone.

Claimed as [[24e888f1]]. Decide where the guard belongs.