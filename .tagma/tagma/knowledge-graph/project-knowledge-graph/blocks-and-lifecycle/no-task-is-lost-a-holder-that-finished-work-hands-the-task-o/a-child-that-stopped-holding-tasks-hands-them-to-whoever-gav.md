---
id: 01a16527-352c-7185-bffb-405137101b84
title: A child that stopped holding tasks hands them to whoever gave the work; tasks of an archived thread with no live parent go to open
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16509-151f-7593-9b15-10ddf97bd084",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16527-352c-7185-bffb-404d3490910c
  - kind: waits-on
    to: 01a16527-352c-7185-bffb-40504e0a5402
---
The new recipient at the events owner (`threads/events`) watches only threads holding tasks (`TaskHolders.forHolders`).

- A child stopped: its tasks move in one `Tasks.handOver(id, to)` act to the session it owes a report. The journal records the handover.
- On the next step the recipient reads a line with the same delivery as "ran/cooled" ([[893f7234]]): "X stopped holding T; it is yours — finish, close, release, or hand over". The same line carries the open tasks the child started (`author`) and never closed.
- A root stopped — nothing.
- A thread is archived or deleted: its tasks go to whoever gave the work if alive, else `release` to open.

The `#task` text: a holder that stopped hands the task to whoever gave the work; handing to anyone else is its claim. After delivery, rule [[647f2a2b]] shrinks to what the product does not cover.

Test on the thread runtime:
- a child takes T, answers finally, and stops → T's holder is the parent's session, and on the next step the parent gets a line with T and the child's open tasks;
- archiving a root holding T → T in open, `release` in the journal.

Check and name in the report whether terminal-CLI threads are covered.
