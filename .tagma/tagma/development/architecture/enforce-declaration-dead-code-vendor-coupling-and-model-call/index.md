---
id: 01a18d3d-abce-7ac0-a4c4-0ae425400674
title: Enforce declaration, dead-code, vendor, coupling and model-call checks
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-8498-75d8-913f-c74f6f376186
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: relates
    to: 01a0ea9b-790b-786c-9051-1143144dfedc
  - kind: relates
    to: 01a18cbf-8498-75d8-913f-c74f6f376186
---
The architecture review of the asks work (task f1fc96ce) found 20 defects. Eight of them are mechanically detectable, and the rules that forbid them exist only as text: [[144dfedc]], [[1ed7586f]], [[51c66cb6]], [[dd380bf6]] and [[2fcf2221]]. Of the rules in this area, only [[083d37f1]] is enforced.

Make five of those defects measurable, as inspections in `tagma.config.ts`, each enforced through `enforce_rule` on its rule:

1. **Repeated declarations.** A direct alias of an imported type; same-name equal types in different modules; or a type with at least three members or literal alternatives equal to an exported type of a module its owner already imports through a production relation. Equal shapes under different names in unrelated modules and types within one module are not findings. The historical RecapSelection/ThreadSelection copy (review Q7) is not caught by this inspection: same-module, outside [[144dfedc]]. This enforces [[144dfedc]].
2. **Dead code.** An export no production file imports, and an exported function no production code calls. A test-only reach counts as dead. This enforces [[aabef712]].
3. **Vendor ids outside vendor code.** A provider or CLI id string in server code. This is the string inspection of spec [[6f376186]], acceptance 1, with that spec's exemptions. Its standing violations are debt owned by spec [[57787448]].
4. **Coupling ratchet.** For each server, app and package module: the number of modules it imports from, and the share of its imports that leave the module. Neither value may grow above its recorded value. Today's values are the debt, and a new module starts at the project median. This enforces [[acafebe1]].

5. **Direct model calls** (acceptance 1 of [[bcec10b7]], rule [[93f04f23]]): `ModelAccess.request` and the requests it returns are called only in `providers` and the native chat turn (`native-harness/kernel.ts`, `native-harness/assembly.ts`); an aside's `ask` is called only in `threads/asks.ts`; a vendor harness row is read only in `external-harnesses` and `threads/harness`. The inspection judges calls and row reads across server code, including later features. Provision, publication, watch, clear and metadata imports stay allowed. `HarnessAsides` has its own contract file.

Before any enforcement, fixtures prove findings, clean code and named edge cases. Measure existing commit judging without and with each check and with all five together on small and large source commits; the combined increase must be at most 10% on both. Commit work follows changed sources and affected frontiers from a revision-keyed index; whole-repository work runs only on explicit remeasure. A missing starting index requests remeasure.

Order:
- Each inspection is first tried with `check_rules` and its findings read for false positives.
- It is enforced at `watch` while part 1 of spec [[6f376186]] is landing.
- It moves to `gate` once task [[e0faa87f]] has landed.
- Standing violations, other than those of item 3, are debt owned by a new task under this area, which the same work names.

The four inherited missed-finding defects are fixed with regression fixtures in `ab621f8d98`; 46 affected tests passed seeds 1/2/3, 11 adjacent tests and typechecking passed. `35f977c1e4` aligns vendor scope with the feature/harness directories and allows the native chat turn's runWebs calls. The renewed work audits findings before enforcement, applies the shared-ownership definition above, and measures paired small and large commits in commands of at most 30 seconds. The combined 10% cost budget and enforcement remain unproved.
