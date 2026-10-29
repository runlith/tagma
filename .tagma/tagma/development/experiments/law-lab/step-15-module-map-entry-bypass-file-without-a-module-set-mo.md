---
id: 01a164ef-4505-792f-8921-58f73c4f85ea
title: "Step 15 — module map: entry bypass, file without a module, set_module re-measures, narrowing yields an escape, a cycle is not recorded"
ord: 33
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — the module map judges an import by relations and entries: entry bypass and a file outside modules are refused with a way out through `set_module`; a map change re-measures the rule at once, and narrowing the map under standing code is recorded openly (escape), not silently; a map with a cycle is not recorded.

**Setup** — law-lab (project 39), HEAD `01e5f7d235`; rule [[13981632]] (`Imports.modules`, gate before `submit_work`), modules domain, ui, web; debt 1. Caller — a thread with a runlith home, bypass mode.

**Observation**
- Import `../../../packages/ui/src/Button` from web → `rule-violated`, fix "import through the ui entry or open an entry with `set_module`".
- `set_module` ui entry `src/Button.tsx` for web → re-measure 0.0 s; the same commit passed (`bb6900441b`).
- `set_module` dropping that entry → re-measure, `escaped: web -> ui private @ ExportCsvButton.tsx`; the escape points at commit `bb6900441b`; debt did not grow.
- `set_module` ui imports web → refused: cycle `ui -> web -> ui`, nothing recorded. The refusal's `inspection-failed` code and "then enforce again" are wrong — reflection [[9b754eef]].
- New file `packages/tools/src/id.ts` under a web import → `rule-violated`: "no module's territory covers", fix — give it an owner with `set_module`.
- `set_module` creates the tools module (root, entry) and the web → tools relation in one call → the same commit passed (`f930a39d62`).
- Import returned through `@law-lab/ui` (`c06e6e38c3`) → re-measure dropped the escape (escaped 0).

**Conclusion** — confirmed. Defect: wrong refusal code for a cyclic map. Not checked: `order` inside a module, the `testing` entry role and `imports-tests`, narrowing the map under review (must ask the operator).
