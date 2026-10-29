---
id: 01a1296e-2b84-7b24-86ed-b48e55296039
title: claim_task refuses graph-pool on conflict markers that Tagma's own graph landing leaves in the worktree for an instant
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "refused[graph-pool]: .tagma/runlith/condition-typed-refusal-best-effort/index.md \"holds git conflict markers: a merge of the graph was not finished\", unblock: resolve the conflict and git commit, or git merge --abort. Seconds later the file held no markers, git ls-files -u was empty, and the same call succeeded unchanged.",
    "command": "claim_task {blockId: \"854c7e1f\"} in worktree tagma-holder-impl-f0e304 at 2026-10-11T05:27Z",
    "expected": "The claim runs, or waits for the in-flight graph landing of the same worktree to finish; a transient state of Tagma's own landing is not reported as an unfinished user merge."
  }
---
Filed from project `runlith`.

Reflog of the worktree: `84d506945f reset: moving to HEAD` at 07:26:52 +0200, then `6ac309b296 tagma landing graph batch` at 07:27:08 — the refusal fell between them. The unblock advice (resolve markers by hand, commit, or `git merge --abort`) would have had an agent touch `.tagma` paths mid-landing, which the agent prompt forbids. Cost: one wasted call plus a git investigation.