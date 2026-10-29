---
id: 01a0f534-c7bf-71ba-86c9-796abfbf1086
title: Move catalog-tag literal checking into runlith's oxlint plugin and prove parity with names literals before adoption
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f548-131c-7e5a-87ad-81ec5fc826da",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
---
Implement the project-local oxlint check for catalog-tag literals in tag positions, as [[cdf2a89f]] §4.1 and [[3087c3ed]] require. This is the existing `names.checks.literals` semantics moved out of Tagma, not an additional policy. Class: complex — gpt-6-astra high, one implementer.

**Owner and scope:** runlith's `checks/lint/` plugin and its minimal parity corpus; project-local lint configuration if needed to invoke that plugin. Package/lock changes only for the actual pinned checker needed to run the contract. The old implementation is `apps/tagma/inspection/src/packs/repository/names/literals.ts`, with `reading.ts#report` and the code-facts TagLiteral producer; read these and their owners before implementing. No changes to graph-core behavior, the generic runner adapter, existing builtin algorithms or adopted rules. The generic oxlint adapter remains [[be843c7e]]; this task's plugin can be built and measured independently before it is wired to that adapter.

**Target:** recognize the same compare/argument/property/lookup tag positions, with the same parameterized words, region and allowIn meaning. Policy data stays in the project's config/options; no catalog list is compiled into Tagma. Preserve the old semantic unit `(file, literal word, position)`, its occurrence count/value and the evidence positions. Read the real pinned oxlint plugin API and output contract, not a remembered ESLint approximation. Do not claim stable fingerprints or value parity from messages or source-order ordinals; if the actual adapter/output cannot carry the old unit, report the exact interface gap before substituting another unit.

**Acceptance:** a reproducible parity reading against the existing names literal check on the same HEAD and a small mutation corpus covering all four positions, allowed locations, ordinary non-tag strings, and multiple same-key occurrences. Compare semantic findings, counts and scope, not only process exit or a clean HEAD. Run the real checker/plugin through its public CLI or API with the minimum process count; no static-copy assertions or private-helper-only tests. Keep unrelated rule checks disabled during this parity comparison. Record checker version and commands/results; code, corpus and minimal invocation configuration land in the checkout, reports stay in graph or scratch.

**Boundaries:** no enforce_rule, debt absorption, weakening, gate removal, trust-root act or server restart. Do not delete names before its active consumers migrate. Adoption and CI gating remain pending the operator's explicit word and the generic runner/identity readiness. Report plugin readiness separately from its later Tagma adoption. If no standing policy supplies exact words/region, keep options explicit and state which proposed project configuration awaits adoption rather than inventing a new default obligation.

**Checks/review:** typecheck and the smallest meaningful checker/parity tests, at most 3 workers and within the current one-minute command bound. No repository copy for implementation. Muse correctness/parity and performance lenses, then Sol high general review; the lead commissions them. Claim before work, write concise claims from the code, commit own lines with submit_work, and report in Russian; do not finish before the lead evaluates the evidence.
