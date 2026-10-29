---
id: 01a12c87-c1d2-75a6-8659-57b77f4ba154
title: Bash attribution separates paths and temporary service files from command output
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f8-75d1-a0c3-27f858a6f9e9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c0a-2ef8-797c-b471-0d9b603a0e57
---
Fix the bash-attribution reflections family: files in shellShown, Git temp files in snapshots, and the cost of today's attribution. Start with packages/agent-tools/src/shellShown.ts, CheckoutBaselines.ts, and change-record/record/commands.ts. Prove completion with contract tests, a narrow before/after measurement, a trial tagma:try, an independent review, and a landed change; cases already gone from today's code are named separately.

Reproduced and removed: false filesystem candidates from ANSI rg, JSON, git log, and bun -e. The source is shellShown: argument roles were ignored, a colon split any argument, and any process output scanned for three ":number:" places in a line. The fix accounts for inline code and search patterns, keeps bracket paths, other programs' boolean flags, git grep, git log -p, and C-quoted diff paths; search keeps the directory it ran in. The CheckoutBaselines snapshot no longer includes root-untracked .merge_file_XXXXXX, which Git creates for an external merge driver. A tracked file under that name stays an ordinary checkout file. A real Git merge-tree run from sub/ created all three temp files in the checkout root: the exception deliberately never extends to ordinary nested files.

The produces road from [[84694b75|the 407-path preparation reflection]] was removed in eb61686667; the old synchronous attribution from [[fa7142c3|the 112-capture-file reflection]] is replaced with a write queue. The 15-minute pre-launch and 11-minute post-command delays never reproduced in their current shape. The foreign typed-edit line from [[11437be0|the read-only command reflection]] is already explained by the owner's instant mark; existing lives and commandMarks tests guard that contract. What this delivery removes is the remaining merge-temp cause, with held/left projections unchanged.

A narrow measurement on this machine, Bun 1.4.3, a shared checkout under parallel load: five measurements per side; a new temporary git repository, 112 dirty capture files of 63,001 bytes each and three untracked 1 MiB merge temps. Snapshot median with temp: 232.03 → 111.65 ms; the snapshot set: 115 → 112 paths. Load and ctime freshness varied, so these wall samples establish no stable speedup factor. For 112 rg lines with three colon sites, filesystem candidates fell from 338 to 113; pure parsing with confirmed roles in memory is 0.279 → 0.359 ms, with no real stat in that part of the probe. A cold snapshot of 112 capture files: 347 → 214 ms. A separate in-process probe of the modern ChangeRecord with 112 unique ~63 KB JSON files: the bash answer 754 ms, all 112 durable lines ready after 2771 ms. This is a new synthetic sample, not a rerun of the source capture corpus.

Additionally [[b991cf74|the dirty-set change reflection]] is confirmed with a red/green integration test: someone else's commit changes HEAD, and unchanged bytes must never move/attribute. ShellRun drops equal digest/presence before authorship decisions and answer building; real writes, deletions, and returns to HEAD survive. The held/left projections and terminal authority never changed.

The main Sol review xhigh and two Muse xhigh lenses found three law-delivery regressions; confirmed remarks were fixed with contract checks. The nested-Git-temp hypothesis was disproved by a real merge-tree; turning any stat failure into false was rejected. Target tests and the agent-tools typecheck with dependencies are green; the final 27 contract checks and 55 shared shellShapes-parser checks pass. The final build of its own tagma:try `e1ee4e79be-dirty 20261011T201350778Z` answered `/health` with `ok: true` on port 7431 and a separate DB; this smoke verifies build and start, bash/ChangeRecord were verified in process. The trial server is stopped, the operator's server untouched. The change landed as bb38059820. Full status metadata still lifts from both sides of the command; further fsmonitor speedup is a separate [[6ce62961|existing idea]].
