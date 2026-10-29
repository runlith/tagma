---
id: 01a17111-30e4-732c-a5ec-e0f64b005c71
title: A thread dragged from the column into another thread's composer becomes a mention and leaves in the message as a thread link
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17100-a232-7a0a-a781-94f0e2744109",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-7595-7388-9467-c90f6d8a1c85
---
The operator drags a thread row (or a team agent) from the column and drops it onto another thread's composer or a new draft's composer. The thread stands as a chip beside the block mentions and on send is appended as a `[[id|title]]` link, through which the agent reads the thread.

While the thread is carried, the composer that will accept it draws the future chip's place with dashes. Under the cursor the frame and preview are blue, the ghost says "→ Mention". Its own thread is not accepted by its own composer, a repeated chip is not duplicated. The layout is agreed with the operator (artifact adac38c274e3).

A thread mention is the same `DraftMention`, told apart by the thread id in the `name`: draft storage, turn rollback, and the feed link work with no new field.
