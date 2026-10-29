---
id: 01a15f72-c0eb-7aeb-9a86-ad154ea4fd5e
title: "Operator words: one door with first-act persistence, one turn after a stop, visible suppressed wake"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f72-9a8c-75ab-9a49-b17a6640f5b5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24da026af37c
---
Spec implementation: steer/send persists the word in the inbox before the scheduler's decision; the steered answer carries the itemId; after a stop all waiting words open one turn; a suppressed wake is visible in the thread snapshot and client; the inbox writes with its own short record; `Unconfirmed` on ACP only when the agent could have read the word; the mid-turn word-read moment is part of transport registration.
