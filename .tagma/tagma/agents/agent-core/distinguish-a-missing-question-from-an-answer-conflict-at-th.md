---
id: 01a14e1f-d8e0-7fa1-bf90-3ec7522bdaab
title: Distinguish a missing question from an answer conflict at the reply boundary
ord: 69
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-df03-73aa-b4ae-e2cd5d28bddd",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/reply.stest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/refusals.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.parked.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadQuestion.ts
---
An answer to an unknown question id refuses `not-found` with a clear way out, while competing answers keep the interaction conflict. The distinction belongs to the Questions/ParkedQuestions core and its typed error; threads projects it onto the wire without extra wrapping. ThreadAggregateStorage.questionById finds the entry by question id through InMemory and SQLite/rested, so a closed question of a past run keeps the conflict, and a late identical answer joins the still-running owner. Repeat by key, waiting for an identical answer, and routed-question outcomes are preserved. Proof — narrow types, the owner test, the existing reply.stest, one independent Sol review, and the commit.
