---
id: 01a16425-1e63-70b5-afdd-28ffe46b150a
title: A child's questions are answered by its parent by default, and a question its parent would itself have asked rises past it to the root and the operator
ord: 99
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16425-5b66-764e-b48e-b6618109c47d",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a11c26-7d19-7b9a-8bcc-295a52a9ca4e
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927ef2dc414b
---
By default a child's questions are answered by its parent, and a question its parent would itself have asked rises past it to the root and the operator.

The 2026-10-22 operator decision reverses the [[52a9ca4e]] spec route "operator by default, parent only by grant": a child asks its parent, not the operator — as a grandchild asks its father, not its great-grandfather. Today `agent.approves` defaults to empty, and with no grant the child's question waits for the operator.

Do:
- a child's question approver is its parent by default; this covers approval questions and `ask_user`;
- the approval mode decides what to ask about, not who answers: the "one step at parent and child" condition goes away;
- a parent's permission for an act its own mode would have asked about becomes that parent's question to its own approver — so the question rises to the root, and the root asks the operator;
- the setting stays: `agent.approves` and `/approves` narrow what the parent answers, with everything as the default;
- operator-word interception, a root without a parent, and a detached thread ask the operator, as today.
