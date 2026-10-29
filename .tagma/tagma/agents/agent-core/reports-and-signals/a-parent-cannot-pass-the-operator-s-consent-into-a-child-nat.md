---
id: 01a11971-8250-7a3f-8809-04d99d41e331
title: A parent cannot pass the operator's consent into a child native thread; enforce_rule in the child thread refuses nobody to ask
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "enforce_rule in the child thread refuses \"this surface has nobody to ask\" — the operator is never asked at all; the parent has no operation to answer a native child's consent (answer_ask is only for harness threads); the work stood still until the operator ran `tagma op enforce_rule` himself",
    "command": "impl-lifecycle (child native thread, 01a11935-3f81-7583-b74d-de27fe59bc57) calls enforce_rule on ea465bed; the orchestrator parent tries to confirm consent on the operator's word",
    "expected": "The child thread's call asks the operator (review/trust), the question is visible to the operator; a parent given the word by the operator can answer the child's consent (rule 60ed5208: the operator's word through an agent is the operator's word)"
  }
---
Filed from project `runlith`.

Consequence: the foundation-refactor worktree HEAD did not build until the operator performed the act by hand. The operator expected the orchestrator parent to confirm consent on his word.
