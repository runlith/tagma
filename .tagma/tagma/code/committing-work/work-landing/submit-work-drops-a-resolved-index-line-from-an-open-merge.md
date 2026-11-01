---
id: 01a1978f-c545-7405-956f-68db00ee2823
title: submit_work drops a resolved index line from an open merge
ord: 191
tags: ["reflection"]
fields:
  {
    "actual": "Merge 7e20f67e3e omitted the staged `writes: writes('rollout.native', [nativeRows])` line, leaving it uncommitted and making the merged tree invalid; a second commit 9cbaa1103d restored it.",
    "command": "submit_work(checkout=\"/Users/teunlao/.tagma-dev/worktrees/tagma/cpu-event-projection\", paths=[\"apps/tagma/server/src/native-harness/rollout.ts\", \"apps/tagma/server/src/threads/mandate.ts\"], whole=[\"apps/tagma/server/src/threads/mandate.ts\"], tasks=[])",
    "expected": "The merge commit preserves the resolved index, including the native rollout write declaration."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

`git diff --cached` before landing showed the native rollout resolution exactly as the main parent carried it. `git show 7e20f67e3e:apps/tagma/server/src/native-harness/rollout.ts` has no `writes` member, while the main parent and the working file did. The merge was otherwise resolved, and the selected `whole` path was mandate.ts, not the rollout file.