---
id: 01a13291-8f4b-7458-9c85-222944ac6d04
title: read_thread select entries fails whole when a thread has no rollout file (ENOENT)
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The answer: \"Thread storage failed in rolloutReads.revisions: ENOENT: no such file or directory, stat '~/.tagma/threads/5/01a1276b-5dd5-7b21-9465-335588d773aa.jsonl'\". Not one line and no counts for the selection; one thread breaks the whole read.",
    "command": "read_thread select=entries selection={updatedSince: 2026-10-10T00:00:00Z, updatedBefore: 2026-10-11T00:00:00Z, set: all} where occurredAt>=2026-09-28T00:00:00Z, toolName in [create_block, ...] group [toolName, toolState] count=true (project runlith)",
    "expected": "The read counts groups over all threads of the selection; the thread with the lost rollout is named in coverage.unavailable or skipped with a mark, the other threads counted."
  }
---
Filed from project `runlith`.

Thread 01a1276b-5dd5-7b21-9465-335588d773aa entered the selection updated 2026-10-10. The rollout file is missing on disk. The selection's other threads went unread because of that refusal.
