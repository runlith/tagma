---
id: 01a0ea84-08f1-715e-8a84-8cab4e4b72ad
title: Bound enforcement judgement cost to the changes judged
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e519-2c8e-7307-95c7-b14b4134178c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e532-cbb8-77b2-b7ee-c75c06488be1
---
After enforcement M3 [[06488be1]] and its N [[61313d88]], remove nine pre-existing judgement costs found by the independent Muse performance lens. Fix each at its producer, preserving gate results, durable replay, rule order and failure policy; cost must follow what changed instead of the whole project. A Muse performance-only reviewer checks the resulting code before it lands. No integration or system tests in this wave.

1. `enforcement/judging/judge.ts:inPlay`, `rules/reach.ts:reachOf`, `remeasure/rule.ts:chosenRules`: share a versioned enforced-rule/reach reading across before, record and remeasure rather than scanning all rules/descendants for each phase.
2. `enforcement/commits/queue.ts:loaded`: bound durable JSONL replay by compacting done markers while retaining unread lines and waiting commits.
3. `enforcement/judging/ruleChecks.ts:triggerIndex.indexed`: single-flight each per-project TTL miss, preserving epoch invalidation.
4. `enforcement/remeasure/driver.ts:landed/checked/select`, `remeasure/rule.ts:byAncestry`: bound per-event selects and replace pairwise git ancestry with one ordered reading; a failed ancestry read must fail the judgement, not answer false.
5. `enforcement/workers/lanes.ts:inspections`, `judging/judge.ts:judgingBuilt`, `judging/check.ts:checkHead`: bound concurrent independent rule judgements and workers without serializing every project's gate on one global worker.
6. `enforcement/workers/slicing.ts:slicedJudge`: slice only the rule's relevant reach and share tree material across rules in one judgement.
7. `enforcement/workers/inspecting.ts:pointInto` and its git plumbing at lines 127–346: avoid mutating shared listing cache and repeated sorting for each batch; route git through `@runlith/git` or the platform git kit instead of inline commands.
8. `enforcement/workers/workdirs.ts:warmed`, `check.ts:checkHead`: avoid full-tree setup for an already-matching tree and hoist the workdirs owner out of the per-rule loop.
9. `enforcement/judging/check.ts:checkChange`, `programs/run.ts:runProgram`: batch changed-line holders across rules and reuse SARIF base-side verdicts keyed by program and base tree.

The current enforcement cut changes `enforcement/lineage.ts:renamedBetween` so failed rename history refuses `inspection-failed`, instead of returning no renames; keep that failure behavior when optimizing ancestry and replay.

Completion: targeted unit tests, calibrated server typecheck, `modules` and `names` inspections, and an independent Muse performance lens confirm the nine producer costs are bounded without changing gate/refusal outcomes. Report any cost whose underlying contract prevents this before changing that contract.

Outcome: Rule/reach snapshots, queue replay, trigger misses, event selection, common-case ancestry, worker concurrency, listing caches and holder attribution were bounded. Three contracts still prevent the requested shortcuts: `platforms` cannot narrow slices without an exhaustive reverse-import index; writable program trees can change ignored and setup-kept files, so same-tree setup and cross-rule workdir reuse cannot be skipped safely (the runlith sample in [[d7971d4b]] measured a warm move at 0.49–0.92 s and a new clone at 12.5–15.0 s); and SARIF programs are not pure in rule, caller, parameters or environment, so a base verdict keyed only by argv and tree cannot be reused. Deep git history takes the original exact pairwise reading if the bounded single walk cannot read it. The independent Muse performance lens found the bounded path sound after these corrections; full server typecheck remained unproved amid concurrent non-enforcement errors, and source verification waits for merge into main.