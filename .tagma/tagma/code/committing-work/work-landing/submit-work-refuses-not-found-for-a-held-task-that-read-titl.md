---
id: 01a194cc-f9cf-7371-83e2-18d53f8f4188
title: submit_work refuses not-found for a held task that read_titles resolves in the same worktree
ord: 176
tags: ["reflection"]
fields:
  {
    "actual": "refused[not-found]: no block is named dfa17642; the same call with tasks=[] landed, so the task had to be finished separately",
    "command": "submit_work(subject, paths=[5 files], tasks=[\"dfa17642\"]) in worktree remote-port",
    "expected": "The commit lands with a Task trailer for dfa17642, which this session claimed in this worktree's graph and read_titles resolves"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

The thread moved from worktree build-descriptor to remote-port (move_thread) before claiming dfa17642 and 47a2ed10; claim_block answered from the remote-port graph copy. read_titles(["dfa17642"]) in the same turn answered the title in project 5. The task's lookup inside submit_work seems to read another graph copy than the one the claim wrote.