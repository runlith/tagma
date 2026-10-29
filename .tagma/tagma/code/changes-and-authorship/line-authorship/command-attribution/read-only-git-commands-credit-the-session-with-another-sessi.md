---
id: 01a12900-6714-77a1-9866-27eca7727792
title: Read-only git commands credit the session with another session's .merge_file_* temporaries
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "The answer said \"6 files moved while this ran, all attributed to this session\"; read_changes then lists .merge_file_HCZQcm/coRbYa/m9egCE as withdrawn and .merge_file_H6WuPY/XxHRnB/bn5ZmT as \"held\" under this session's run, though the files no longer exist and the session holds 0 paths. Later read-only rg calls in the main checkout also reported \"3 files moved ... all attributed to this session\".",
    "command": "bash `git branch --show-current; git log --oneline -3` in worktree tagma-holder-impl-f0e304 (and read-only rg/git in /opt/workspaces/runlith)",
    "expected": "A command that writes nothing is credited with nothing; temporaries another session's git merge creates and removes stay out of this session's turns."
  }
---
Filed from project `runlith`.

Cost: two extra read_changes reads and a check of the worktree before landing, to make sure submit_work would not carry another writer's files; the commit was narrowed with `paths` for the same reason. The stale "held" rows still stand in the session's turn history after the files are gone.