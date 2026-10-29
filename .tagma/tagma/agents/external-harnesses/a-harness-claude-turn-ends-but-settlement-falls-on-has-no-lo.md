---
id: 01a141b7-2a33-710f-8a8e-2d5ae7656ace
title: A harness:claude turn ends but settlement falls on “has no log row” and the parent report arrives late
ord: 180
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141b7-4a29-756d-9c49-371298ed1c16",
    "status": "done"
  }
---
A `harness:claude` thread (Claude Code through the Agent SDK) finished the turn, but the parent got its report ~30 s late, and `list_agents` showed it `working · running` all that time.

Evidence — thread `01a141b5-fdb7-7bb0-a18e-2b3df6f37cab`, `read_thread select: activity`:
- run `01a141b5-fdf2-7fa0-9427-d89ed7dca930`: opened 22:36:50.761, lasted 16.9 s, outcome ok;
- settlement `activity:01a141b6-48b2-7713-9e28-582180bff447` at 22:37:07.634: `failed`, `ThreadStorageFailed`, "Thread 01a141b5-fdb7-7bb0-a18e-2b3df6f37cab has no log row." Last passed phase — the `hosted runs` subscriber;
- report only at 22:37:36.336.

Find why a hosted thread has no log row at settlement time (who had to create it and when), and fix at the owner, so settlement passes first time and the report arrives right at the turn's end.

Done when: a `spawn_agent harness:claude` probe with a short read-only question gives a report within a second after the run ends, settlement `ok`, and `list_agents` shows the thread idle right after the answer. The contract closed by a test on the owner's layer.
