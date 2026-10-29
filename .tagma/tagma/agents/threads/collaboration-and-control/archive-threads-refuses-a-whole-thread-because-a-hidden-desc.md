---
id: 01a177f7-db08-7740-a02d-e9c51ef4cac3
title: archive_threads refuses a whole thread because a hidden descendant holds tasks in a removed project
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "refused[thread-tasks-unreadable]: thread 01a1313a-8f6d-7e12-b3b6-d334feef0d3b holds tasks in project 32, which no longer exists; list_threads and read_thread on it refuse (not-found / place-mismatch), so no door reaches or releases it.",
    "command": "archive_threads {updatedSince: 2026-10-14T12:08:00Z, updatedBefore: 2026-10-14T12:08:01Z} (thread 01a1311a-69ba-7dc2-a31e-0847775c9f64)",
    "expected": "The thread and its subtree are archived, or the refusal gives a way to archive anyway or drop the unreadable tasks."
  }
---
Found archiving every thread older than a week in another project: bisecting by updated-time windows archived all but 01a1311a, whose spawn subtree contains 01a1313a. The unblock text points to the registry, but project 32 is gone, so the caller has no step to take.