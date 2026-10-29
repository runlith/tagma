---
id: 01a14d00-abdf-71dd-8544-76f2c24cb2fb
title: Server start rewrites the team checkout's `.git/config`, and the cold graph tree is read in full after every restart
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c3d-ab9b-7368-9676-3720a6b4b6b7
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
---
Found by a live measurement on tagma:try: `registerMergeDriver` on every start called `git config --local` with the same values, and git rewrote `.git/config`. The ignore-rules file stat changed, and the first refresh of the cold tree ran in full instead of `changedSince`. Fix: the value is written only when `--get` answers differently. Proof: the merge-driver itest (re-registration does not change the config mtime; red without the fix) and the trace of the first refresh after a restart (`diff-index --cached` and status by paths).
