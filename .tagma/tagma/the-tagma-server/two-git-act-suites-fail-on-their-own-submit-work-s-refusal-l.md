---
id: 01a0d62c-eb42-7441-ac85-cd3889796ac5
title: "Two git-act suites fail on their own: submit_work's refusal leaves the branch at another commit, and an operator's worktree read answers another operation shape"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d938-ccce-7f34-b019-9e355ec5986b",
    "status": "done"
  }
---
Failing alone on 2026-09-25, and in the full runs of 2026-09-24:
- `apps/tagma/server/src/cli/nativeSignature.itest.ts`: "submit_work reports a git refusal without moving the branch": the branch's commit differs from the one expected;
- `apps/tagma/server/src/cli/worktree.itest.ts`: "an operator prepares, creates and reads one worktree by its operation id": the read's `operation` does not match.

Fix at the owner of each answer. Done when neither is listed in `test/failing.json`.