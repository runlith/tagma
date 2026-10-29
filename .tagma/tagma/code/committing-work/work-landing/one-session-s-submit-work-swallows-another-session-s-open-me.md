---
id: 01a131db-8eda-76a5-9786-19c23ef926c5
title: One session's submit_work swallows another session's open merge in the shared checkout
ord: 77
tags: ["reflection"]
fields:
  {
    "actual": "Commit B bd3ade7255 came out a merge commit (parents 272679b223 and 0730f1c168 — the PR head) with task B's subject “Name the unattributed command paths… (64f77aa0)”. In it the whole PR #5 (12 files, session A's authorship) is mixed with B's 10 files; MERGE_HEAD is gone. Fixing the history takes amend or reset, which needs the operator's word.",
    "command": "Session A: `git merge --no-commit --no-ff origin/fix/global-root-place-loop` in /opt/workspaces/runlith (MERGE_HEAD open, 12 paths in the index). Session B (task 64f77aa0) then called submit_work for its own lines.",
    "expected": "Commit B carries only B's lines, one parent, session A's MERGE_HEAD stays open, and the merge is closed by whoever opened it. Or submit_work B refuses, naming the open foreign merge."
  }
---
The submit_work contract says: “An open merge with a resolved index lands as a merge commit: it carries the index's incoming changes”. It does not distinguish whose merge it is. In the shared checkout another session's merge is its uncommitted work, just like others' lines, and `lines-held` does not protect it. Session A learned of it only from the “HEAD moved” in the typecheck output.
