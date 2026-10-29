---
id: 01a1404d-6c17-71ce-b54f-f2d3dea5dcb4
title: Formatting overlap removes single-author file attribution
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "After 22ms the formatter answered: 0 attributed to this session, 1 overlap belongs to nobody. Before the edits read_changes answered Nobody holds uncommitted lines. For landing I use the suggested paths + whole:true without rewriting the file.",
    "command": "bunx oxfmt --threads=1 --write packages/agent/src/collaboration/CollaborationTools.test.ts",
    "expected": "Formatting this session's single file preserves attribution of its edits."
  }
---
Filed from project `runlith`.