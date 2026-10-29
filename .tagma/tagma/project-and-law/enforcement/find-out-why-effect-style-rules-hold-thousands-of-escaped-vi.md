---
id: 01a15120-d7b5-7ccf-a27e-5e7c97277b07
title: Find out why Effect style rules hold thousands of escaped violations, and give standing violations to owners as debt
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-44dc-7153-9d21-31ce6f788e20",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a13b76-3d46-78eb-b352-1c358fcfef49
  - kind: relates
    to: 01a14c37-8de4-7192-a313-0273f4560718
---
Thousands of Effect style-rule violations count as escaped — they stand in code without being debt: [[8fcfef49]] 1485, [[bc8f1e15]] 222, [[01ba3d55]] 215, [[373e29e4]] 79 (and [[d270a238]] 3620 in tests). The last measurement of these rules is October 14–15, so the count may not match current code.

Find out:
- whether these violations still stand (remeasure on current HEAD);
- how they passed the gate — a landing bypassing submit_work, a rule enabled over standing code with no debt recorded, or a defect of the measurement itself;
- if they stand — record them as debt through enforce_law onto module tasks, so the violation has an owner.

If the cause is a Tagma defect (measurement or escape recording), it is fixed at the root in this work or taken out as a discovered-from task. The violations themselves are fixed in module tasks, by hand, with no mass-replace scripts.

Outcome (2026-10-18). Escaped was recorded by the first rule enablement on October 14: enforce_law then didn't accept one owner for the whole set (reflection [[73ee6a06]], since then it has `owner`), so all standing violations landed as escaped instead of debt on [[449dfe0d]]. Nothing passed the gate. The code was then restyled, but a repeated measurement doesn't run program rules ([[f4560718]]), so the records went stale. On HEAD all seven effect-style rules report 0 violations, there is nothing to record as debt. A repeated enforce_law with the same inspection removed 5621 escapes and 1173 debt records [[df923180]] and [[673f881b]], whose owner is already done.
