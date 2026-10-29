---
id: 01a0ea04-4444-7b28-a774-bfb7cdddde69
title: A case-only rename on a case-insensitive checkout lands both spellings in the commit tree
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The tree holds both spellings with identical blobs, for ten paths. On Linux both files exist; a macOS clone collides on checkout. The agent's `git rm --cached` before the commit did not reach the tree.",
    "command": "rename (Doctor.ts → doctor.ts, Touches.ts → touches.ts, …) on macOS APFS in worktree `restructure`, then submit_work (commits 77b6d54dea, 58ba6a361e)",
    "expected": "The commit tree holds only the new spelling, as `git mv` does for a case-only rename."
  }
---
Filed from project `runlith`.