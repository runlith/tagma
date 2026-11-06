---
id: 01a1b1f7-960e-7167-ad51-78fcb3144fe2
title: The foreign-reflection door test hung to its bound on the macOS runner
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/reflectDoor.itest.ts
---
In macOS integration run 42258729273 `apps/tagma/server/src/composition/testing/http/reflectDoor.itest.ts` — "a foreign reflection preserves provenance and sightings, and task or commit answers can be tracked and withdrawn" — printed nothing and waited until the 180 s bound. Find which call or wait stood and end it on its fact.

What the run shows: the test's first request, `file_reflection` with no project, answered 503 after 180085 ms; its interrupted stack stands in `ProjectIdentification.identify` (`projects/identity.ts:126`) → `Git.text` → `Git.spawn`, the `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir` that `SourceProject.place` runs for the world's `source/server`. That git process never ended or never closed its output. Tested and refuted: the git fsmonitor daemon holding the pipe — with Apple Git 2.50.1 and `core.fsmonitor=true`, `git status` starts the daemon and still closes stdout at once. Locally the test passes three runs out of three. At the timeout testbed reported no dangling process, so the git child had already ended: the wait that stood was spawnGit observing its exit or the end of its output, not git itself. 3000 parallel `spawnGit` rev-parse calls (concurrency 32) on Apple silicon all ended, the slowest in 497 ms, so it is not reproduced. It recurred in macOS integration run 42277335606 (5e71b3988, shard 2) with the same stack, `Git.spawn` interrupted after 180 s. `spawnGit` unrefs the child right after spawn, and the exit reaches it only as the node-compat `child_process` `exit` event on Bun 1.4.4; whether an unreferenced child's exit can go unreported there is the open question; a local probe of 4000 such spawns (node-compat `spawn`, `unref()` at once, 48 wide, Apple silicon) saw every `exit`, the slowest after 448 ms, so it does not reproduce off the runner either. Third occurrence: macOS run 42294053201 (b73cf6eea, shard 2), same test, 180 s; testbed's summary names one of the file's 71 git processes "without a CPU reading", so the end of that git process was never observed by the test process. The runner's git is Homebrew 2.56.0 (`/opt/homebrew/bin/git`), not the Apple Git 2.50.1 the fsmonitor refutation above used, and fastStatus turns `core.fsmonitor` on in checkouts it speeds up — whether git 2.56 leaves a daemon holding a spawned command's output pipe is untested. The next occurrence on the macOS runner needs the call's own state (exit seen, output drained) to name which half stood.