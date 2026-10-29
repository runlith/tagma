---
id: 01a13ba3-0be5-74ad-ad14-5fd70f0c75f6
title: A reflection recorded from a thread in a worktree lands in the worktree graph again and is invisible from main
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "From main read_block 3c421f14 answers not-found, and read_reflections does not show it (59 entries; from the worktree in the same session there were 193). Meanwhile 4131d2fd, recorded from main, is visible. The reference to 3c421f14 had to be removed from spec 1e154af5.",
    "command": "file_reflection from a thread standing in worktree tagma-exp-classes-d74152 → 3c421f14; then from main: read_block 3c421f14 and read_reflections",
    "expected": "By fix 201bf57a the reflection is written to the main checkout's graph and reads by name from main."
  }
---
Filed from project `runlith`.

Looks like a regress of 201bf57a (`graph/operations/crossing.ts#reflectionPlace`, commit 69bb6fc515), or like the running server was built without it. Which build runs is unchecked. The entry-count gap (193 from the worktree versus 59 from main) says every checkout answers with its own reflections graph.
