---
id: 01a14075-8a92-7b67-a08a-2449e6bfb78f
title: Formatter loses attribution of its own file again on overlap
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "Formatter finished in 10ms: 0 attributed, 1 overlap belongs to nobody. Before the change the path had no holders. Using the suggested explicit path and whole:true without rewriting.",
    "command": "bunx oxfmt --threads=1 --write packages/agent/src/collaboration/ThreadEnvelopes.test.ts",
    "expected": "Keep attribution of my own lines after formatting this session's single file."
  }
---
Filed from project `runlith`.