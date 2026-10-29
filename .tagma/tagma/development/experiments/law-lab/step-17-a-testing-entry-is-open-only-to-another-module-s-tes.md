---
id: 01a164f3-ed44-7306-ab25-3e1f140edb2f
title: Step 17 — a testing entry is open only to another module's test code
ord: 35
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — a `testing`-role entry opens a module's test helpers only to other modules' test code: a test imports, production code is refused.

**Setup** — law-lab (project 39), HEAD `e6691d0745`; rule [[13981632]] (`Imports.modules`, `tests: ['.test']`), gate before `submit_work`. New files: `packages/domain/src/testing/fixtures.ts` (`anExpense`), the `./testing` export in `packages/domain/package.json`, test `apps/web/src/seed.test.ts`. Caller — a thread with a runlith home.

**Observation**
- Before the entry: `check_rules` — `web -> domain private @ seed.test.ts`, fix "through an entry or open an entry with `set_module`".
- `set_module` domain entry `src/testing/` role `testing` → re-measure, debt 1 → 1.
- `seed.ts` (web production code) imports `@law-lab/domain/testing` → `rule-violated`: "a testing entry of `domain`, from code that is no test", fix's first item "Import it only from test code".
- Without the import from `seed.ts`, the test, helper and package export landed in one commit `1b32ac07fa`.

**Conclusion** — confirmed. Not checked: narrowing the map and debt growth in review mode (left alone to avoid bothering the operator for a check).
