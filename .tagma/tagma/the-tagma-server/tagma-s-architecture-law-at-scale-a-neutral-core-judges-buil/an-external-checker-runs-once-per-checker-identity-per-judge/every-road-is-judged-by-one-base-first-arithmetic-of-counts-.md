---
id: 01a0f4ab-e305-70d0-b091-90015a470ad3
title: Every road is judged by one base-first arithmetic of counts and values, programs and SARIF included
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f55d-a0a4-75cc-b3cb-05d2da4f8274",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
---
Every road — builtin, program, SARIF — is judged by one arithmetic: per key, base-first counts and the value ratchet, never merged duplicates ([[d11108eb]] §4.4; M9 of [[9140c692]]). Changes no law in force: it only stops two defects from passing (a program's grown `value`, duplicate violations merged into one).

**Class:** medium — `claude-sonnet-5-5` high.

**Target:** the core counts occurrences per key on each side; where the complete base reading covers the key's path its count and value are the allowance and the debt is not consulted (as `judgeReadings` does for values today); otherwise the debt's `count` (1 when absent) and `value`; never base plus debt. Programs and SARIF go through the same core function instead of `programs/run.ts`'s fingerprint set. A SARIF result without `partialFingerprints` keeps its duplicates counted.

**File scope:** `apps/tagma/inspection/src/core/node/judge.ts`, `apps/tagma/inspection/src/core/verdict.ts`; `apps/tagma/server/src/enforcement/programs/run.ts`; the builtin producers whose semantic units need all contributing sites, and enforcement's counted-excess attribution. Base-side attribution is produced by `change-record/lines/attribution.ts` and exposed through `change-record/contract/service/prepared.ts` and `change-record/prepared/subject.ts`; enforcement consumes that contract, without a second attribution store. An unknown or multiply claimed deletion gives no favourable own-removal credit.

**Acceptance:** [[d11108eb]] §7's duplicate cases (base 2 with debt 2, built 3 → one new; built 1 then back to 2 → one new; debt 3, base 1, built 2 → one new) and a program's `value` above its base or debt refuses; `check_rules over: all` unchanged for runlith's 13 rules; typecheck; tests.

**Reviewers:** one Muse lens (arithmetic against the decision's cases), `gpt-6.1-sol` high general.
