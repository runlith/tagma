---
id: 01a17680-a2d2-730b-9c9c-89c761931518
title: Restoring a file with the write tool (fromFile) yields some of the session's own lines to 'nobody'
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "read_changes(path=projection.ts): this session +14/−1, nobody +57/−2 \"written outside the record\"; selection.ts: this session +2/−3, nobody +6/−5; check_rules refused lines-held naming my own declarations (crossingsOf, sliceRegions, …) \"held by nobody\"; exit only via whole.",
    "command": "write({path: apps/tagma/server/src/change-record/lines/projection.ts, fromFile: <scratch HEAD copy>}) then write({path: same, fromFile: <scratch copy of my own version>}), then check_rules({over:\"change\"})",
    "expected": "Every line the session's own file-tool writes left in the file is this session's; check_rules over its change judges them as its own."
  }
---
Filed from project `runlith`.

Session 01a17649-5aac-796f-b4a0-9033e9160ee2 (fix-json-slice), main checkout /opt/workspaces/runlith. To prove a test red on HEAD's code I swapped four of my own changed files to their HEAD text and back, all through the `write` tool with `fromFile` (HEAD text from `git show` into scratch, my text from a `cp` into scratch made before the swap): `lines/projection.ts`, `lines/selection.ts`, `prepared/dependencies.ts`, `prepared/tree.ts`. Before the swap all four were fully this session's (read_changes showed only this session). After the restore, `dependencies.ts` and `tree.ts` are fully mine again, but `projection.ts` and `selection.ts` show most of my lines as nobody's with reason "written outside the record". No other session and no command wrote these files in that window (the only commands were `bun test` runs and the `cp`/`git show` into scratch outside the checkout). The contents after restore are byte-identical to my pre-swap versions (checked with git diff). Workaround used: `whole` for the two files on check_rules and submit_work.
