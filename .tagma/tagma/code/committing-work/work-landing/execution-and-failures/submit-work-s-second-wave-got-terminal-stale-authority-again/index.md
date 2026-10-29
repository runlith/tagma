---
id: 01a12cae-bcac-7b87-9554-7741c8f21f67
title: submit_work's second wave got terminal-stale-authority again before reading the branch
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "refused[git-unavailable]: git symbolic-ref ended and its console could not be read: terminal-stale-authority. The answer demands read_commands and a fresh answering shell. The working server was not restarted after the previous fix's landing.",
    "command": "submit_work(subject=\"Recover published commits when update-ref loses its answer\", paths=[apps/tagma/server/src/platform/git/publish.ts, apps/tagma/server/src/platform/git/publish.itest.ts, apps/tagma/server/src/composition/testing/landing/submitGit.stest.ts])",
    "expected": "Read the branch and land the reviewed change."
  }
---
Matched with fix e3d3ce1d92: `onBranch` → `admittedGit` → `admittedWatch` reads the finished `git symbolic-ref` through Observe/Await. The old binding included `holdings.rootUse`, which `forgetReleasedUses` removes when it ends; the current `CommandAdmission.prepareManaged` keeps a stable `viewOf(origin)` and a separately checkable `targetKey`. The contract is confirmed by a red→green test in the [[536ffde9|authority fix task]]. Per the launching agent, the running server still uses the build made before this commit; applying the fix to it remains the operator's action.
