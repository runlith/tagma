---
id: 01a13c08-e289-7070-b6bf-0c7bccd82433
title: bash refuses no-approver for git init/commit in a scratch temp repository outside every checkout
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "refused no-approver: \"bash needs an answer, and this run cannot wait for one\", unblock \"continue without it\" / \"ask the operator to run it\"; the command never ran. Cost: the planned live check of a mirror rebuild on a tagma:try instance over a git snapshot of the graph had to be replaced by a shallow clone",
    "command": "bash: cd /var/folders/.../T/mirror-tree && git init -q . && git add -A .tagma && git -c user.email=bench@local -c user.name=bench commit -qm snapshot",
    "expected": "A commit into a throwaway repository under the temp directory, which no registered checkout or project owns, runs like any other command (or is asked of the operator through the parent approver)"
  }
---
Filed from project `runlith`.

Thread is a child at depth 1 under review mode; the "Commits into (review)" rule on bash apparently applies to any git commit, including one into a fresh temp repo that is not a registered checkout. A shallow `git clone` of the repository into the same temp directory ran without a question.