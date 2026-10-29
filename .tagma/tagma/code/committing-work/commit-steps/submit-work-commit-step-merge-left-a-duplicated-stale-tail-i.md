---
id: 01a11bf6-0b8e-785c-97a7-3d18caaa77ec
title: submit_work commit-step merge left a duplicated stale tail in a working file it reported as kept
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The working file became the formatted commit text plus a second, unformatted copy of the function tail (≈50 lines) carrying the peer's line — a file that no longer parses. Repaired by hand. Separately, every submit_work answer in this session listed ~20 paths as \"lines of this session still stand uncommitted\" while read_changes reported the session holds 0 paths.",
    "command": "submit_work paths=[…, apps/tagma/server/src/threads/harness/engine.ts] (commit 583d55913f, formatter commit step re-indented the file; a peer session held 3 uncommitted lines in it)",
    "expected": "engine.ts listed under \"left as they stood (conflict)\" keeps the working text exactly as before the landing, or gets the rewritten form merged cleanly with the peer lines."
  }
---
Filed from project `runlith`.

Thread 01a11985-625a-7739-8f67-659b17787f14, worktree foundation-refactor, 2026-10-08. Cost: a broken working file another session was editing, found only by reading it; the false "left" list makes every landing look unfinished.