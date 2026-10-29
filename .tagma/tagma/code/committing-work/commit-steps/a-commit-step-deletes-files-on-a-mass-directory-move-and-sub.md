---
id: 01a12b62-86f4-7e66-81c3-2151b926f5ea
title: A commit step "deletes" files on a mass directory move, and submit_work does not commit the move
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "closed"
  }
---
A directory move (9438 files, edits in 576) → `submit_work` refused `commit-step-failed`: the `oxfmt` step "deleted apps/tagma/app/src/lib/features/checkout/commitRuns.ts, diffEnds.ts, diffRows.ts, diffWidth.ts, entryLetter.ts and 124 more". The files stood on disk, `oxfmt` deletes no files, git ignore does not cover them. `taken` in `commit-steps/running.ts` did not find them in the commit tree's index after the step; the place and mechanism of the lost entries are unproven. Tree reset (`read-tree --reset -u`, `clean -fdq`) and unlinking of the ignored (`linked` removes the path with `rm -rf`) were checked on a tree with the renamed directory.

The move was committed past hooks on the operator's word (`a6370e619c`). A 11 October 2026 check did not reproduce the refusal: 4 passes through submitOver, commitShape and GitCommitTrees with localRoad — moving 100 TS files with oxfmt 0.72.0, such a move over a previously linked ignored directory, a case-only rename in a warmed tree, and a rerun after a hook that deleted a private file. The probe is kept as rename-steps-probe.stest.ts in the performer's scratch. The original 9438 files, 576 edits, mixed TS/Svelte and managed ProgramRoad were not reproduced; the original refusal with the full 129-path list was not found in the named thread. The cause is unestablished, production code unchanged, no fixing commit.
