---
id: 01a13f63-559c-7cb3-89b6-c446472a019b
title: "Landing reflections: submit_work and commit steps defects"
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c078-735f-9b04-6fb63dea71fe",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/carriers.ts
    symbol: heldPaths
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
    symbol: planPath
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/message.ts
    symbol: messageOf
---
The operator allowed changing API and contracts. Three remaining defects fixed and delivered by commit f38b0dc26c47a318a25bd3d5e31ab6dff642.

- [[9ad63e1f|Explicit selection of unattributed changes]]: `paths` enumerates the selected checkout's changed files via literal pathspec. Unattributed additions and deletions outside the command record enter the selection. Without `paths` only held work is still taken. Explicit `paths` now narrows paths taken through `taking` too. `unmatched` counts paths that passed eligibility, so a selected ignored path no longer vanishes silently. Holdings keeps slicing, the refusal on others' inseparable lines, and `whole`. System contracts of the explicit catalog and the retained peer path — 2 pass, 12 assertions.
- [[db040b8c|Child code-agent question]]: the scheduler no longer parks unattended from parentThreadId. A default run may wait for a question, an explicit `approval` special run (compaction) preserved, the addressee chosen by Approvers. The native child → park → parent notification → self-confirmation refusal → parent decision → single execution contract passed red→green: 1 pass, 8 assertions.
- [[caaa77ec|Duplicated tail after steps]]: root found in retirement. Debt windows applied independently: a reshaped block inserted while a peer held the old tail's deletion, and the fragments check then falsely closed the debt. A four-line red reproduced exactly two blocks. Debt payment now merges the whole before/after blobs' delta with working bytes via git merge-file and CAS. Same-path debts go by creation time. Conflict keeps debt and file. The unattributed record's mark is taken at publication. The new red→green and prior step/post-commit lifecycle contracts passed. The lifecycle file moved to system after 9218 ms CPU against the 8000 integration budget.

Checks. bun run typecheck of the agent package passed with dependencies. Server typecheck found no errors in changed paths, but overall ungreen from others' parallel edits: finishingFixture.ts:309, enforcement/contract/wire/document.ts:52, worktrees/creation/execute.ts:191,233, temporarily mcp/sdk.ts:476. Last runs ran on a saturated machine with memory pressure: debtRewrite and crossProject hit the 10-second timeout before the first assertion. With timeout 40 s debtRewrite passed in 5.2 s. crossProject not rerun, so its `paths` × `taking` joint stays unverified.

One independent review round: Sol xhigh and two Muse xhigh lenses. Confirmed and fixed: unattributed record's mark time, several debts' order, a clean-file mark only for an unchanged disk, `taking` outside `paths`, `unmatched` before eligibility. Rejected: "empty verdict ≠ clean" (an empty HEAD→working diff is clean) and extending coverage with tests beyond minimal contracts. Dropping a repeated debt in `onConflictDoNothing` predates this delivery and is practically unreachable. Gate ea465bed rejected the first attempt over Result-to-null conversion; the sides' reading rewritten without such conversion, and the second landing passed. Explanations: [[a2c44f94|whole transformation debt]], [[e88c8014|child run interactivity]].

Previous stage: the [[63b51bc0|tasks suffix in subject]] and [[a7bccf5f|refusal for the retained peer path]] fixed in b21bab8da3a0e576af5eeb9d1f0da9b5717b0a2, [[55abc971|expensive payload read]] — 8295e1f441819827bce159886a1692667f. [[56e7305b|EOF JSONC]] and [[0e651b57|programs directory]] did not reproduce.
