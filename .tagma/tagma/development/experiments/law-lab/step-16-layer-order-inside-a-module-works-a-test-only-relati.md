---
id: 01a164f2-59a6-75c5-a0e3-912af3cd91dd
title: Step 16 — layer order inside a module works; a test-only relation cannot be recorded, the refusal leads to a production relation
ord: 34
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "refuted"
  }
---
**Hypothesis** — layer order inside a module (`order`) refuses an upward import; an import from a test file into a module without a relation is refused with the "test-only relation" (`imports-tests`) way out, and that relation is recorded.

**Setup** — law-lab (project 39), HEAD `15de589349`; rules [[13981632]] (`Imports.modules`, `tests: ['.test']`, `cycles: refuse`) and [[18ad9402]] (`Loading.forbid` from `packages/domain`), gate before `submit_work`. Caller — a thread with a runlith home.

**Observation**
- `set_module` domain `order` [money] < [expenses, rates] < [everything else] → re-measure, no new violations.
- `money.ts` imports `./rates` → `rule-violated`: "imports … on or above the floor of money.ts", fix — move it lower or reorder the layers with `set_module`. Edit dropped, never committed.
- `tests/rates.test.ts` imports `@law-lab/ui` → refusal from two rules: domain-no-ui (by design — it judges tests too) and modules. The modules fix: "add the relation `domain → ui`" — a production relation, although the file is a test.
- `set_module` domain `importsTests` put ui → refused `inspection-failed`: cycle `domain -> ui -> domain`. A test-only relation counts in the cycle; `read_inspections modules` confirms "Cycles are judged on the relations".
- Test edit dropped, law-lab clean.

**Conclusion** — `order` confirmed. Test relations refuted: the fix leads to widening the production boundary, and the right way out cannot be recorded. Reflection [[ac2867a2]], fix with the test-relations agent. Not checked: the `testing` entry role, narrowing the map under review.
