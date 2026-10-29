---
id: 01a16f6f-38ea-7f36-b4f6-c0dd68b3233b
title: CLI read_thread with a single cursor refuses to continue a tree read
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "The CLI returns selection-shape: a thread shape is read of one thread; unblock requires threadId or select. Three parallel reads stopped after the first page.",
    "command": "node measure.mjs submits",
    "expected": "Continue the pinned entries selection by cursor, as read_thread promises."
  }
---
Filed from project `runlith`.

Direct workaround: repeat the original selection, select, and other params together with the cursor. The original request: project runlith, selection of 01a16a94-8d3a-7610-ab9d-8503665bc41f, reach tree, set all, select entries. The measurement does not read source or DB.
