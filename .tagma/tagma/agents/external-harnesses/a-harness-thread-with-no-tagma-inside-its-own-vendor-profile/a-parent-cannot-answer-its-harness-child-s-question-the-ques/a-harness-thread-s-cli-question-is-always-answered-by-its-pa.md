---
id: 01a14493-8ddf-74c2-ae0c-8aaf3b8178f6
title: A harness thread's CLI question is always answered by its parent, with no grant and no mode check
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141bd-4d86-7052-9111-958c8dc139ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1447a-d5c9-726c-8b02-3941e75b3793
---
The operator rejected f137010f8b: demanding a `cli-question` grant from the parent to answer its own harness child's on-screen CLI question is bureaucracy aimed at our own agents (rule 06e41b6f). The live refusal: the parent in bypass got `not-the-approver`.

To do: the on-screen CLI question (`cli-question`) is assigned to the parent always — no `agent.approves`, interception or mode check; the parent always gets the envelope; the operator answers too. The approval policy of Tagma acts does not change. Proof: a grant-free system test, typecheck, Sol xhigh review.
