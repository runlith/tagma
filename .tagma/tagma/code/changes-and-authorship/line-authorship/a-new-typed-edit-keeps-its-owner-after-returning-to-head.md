---
id: 01a12ca1-8f79-72b3-90ab-0121f617c346
title: A new typed edit keeps its owner after returning to HEAD
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f8-75d1-a0c3-27f858a6f9e9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c9a-b175-7a1b-9005-74f63163cb5a
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/fold.contract.test.ts
---
A new typed edit keeps its owner after returning to HEAD.

Fix the authorship of a new record after returning to HEAD; check the neighbouring messages about generator attribution without changing how arbitrary nobody's lines and held/left projections are accepted.

Checked reflections:
- [[3163cb5a|the repeated edit that went nobody's]].
- [[a5ecf3a0|the skipped generator directory after overlap]].
- [[f86551ab|whole that skipped 17 script paths]].
- [[c0191192|the old short-command rule that gave lines to the neighbour]].

The root of [[3163cb5a|the lost authorship of a repeated edit]] is confirmed by a read-only read of a narrow set of workspace_change rows and git blobs. W1 A→B is recorded at HEAD eaadfa68be48d42ddcda94d1b1fbe5170870d284; W2 B→A and W3 A→B at 48c7e091fa40f85a6791090f858a14c53af8d1. Both HEADs hold identical bytes A (sha256 prefix 204d5af23dbd4143), B has digest 5e9f249bf1cd43c7. W1 is withdrawn as reverted; W2, whose own HEAD has not moved yet, is kept for recovery. After W1 left, the new fold wrongly restored its snapshot without an author against observation B. The clean chain of all three standing lines of the owner never lost anything; the first line leaving was the point. The fix is in folding.ts: a snapshot tells an observation apart from the result of a recorded transition. A new record applies by hunk on matching the observation; snapshots from the standing chain restore the former marks. Before the fix, the contracts of a new record after an early writer left and of a no-op before a repeated record failed; an external return without a new line already kept nobody. After formatting, 55 unit fold/contract/fuzz/lives/commands contracts passed; the earlier run also proved 3 worker contracts from walks.itest.ts.

The fold keeps one boolean per snapshot and turns the decision into an existing lookup; no whole-history scan is added. The cost of a new valid edit stays with the existing hunk/gap mechanism; the positional-budget tests of a large frontier pass. That is a complexity estimate, not a measured speedup. One round of independent review: Sol xhigh and two Muse xhigh lenses; no blocking defects found. The question of `recorded` inheritance on restoreFold is checked against callers: the new digest enters the standing chain through the recorded reverts transition; preview restoreAt returns the result separately and does not replace the fold cache.

The directory expansion of eligibility was not done: 126b3adfe8 already rolled it back, because commands.unattributed holds paths of every writer in the overlap window. An exact file name and whole are the existing road for explicitly chosen bytes; a shared directory never proves which of its paths the caller wrote. sessionTools.ts fixes the wrong promise that paths always land observed paths, and observation is no longer passed off as one's own record. There is no new [[9ad63e1f|ability to accept arbitrary nobody's lines]]. Carriers and submit held/left did not change.

A real in-process edit/retirement run after neighbouring provider edits finished passed in two cases: the first edit typed or external, then a typed undo and a typed repeat. The final result belongs to the caller in both (+1/−1, nobody empty); retirement with its own unchanged HEAD withdrew no lines. The first line leaving is reproduced separately by the cold/cached foldPath contracts. Tagma:try's own build `8a0ffd78e2-dirty 20261011T204729129Z` answered health ok on 7431 and was stopped; the operator's server is untouched. The diff is checked, oxfmt --threads=3 and diff --check are green.

The shared `bun run typecheck` at 22:42 reported 33 errors in 8 server-check files outside the delivery; none of the three changed files is among the errors. In particular: `selection.ts(74,52): error TS2367: This comparison appears to be unintentional because the types 'readonly MarkedLine[]' and 'string' have no overlap.` The remaining errors are capture/provider fixtures; they describe the tree at check time, not a claim about the later state of other people's files.

For [[a5ecf3a0|the skipped generator directory]] the surface's false promise is removed, but accepting the directory of overlap paths is deliberately not widened, so the original request to land the directory is not reported as resolved. For [[f86551ab|the skipped script paths]] the original corpus of 81 paths and the reason 17 exact paths dropped out of it are not recovered; the reflection gets no answer about a complete fix. For [[c0191192|giving lines to the shorter neighbour]] the old shortest/lengthOf/beats root rule was already removed by ad0de711a9e30604b22321e7f46b2cf5cf, which is reachable from HEAD: its diff, the current lives.ts and the green contract of two overlap commands were read. The old Python trace and the wrong historical lines were not replayed; the current overlap keeps nobody rather than giving it to the shorter neighbour.
