---
id: 01a18d3d-abce-7ac0-a4c4-0ae425400674
title: "Enforce five architecture checks: repeated declarations, dead code, vendor ids outside vendor code, a module coupling ratchet, and the ask door's import boundary"
ord: 22
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0ea9b-790b-786c-9051-1143144dfedc
  - kind: relates
    to: 01a18cbf-8498-75d8-913f-c74f6f376186
---
The architecture review of the asks work (task f1fc96ce) found 20 defects. Eight of them are mechanically detectable, and the rules that forbid them exist only as text: [[144dfedc]], [[1ed7586f]], [[51c66cb6]], [[dd380bf6]] and [[2fcf2221]]. Of the rules in this area, only [[083d37f1]] is enforced.

Make four of those defects measurable, as inspections in `tagma.config.ts`, each enforced through `enforce_rule` on its rule:

1. **Repeated declarations.** Structurally equal object or union types, and equal literal sets, declared in more than one file. These enforce [[144dfedc]].
2. **Dead code.** An export no production file imports, and an exported function no production code calls. A test-only reach counts as dead. This needs a new rule.
3. **Vendor ids outside vendor code.** A provider or CLI id string in server code. This is the string inspection of spec [[6f376186]], acceptance 1, with that spec's exemptions. Its standing violations are debt owned by spec [[57787448]].
4. **Coupling ratchet.** For each server and package module: the number of modules it imports from, and the share of its imports that leave the module. Neither value may grow above its recorded value. Today's values are the debt, and a new module starts at the project median. This needs a new rule.

5. **The ask door's import boundary** (acceptance 1 of [[bcec10b7]], not yet built):
   - `translations`, `threads/naming`, `threads/recap`, `threads/decisions` and `native-harness/compaction` import neither `ModelAccess`, `DecisionModels`, `HarnessAsides` nor a harness row.
   - The builtins cannot express this boundary. It needs `HarnessAsides` moved out of `threads/contract/service/engine.ts` into its own contract file, and a path-scoped named-import inspection.

Order:
- Each inspection is first tried with `check_rules` and its findings read for false positives.
- It is enforced at `watch` while part 1 of spec [[6f376186]] is landing.
- It moves to `gate` once task [[e0faa87f]] has landed.
- Standing violations, other than those of item 3, are debt owned by a new task under this area, which the same work names.
