---
id: 01a14582-dc08-79e0-94a0-795c3f2c6b9f
title: submit_work with explicit paths refused "no file this session holds" for files this session wrote, then the bare call committed them all
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "All three path-scoped calls answered \"nothing to commit — `paths` named no file this session holds\" although the files were modified by this session's write/edit calls and uncommitted; the next call without paths committed all 18 files as one commit 54b95c3b90. The requested split was lost; amend is not authorized, so it stays one commit. Cost: 4 calls and the commit granularity the task required.",
    "command": "submit_work(paths: [\"Sources/AISDKProviderUtils/IsAbortError.swift\", \"Sources/AISDKProviderUtils/HandleFetchError.swift\", \"Tests/AISDKProviderUtilsTests/HTTPUtilsTests.swift\"], subject: ...) in worktree <project>/core-foundation; same for two more path groups; then submit_work(subject: ...) without paths",
    "expected": "Each call with explicit paths lands a commit carrying those changed files (written by this session via write/edit; the doc says explicit paths also select changed files nobody holds), so the work splits into the separate logical commits the parent asked for."
  }
---
Filed from project `<project>`.