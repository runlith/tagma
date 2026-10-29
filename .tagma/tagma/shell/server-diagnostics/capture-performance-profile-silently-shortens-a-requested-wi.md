---
id: 01a0d857-52e4-73c6-b7dd-01048939d884
title: capture_performance_profile silently shortens a requested window to the standing one
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "Three 30 s requests produced profiles of 3.7–4.9 s: each was cut to the standing profiler window without a word, so the reader has to notice the shortfall from the sample count.",
    "command": "capture_performance_profile with a 30 s window on the server, 2026-09-25, thread 01a0d842",
    "expected": "The asked window is honoured, or the answer says it was cut and to what."
  }
---
Filed from project `runlith`.