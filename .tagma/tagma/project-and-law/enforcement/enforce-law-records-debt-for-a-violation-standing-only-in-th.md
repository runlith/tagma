---
id: 01a14a84-f5ca-72b8-8ca5-dd98051babb5
title: enforce_law records debt for a violation standing only in the calling session's uncommitted change
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a55-73a4-7d5e-86a3-fb1085616c41",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14a2f-f83d-73c7-8bd7-33d4c95002a5
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/held.ts
---
enforce_law measured absorb by HEAD only and refused a fingerprint missing there, while the submit_work gate wouldn't let a commit with a new violation outside debt through: the "debt for a new task" path from rule 6b3210c7 was a closed circle (managed-browser/host.ts, 668 lines, browser-desktop thread).

To do: a fingerprint from `absorb` missing in HEAD is sought in the calling session's change with the same court as check_law over change; a found one becomes debt held for that change (`held`: base and file). Remeasure doesn't drop such debt while HEAD doesn't carry it and its file hasn't changed since base; a landing carrying it drops `held`.

Proof: an integration test through the enforce_law operation body with a thread caller — a violation in the working tree only → debt recorded → remeasure holds it → check_law doesn't refuse → submit_work lands → after remeasure the debt is ordinary.
