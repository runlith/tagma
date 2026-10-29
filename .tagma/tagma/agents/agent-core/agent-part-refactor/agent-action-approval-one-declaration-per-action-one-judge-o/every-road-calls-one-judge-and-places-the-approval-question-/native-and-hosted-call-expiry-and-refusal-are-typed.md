---
id: 01a151a7-2492-7ae4-85b1-8c92c1dc01c0
title: Native- and hosted-call expiry and refusal are typed
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a001-7ba3-be29-65c507d9a74f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c26-7d19-7b9a-8bcc-29594a024c48
sources:
  - kind: file
    ref: packages/agent/src/thread/run/hostedAsks.ts
  - kind: file
    ref: packages/agent/src/thread/run/ToolQuestion.ts
---
Native and hosted calls answer with a shared `unanswered` carrying questionId, askedOf and timeoutMs, and `declined` with author and note; stopping the run stays a cancel. Proof is the public Questions and hosting contracts: expiry does not execute the action, the parent's decision is kept in the outcome, a repeat after recovery reads the source deadline. Agent typecheck and 33 checks passed; the full server typecheck is not proven because of errors in three foreign test files.
