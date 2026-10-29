---
id: 01a13fb6-3354-7e75-83bb-e5b29a1eb2f6
title: Remeasurement of file-local inspections updates the ledger by the measured tree's delta
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523f-7ee2-9537-e8014a4925bd",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/ledger.ts
---
Post-landing remeasurement uses the confirmed Git tree's delta for file-local builtins: swallowed-failures, call-services, size, reexports. A declaration or implementation change, missing exact debt origins, or a vanished checkpoint tree triggers a full measurement; other Git failures stay failures. Dependency/global inspections keep the full measurement. The ledger outside the delta is preserved, and the fingerprint→file origin comes from verdict and checkpoint, with no path-name parsing. The checkpoint contract is described in [[1793ab98|measurement note]]. Landed in c1e3f8330a.

The public test verifies retirement of fixed debt, preservation of untouched debt and escape, telling `fix.ts` apart from `fix.ts keep.ts`, full fallback with no origins and with a vanished tree. Point lookup passes NUL-stdin metadata paths, so their volume never fills argv. Baseline substitutions of both boundary errors are red; the final narrow run is 6 passes, 21 assertions. Typecheck inspection and Git are green; the heavy whole-server check was not repeated. One review round is complete, confirmed findings fixed.

A paired source-replay of all eight working builtin worker-inspections on commit `6c0c0f9f7d861518ab41311439b8abd72c4977b3`, one pass each in identical 90 s windows: harness main-process CPU and finished Git children — 68.371 s whole, 7.390 s on the final delta implementation (−89.2%). Read provenance call-services: 3582→1; reexports: 7555→2; swallowed-failures: 4093→2. The remaining scopes' full verdicts and the matching file-local verdict slices agreed. This is one sample; source-config and script retained in this session's scratch (`remeasure-input.json`, `remeasure-window-bench.ts`). The current driver skips nine runner rules in both modes. The bench measures the whole worker-inspection cohort, but not end-to-end driver, graph/store, diff, ledger and notices. The installed server was not restarted, post-install measurement and stable machine CPU below 30% unproven.
