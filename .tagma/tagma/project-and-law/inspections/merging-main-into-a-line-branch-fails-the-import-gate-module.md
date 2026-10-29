---
id: 01a12850-6148-7cfb-ba1a-6310c94f3d86
title: "Merging main into a line branch fails the import gate: module check hits the 80 MiB cap and refuses inspection-failed"
ord: 55
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed] of rule 083d37f1: «modules is not judged: the subject is too large — it reaches 6505 files and 80.0 MiB, past its envelope of 10000 files and 80 MiB»; on half the range — 6391 files and still 80.0 MiB, so splitting does not help. update_worktree only redirects merging to the leading thread, i.e. me. The only ways out in unblock — narrowing or loosening the rule by its owner, or skipping the hook, both outside the implementer's authority.",
    "command": "git merge main (and d2e272040d — half the range) in worktree tagma-holder-impl-f0e304, then GIT_EDITOR=true git merge --continue",
    "expected": "A merge commit is judged by what the merge changes relative to the branch, and lands; or Tagma has a door for merging the base into a worktree that passes the gate"
  }
---
Filed from project `runlith`.

The previous merge of main into this branch (341087b188) went through the same way; since then main moved by 103 commits. The conflict was in only one graph file (.tagma/runlith/import-relation-entry-importer.md). Cost: two merge attempts ~2 minutes each, the branch cannot pick up main, implementers hold tests broken by main's signature changes.
