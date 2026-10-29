---
id: 01a0cafc-0658-773c-aa7f-7914586cb4ca
title: submit_work names a directory and answers nothing, though the session holds 294 files under it
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "\"nothing to commit — this session holds nothing the branch does not already carry\", while git status showed 294 modified files under packages/agent and read_changes listed this session's writes to them by name",
    "command": "submit_work with paths [\"packages/agent\"], immediately after strip_comments swept that same path and recorded 263 files as this session's own writes",
    "expected": "The commit takes the held files under that directory, as strip_comments promises: \"recorded as this session's own change, carried by submit_work like any other\""
  }
---
Filed from project `runlith`.

Measured 2026-09-22 on runlith at HEAD fa5da28cf3. `read_changes` with no argument answered five rows naming this session's writes — `packages/agent/src/workflow/storage.ts`, `run.ts`, `plan.ts` and others — under run 01a0cae2-1429-7d27-b66f-59f231270d9f, so the change record plainly held them. `git diff --stat HEAD -- packages/agent` showed 294 files and 11,326 deletions.

The `paths` argument is documented as "an explicit smaller unit of this session's own work". A directory that contains held paths is not read as naming them, and the answer is the same word — `nothing` — that a session with genuinely no work gets. That word is the problem: it reads as "your work is already on the branch", which sent me looking at the git log for a commit that did not exist, rather than at the argument.

The operator's brief for this session had already warned that "a bare submit_work has answered 'nothing' on modified files before — name them". Naming them is what produced this.