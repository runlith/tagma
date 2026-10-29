---
id: 01a0d4db-9d7d-7a78-ab39-a9d0f2755a5b
title: A landing and a merge judge their tree against its base and refuse a new crossing made by their own lines; a driver retires debt and records escapes after
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d0a7-c14d-73e8-a333-1f082a55b1e4
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/Orientation.ts
    symbol: lawForest
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/commit.ts
    symbol: commitOwn
---
A landing and a worktree merge judge the tree they are about to commit against its base. They refuse a crossing that is new, outside the debt and made by the session's own lines, for each enforced rule whose reach covers a changed path. After they land, a driver re-measures the reach: it retires vanished debt and records crossings that got in. `inspect_work` answers the landing's verdict without committing.

## Where the judgement stands

- **Landing.** In `harness/submitWork.ts#commitOwn`, after `build(landing, base)` answers a tree with changes, and before `git commit`. A landing rebuilt on a moved HEAD is judged again, reusing parses by blob id.
- **Merge.** In `working/WorktreeFinishing.ts` `merge`, once the tree to commit is known and before it is committed. The judgement is reached through the landing-judge port `working/` declares ([[be584b76]] §5).
- **Rules.** Both read the rules of the graph served for the target:
  - the worktree's own graph for a landing in the worktree;
  - the base branch's graph for a merge into it.
- **Budget.** At landing, inspections run under the remaining landing budget as a deadline; at a merge, under the merge budget.

## What is judged

1. **Rules.** The judgement starts from the enforced rules of that graph, not from the changed paths. A rule is in play when:
   - its strictness is watch or gate;
   - its `at` fits (a landing runs `landing`; a merge runs `landing` and `merge`);
   - its reach covers a changed path. The reach is its containing region's directory and file sources, or the whole project for a root rule, intersected with `params.base`.

   When no rule is in play the judgement costs nothing further.
2. **Facts.** For each rule, the selected changed files (`params.files`) are read:
   - at the built tree and at the base, by the batch blob reader of `packages/git`;
   - each side resolved against its own tree's listing, so a renamed or removed target reads the same on both sides.

   A deleted file yields nothing on the built side.
3. **New.** New means the fingerprints the built side yields over the changed files, minus those the base side yields over the same files, minus the rule's debt. Subtraction is by fingerprint across the whole changed set, so a crossing that moves between files along the same directory pair is not new. An escape excuses nothing: only owned debt does. So another import along an escaped crossing is new.
4. **Whose.** Each new fingerprint is traced to the import lines that produce it:
   - a line the change record attributes to a live peer is **carried**;
   - every other line is the session's **own**, including a line nobody's record can place and every line under an asked-for `whole`.

   A merge's lines are all the branch's own.

## Verdict

- **Own, at gate:** refused `GateRefusal('rule-violated', …)`. The reason names each rule, file, line and crossing. `unblock`:
  - the builtin's own words;
  - land the caller's other paths with `paths`;
  - if the crossing is intended, change the rule by `enforce_rule` after the decision that says so.
- **Own, at watch:** lands; named in `watched`.
- **Carried:** lands at either strictness, because a peer's unfinished lines never hold a commit back ([[2a55b1e4]], [[621b98d5]]). It is named in `carriedViolations` with its holders, recorded in the rule's `escaped`, and told to the holder's thread through the existing delivery.
- **Unresolved relative specifiers:** named in `unjudged`.

## After landing: the re-measure driver

After each landing and merge through Tagma, and at server start, a driver re-measures each enforced rule whose reach the commit touched, over its whole reach at the new HEAD:
- debounced per rule;
- on the whole-reach worker;
- off every permit.

It writes one journaled act that:
- drops debt entries no longer found;
- adds to `escaped` every crossing found outside the debt and not already recorded, with the commit that brought it.

A non-empty `escaped` raises the finding `rule-escaped` on the rule; the doctor reads it off the document. So a crossing that got in through a carried line, a race with `enforce_rule`, or any road outside Tagma is visible until it is fixed or absorbed. The driver never adds debt and never changes strictness. It is wired in the same change as the gate ([[a00f91b0]]).

## `inspect_work`

- Input: `paths?`, `taking?` and `whole?`, the same as `submit_work`.
- It builds the tree the landing would build, on a temporary index, and runs the same judgement.
- It answers `{ refused, watched, carriedViolations, unjudged, ms }` and commits nothing.
- It takes no landing permit, because it moves no ref and no shared index.

## Failures

- At gate, an inspection past its deadline, a dead worker after one restart, a failed git read, an undecodable document or an unknown builtin refuses `inspection-failed`, naming the rule and the cause.
- At watch, the same lands and is named in `watched`.

## Acceptance

In a fixture repository with a `direction` rule at gate, each case lands or refuses as follows:
- A new upward crossing in an own file refuses `rule-violated`, and nothing is committed.
- The same crossing made under `whole: true` beside a live peer refuses.
- A second import along a debt crossing lands.
- A file keeping its base's crossing lands; so does a file renamed with its crossing, and a file whose import target was renamed in the same landing.
- A new crossing on a line the change record gives a live peer lands. It is named in `carriedViolations`, and after the driver runs it stands in `escaped` with a `rule-escaped` finding.
- After the last import of a debt crossing is removed and landed, the driver drops the debt entry.
- A watched rule's new crossing lands, named in `watched`.
- A merge of a worktree cut before enforcement, carrying an upward crossing, refuses at the merge.
- A changed `.json` file under the base lands, unjudged by `direction`.
- A worker held past the deadline refuses `inspection-failed` at gate, and lands at watch.
- `inspect_work` answers the verdict `submit_work` then acts on, `whole` included.
- A landing with no enforced rule in play records a gate span with zero inspections.

## Spec-list questions

This decision answers:
- 1: where it stands;
- 7: acceptance;
- 13: the driver;
- 14: the budget deadline;
- 16: failures, races caught as escapes;
- 17: spans and receipts, in [[be584b76]].

The rest are answered in [[be584b76]].
