---
id: 01a14007-f388-7299-9fbb-7496c81c7962
title: Migrate the budget tests to Effect and real memory ports
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/nativeThreadBudget.test.ts
---
Migrate nativeThreadBudget.test.ts to it.effect with direct ThreadMemory/InMemoryThreadRows/InMemoryThreadRuns, no storagePort factory. Remove the local BudgetThreads/BudgetRuns, inert casts and unused execution composition. Keep the 6 accounted-budget contracts: deep/detached descendants, root isolation/nonnegative remainder, unbounded root, foreign sender and spendable refusal. Seed through the public memory ports, accounting/budget as real layers. Change no production. Serial file test, file-scoped check with the parent's permission, law, one Sol+Muse round; evidence to the parent before landing.
