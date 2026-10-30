---
id: 01a18d3d-abce-7ac0-a4c4-0ae425400674
title: Enforce declaration, dead-code, vendor and model-call checks
ord: 22
tags: ["task"]
fields:
  {
    "status": "open"
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

Make four of those defects measurable, as inspections in `tagma.config.ts`, each enforced through `enforce_rule` on its rule:

1. **Repeated declarations.** A direct alias of an imported type; same-name equal types in different modules with at least three members or alternatives; or a type with at least three members or alternatives equal to an exported type of a module its owner already imports through a production relation. Equal shapes under different names in unrelated modules and types within one module are not findings. The historical RecapSelection/ThreadSelection copy (review Q7) is not caught by this inspection: same-module, outside [[144dfedc]]. This enforces [[144dfedc]].
2. **Dead code.** An export no production file imports, and an exported function no production code calls. A test-only reach counts as dead. This enforces [[aabef712]].
3. **Vendor ids outside vendor code.** A provider or CLI id string in server code. This is the string inspection of spec [[6f376186]], acceptance 1, with that spec's exemptions. Its standing violations are debt owned by spec [[57787448]].
4. **Direct model calls** (acceptance 1 of [[bcec10b7]], rule [[93f04f23]]): `ModelAccess.request` and the requests it returns are called only in `providers` and the native chat turn (`native-harness/kernel.ts`, `native-harness/assembly.ts`, `native-harness/turns/runWebs.ts`); an aside's `ask` is called only in `threads/asks.ts`; a vendor harness row is read only in `external-harnesses` and `threads/harness`. The inspection judges calls and row reads across server code, including later features. Provision, publication, watch, clear and metadata imports stay allowed. `HarnessAsides` has its own contract file.

Before any enforcement, fixtures prove findings, clean code and named edge cases. Measure existing commit judging without and with each check and with all of them together on small and large source commits; the combined increase must be at most 10% on both. Commit work follows changed sources and affected frontiers from a revision-keyed index; whole-repository work runs only on explicit remeasure. A missing starting index requests remeasure.

Order:
- Each inspection is first tried with `check_rules` and its findings read for false positives.
- It is enforced at `watch` while part 1 of spec [[6f376186]] is landing.
- It moves to `gate` once task [[e0faa87f]] has landed.
- Standing violations, other than those of item 3, are debt owned by a new task under this area, which the same work names.

The four inherited missed-finding defects are fixed with regression fixtures in `ab621f8d98`; 46 affected tests passed seeds 1/2/3, 11 adjacent tests and typechecking passed. `35f977c1e4` aligns vendor scope and the native turn. Shared module ownership landed in `6ea852a4ec`, the structural minimum in `583d1787e4`, and namespace/inline imported aliases in `c0122dc46a`, both missed alias forms proved red before the fix. At `c0122dc46a`, whole readings found 88 repeated declarations, 5167 dead exports/functions and no vendor or caller violations. All 41 structural findings were read, including every same-name group; no remaining three-member homonym was found. Dead-code findings were audited by a stratified sample of 48. The accepted cost measurement at `b2cc9228a5` uses six alternating, identical-tree controlled program-envelope pairs per frozen workload, on a 12-core/32-GiB machine: 3 changed files add median 839.115 ms CPU (range 776.38–962.19) over a full baseline median 24548.15 ms (23790.23–25016.48), or 3.42%; 23 files add 1533.885 ms (1290.02–1699.60) over 30662.9 ms (25802.68–35523.12), or 5.00%. Both satisfy the combined 10% budget. Whole-judge pairs under contention are noise evidence, not the budget result: small +21.08%, −0.97%, −2.43%; large +6.38%, +3.91%. An interrupted large pair has no completed row and is excluded. Raw samples, frozen paths, generator and statistics are retained in the implementing thread's scratch; each measurement command has a 30-second life. The inspections were enforced at gate before submit_work and merge_worktree at `51ed628fe8`: 88 repeated and 5058 dead debt entries are owned by open task 5a3bed29; vendor and caller findings are zero, with no escapes. The dead rule's reach excludes 109 findings of the benchmark's broader whole-base reading. Public check_rules confirmed the vendor and caller checks clean again at `2ed87d0a`. The cost figures above were measured with a fifth inspection, a module coupling ratchet, which the operator then removed with its rule in `973b7b0028`: its module count duplicated the card relations the module rule already gates, and its share ratchet refused correct imports.
