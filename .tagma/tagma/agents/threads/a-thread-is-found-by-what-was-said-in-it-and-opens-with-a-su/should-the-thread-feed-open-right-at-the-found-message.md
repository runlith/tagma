---
id: 01a0ff2b-54ff-7f7f-91d2-8f5ad6589a26
title: Should the thread feed open right at the found message
ord: 9
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: should the thread feed open right at the found message instead of a message window in the search results?

The feed today is a tail plus `before` and live (`threads/contract/wire/snapshot.ts`). A jump would need a windowed feed holding a window around an entry and catching up to live. The decision comes after the message window has lived with the operator: if it suffices, no jump is needed.
