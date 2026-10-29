---
id: 01a0f4ab-e2f6-78f8-ba27-652f269a2dc5
title: A landing or merge re-checks its base tree and accepted revisions immediately before it publishes
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4ea-5e0d-7fab-8a66-f146a7add57c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
---
Release N (order A of [[9140c692]]). Immediately before a landing or a merge publishes, re-check the base tree and the accepted revisions the judgement used; if either moved, judge again, reusing only raw readings with exactly the same keys ([[172759d0]] §4.2 publication race). A reading made under an old revision never retires debt or authorizes publication under a new one.

**Class:** complex — `claude-opus-5-5` high.

**File scope:** `apps/tagma/server/src/enforcement/judging/**`, `enforcement/contract/service/judge.ts`; the publish points of `submit_work` and `merge_worktree` only through enforcement's `RuleJudgement` port (the fewest lines in `landing/` and `worktrees/`).

**Acceptance:** fixture tests — a base that moves between judgement and publication is judged again; an accepted revision that moves is judged again; the second judgement reuses readings only with identical keys; debt is retired only by a reading of the published revision. Release N also wires the final law check and publication into the acceptance permit built by [[53727148]], through enforcement's port; a digest read alone is not race protection. Declare the rank and call order under [[511b13e3]] before wiring: no waiting for the commit lane under this permit, and no hooks or re-judgement inside it. Exercise a revision movement between `holds` and publication. Typecheck; enforcement tests.

**Builds on:** the adoption code of task 53727148 (a828991471: `enforcement/adoption/predecessor.ts#governingRules`, `contract/service/acceptedLaw.ts`, the line revision with compare-and-set), under review while this task runs.

**Reviewers:** Muse lens (races and restarts), `claude-opus-5-5` xhigh, `gpt-6-astra` xhigh (law-astra).
