---
id: 01a0caa1-e8e2-7e76-b90d-cc9ee606f19c
title: The terminal-theme pin reads the gitignored .external/orca clone, so the app's suite is red without it
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cabe-17dd-7be2-91ad-9d1e1a516efb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/terminalThemes.test.ts
---
`apps/tagma/app/src/lib/shared/terminalThemes.test.ts` pins the theme catalog against Orca's own theme files by reading `../../../../../../.external/orca/src/renderer/src/lib/terminal-themes/*.ts` at import time (`ORCA_COUNT` is computed at module top level, so the read happens for any run of this file). `.external/` is gitignored (`.gitignore` names it; `git ls-files .external` is empty), so a checkout without that reference clone — a fresh clone, a worktree, CI — runs this file into ENOENT and the app's suite goes red for a reason no change to the app caused.

Either direction is a real fix: vendor the pinned data (the count and the three deep-checked themes) into the test or a tracked fixture so the pin survives without the clone, or skip the file's cases with a stated reason when the directory is absent. Do not delete the pin without replacing it: claim [[4586025a]] stands on what the pin establishes.

Found while building the shared-components zone for [[a014cd4c]]; it implements no decision of its own. Done when the app's suite is green on a checkout carrying no `.external/orca` and the pin still answers what it answers now.