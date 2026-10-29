---
id: 01a165c0-d698-78cd-a91e-30279cc35d02
title: A cancelled call's answer explains the host stop and unknown side effects
ord: 103
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165c0-33d8-77df-b362-0408e8790566",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a165bf-9470-73af-bb5e-ecdee2a7ddd4
---
A cancelled `submit_work` on 2026-10-22 at 22:32:44Z coincided with a planned server replacement: restart.json records the thread-stack closing at 22:32:43.243–22:32:44.271Z, activity records host-stopping and the adopted aftermath. The tag-declaration update only arrived the next turn; the instructionRule road does not close the harness. Per the launcher's clarification, fix the cancellation cause at RunExecution.shutdown: name the host stop, the call interruption, and the need to verify the recorded outcome and state before retrying; promise neither rollback nor a commit's absence. This is a message fix; cancellation and unknown contracts are covered by existing tests, no new test for a text copy is needed.
