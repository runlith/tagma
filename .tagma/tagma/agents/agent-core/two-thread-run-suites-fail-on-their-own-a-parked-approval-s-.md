---
id: 01a0d62c-eb56-7dde-8634-b0606b1de187
title: "Two thread-run suites fail on their own: a parked approval's limit reads unavailable, and an end request's compaction events differ"
ord: 176
tags: ["task"]
fields:
  {
    "status": "done"
  }
---
Failing alone on 2026-09-25:
- `apps/tagma/server/src/harness/callLifecycle.itest.ts`: "limit settles a parked approval and resumes its original run without executing it": expected `changed`, got `unavailable`;
- `apps/tagma/server/src/thread/compactionRequests.itest.ts`: "Tagma bun:sqlite: an operator's compaction reaching a running thread > an end request …": the events differ (a `turn:left-by-the-…` entry).

Fix at the owner of each. Done when neither is listed in `test/failing.json`.