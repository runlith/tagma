---
id: 01a0d63e-7260-72e1-b891-6acc6f4934ec
title: Integration files run together under heavy machine load time out at the 10 s limit, and bun's kill of their sqlite children fails the files after them
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Seen on 2026-09-25 with the load average near 18: server integration files run in groups under `--parallel=4` exceed the 10 s integration limit set in `test/layers.ts` ([[8e7c936b]]), bun kills the timed-out test's sqlite and git children, and later tests in the same worker fail on what the killed children left. The same files pass when each runs alone, so none of them is listed in `test/failing.json`, which lists only failures reproducible in isolation.

Start from a grouped run of `apps/tagma/server` integration files on a loaded machine; find which tests share state across a kill (open databases, run roots, leftover lock files) and whether the 10 s figure or the parallelism is what the layer runner should change. Done when a grouped integration run on a loaded machine fails only on tests that fail alone.