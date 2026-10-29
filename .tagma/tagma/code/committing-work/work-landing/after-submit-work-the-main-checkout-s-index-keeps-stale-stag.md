---
id: 01a12582-fbf7-755e-8fd0-98c0a4db449b
title: After submit_work, the main checkout's index keeps stale staged versions of files agents already committed
ord: 131
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12583-1f1e-76f0-a7c8-22617008b9f6",
    "status": "done"
  }
---
The operator's observation and mine: in the runlith main checkout's Git window on main there were “Staged 12” and “Changes 12” — the same 12 files. `git diff HEAD` was empty (working files equal HEAD), `git diff --cached` showed +42/−109, `git diff` +109/−42: the index held older versions of files agents had already committed via `submit_work`, and “Changes” looked like a revert. Committing that index would have rolled back others' work. Fixed by hand with `git reset -q` (index became equal to HEAD, files untouched).

Files: `apps/tagma/app/src/lib/app/runtime.ts`, `apps/tagma/app/src/lib/features/views/ViewFrame.svelte`, `apps/tagma/server/package.json`, `composition/{catalogModules,modules,runtime}.ts`, `native-harness/kernel.ts`, `plugins/{generation,plugins}.ts`, `views/feeds.ts`, `views/contract/wire/feeds.ts`, `packages/llm/src/models/description.ts`, `.tagma/runlith/tagma/enforcement/merge-driver-commit-gate.md`. Some of them reached commits with `whole` or through `lines-held` (several sessions' lines interleaved); `submit_work` assembles the commit in a private commit tree with its own index.

Find the cause: which act (submit_work, commit steps/hooks, sync_graph, `whole`/`taking`, an `mv` move carried without a change-record entry) writes to the main checkout's real index and leaves a version different from HEAD in it after the commit. Fix at the owner: after the commit the main checkout's index is either untouched or brought to HEAD only on the commit's paths. Done when an integration test reproduces the leftover index (red) and shows a clean `git status` after submit_work under the same conditions (green).
