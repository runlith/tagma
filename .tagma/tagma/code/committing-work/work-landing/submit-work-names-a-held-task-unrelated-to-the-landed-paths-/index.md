---
id: 01a16e5c-f58c-7795-9362-03520b5838a5
title: submit_work names a held task unrelated to the landed paths in the commit subject
ord: 74
tags: ["reflection"]
fields:
  {
    "actual": "Commit 4632b5eec6 got \"(9406c155)\" appended, the session's other held task about in-process SQLite statement cost, which touches none of these paths; the history now credits the work to the wrong task and cannot be corrected without rewriting the commit",
    "command": "submit_work paths=[scripts/change/suites.ts, scripts/change/all.ts, scripts/change/all.itest.ts] subject=\"Split selected integration suites into explicit file chunks planned from an earlier test:all report\"",
    "expected": "The subject carries the task that the work belongs to (6b505131, also held by this session and the one about test:all chunking), or no task when it is ambiguous"
  }
---
Filed from project `runlith`.

The session held two in_work tasks: 6b505131 (test:all chunks, which this commit completes) and 9406c155 (SQLite statement cost, no commit). The answer said "carries the work of 9406c155 (held by this session)". The choice seems to come from holding alone, not from the task's sources or the paths changed. Workaround: the ledger and finish_block 6b505131 name 4632b5eec6 explicitly.