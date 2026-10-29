---
id: 01a11c27-1450-744a-b426-293311437be0
title: Read-only bash command attributed another session's git merge-file temp writes to this session
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The answer said \"6 files moved while this ran, all attributed to this session\"; read_changes listed six `.merge_file_*` temp files (later withdrawn as reverted) and `apps/tagma/server/src/graph/tree/merges.ts` as \"held\" under this run's turns, while the summary said the session holds 0 paths. An earlier read-only command in the same run correctly left merges.ts to session 01a11bca-7410-7811-8f8d-4b5d4e9e6649.",
    "command": "bash: rg -n \"strangerConsents\" … and sed -n over apps/tagma/server/src (read-only), worktree foundation-refactor, run 01a11c0e-03da-7dac-baa0-cf9df39d6694",
    "expected": "A command that writes nothing is attributed no writes; files another session's git process created and removed meanwhile go to that session or to nobody."
  }
---
Filed from project `runlith`.