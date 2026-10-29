---
id: 01a113f5-056d-729c-8416-11e32193942a
title: A landing leaves entries in the shared index that the agent's shell staged on paths published by the private index
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a113f5-3c56-7966-a8c8-fea5826356fb",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/landing/land
---
The agent runs `git mv a.ts b.ts` in the shell: the shared index gets `b.ts` with the old contents. Then it edits `b.ts` and lands `submit_work`, which commits through the private index and publishes `commit-tree` + `update-ref`. The shared index on `b.ts` stays on the old blob: the working file equals HEAD, while `git status` shows `MM` — a staged change rolling back the commit. Nobody holds it (`read_changes` is empty), and `merge_worktree` into this checkout refuses `base-staged`. So it was in `main` on 2026-10-07 across five rename paths of `2ef290cc3d` and `notices.ts`.

Fix at the owner, the index sync after publication (`landing/land/indexSync.ts` or whatever replaced it): for paths the landing published, a shared-index entry matching neither the old HEAD nor the new commit and held by nobody's staged change is brought to the commit. Someone else's real staged change (the operator staged their own edit) is left alone. Test through `submit_work`: `git mv` + edit + landing → `git status` clean on these paths; the operator's staged edit on another path intact.
