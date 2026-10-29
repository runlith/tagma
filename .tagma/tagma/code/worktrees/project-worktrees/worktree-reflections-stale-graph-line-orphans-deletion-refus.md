---
id: 01a13f63-559c-7cb3-89b6-c44a2088745c
title: "Worktree reflections: stale graph line, orphans, deletion refusals"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c07c-7062-af51-359fd50818af",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/move/transfer.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/registry.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
---
Commit `10aceac961` fixes three explicit defects: [[4131d2fd|false refusal of parallel creation]] — reading one root rechecks its registration, not the namespace's global revision; [[7532b63d|deletion refusal on ignored .tagma]] — the private index inherits selected staged entries, updates tracked paths separately from untracked ones, and keeps both sides of a rename; [[c93c1394|incomplete shutdown command]] — the working transfer path prints a unique `--operation`. The old `--move` was removed by commit `9dad466333`, and `from.command` already names the corresponding channel's command.

[[fe7a2454|stale stealth line]] and [[83a1d087|orphaned graph tree and recovery]] were already fixed: `cba251ad1c` holds the first-parent line choice of the base, the retirement of a departed checkout's tree, and the preceding retirement-recovery fix (`5a5ff6aea6`). Both reflections are answered by this commit.

Checks: full `workspace/roots/registry.itest.ts` — 22 pass; new `WorktreeIgnored.stest.ts` — 1 pass, 6 assertions, 25.38 s wall time with loading. It checks a staged ignored leaf, exclusion of an ignored sibling and ignored content instead of a tracked file, keeping untracked work and renames. Source errors reproduced before the fixes. The existing graph-recovery retirement test passed; a repeat of the stealth-base selection test stayed unproven for a 10 s timeout. The printed shutdown syntax was reconciled with the CLI parser via `--help` without host access. Full typecheck is unproven: a finished run reported `6 errors in 5 files` (the test's own nullable `branch.name` is fixed; the rest were outside the delivery), and the last run died with `PlatformError: Unknown: ChildProcess.exitCode (bun check -p /opt/workspaces/runlith/apps/tagma/server)`, cause `Process interrupted due to receipt of signal: 'SIGTERM'`. I do not count it as successful.

Independent review: [[01a13f75-d83d-7aff-a6cc-226b9e2c814d|lead reviewer Sol]] and two Muse lenses ([[01a13f77-9a34-7859-841d-10b0d9a0fc36|races]], [[01a13f78-61fd-7a62-917c-1178b0d21248|contract tests]]). Sol's only confirmed finding — a wide `add -f` could capture ignored descendants of a tracked file replaced by a directory — was confirmed red; the final index build removed it, and the test is green. No further findings confirmed. The working server, existing branches, and worktrees were untouched.

Second delivery — commit `552f8b9a86`, on the operator's word that lifted the earlier decisions:
- [[719ead6c|main task visible in a new worktree]]: before reserve, `create_worktree` delivers the base checkout's graph via `graph.commit` and moves base to its HEAD only through graph-only commits ([[4711acec|new base note]]); uncommitted `.tagma` is never copied. With `off`, creation starts from the prepared base, and `evidence.graphLeft` names the checkout and the left-behind graph files.
- [[0f0c75f6|reflections from a worktree]] always go to the main checkout's graph ([[666b6be5|reflection place contract]] updated).
- [[9a0afbb0|merge takes base itself]]: when both sides changed the graph, `merge_worktree` makes a merge commit on the branch with the merged tree, brings the worktree files, force-settles its graph, and judges by it ([[c0df57c0|court decision]] rewritten). Dirty worktree work on these paths refuses with `source-held`/`source-dirty` without moving the branch.

Checks of the second delivery: `reflectWorktree.stest.ts` — 2 pass (visibility of the task, base = main HEAD after delivery, clean `.tagma` in the worktree, kept approved code with code on main after prepare, `off` with `graphLeft`, reflection route); `mergeGraph.itest.ts` — pass: `source-dirty` refusal without moving branch and base, taking the base (parents U — branch tip and main tip, U — second parent of the resulting merge), judging with the worktree graph. The integration-test file budget is unproven: 10.1–10.8 s CPU at load average 27–37; the file's source version at the same load was 8.9 s. The forced graph settle after taking the base is not covered by the test: the fixture feeds a ready graph context. Typecheck: no errors in the delivery's files; the rest are in others' changing files (`composition/children.ts`, mcp tests, execution-host).

Review: [[01a13fc3-2ef0-7a64-b833-707dcb703d6c|Sol]], [[01a13fc3-2ef1-7817-9b5a-ef1048dcb53e|races]], [[01a13fc3-142d-7ac3-bb47-5973af202da6|tests]]. Fixed: judging before the worktree graph settle, the band slice between ref move and file reconciliation (now uninterruptible), startup on main SHA without graph delivery, a branch moved by someone else's commit right after taking, and missing test assertions. Not fixed (P3): delivering the graph on a detached or mid-merge base checkout with a dirty graph refuses creation with a `git` reason; `source-held` is not covered by a test.

Commit `7658843cb8` moves the take-main scenario into the system test `http/mergeTakesBase.stest.ts` (1 pass, 10 s wall): a `source-dirty` refusal leaves branch and main in place; then merge takes main into the branch (parents U — branch tip and main tip, U — second parent of the resulting merge), judges with the worktree graph — the main gate, relaxed to watch on the branch, yields `watched` instead of a refusal — and a task written to main after the fork reads from the worktree graph. `mergeGraph.itest.ts` is returned to its source scenario and fits the 8 s CPU budget.
