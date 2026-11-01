---
id: 01a1949a-5e28-73f2-af6e-8062389d12ed
title: Evicting a held history whose thread is still running frees nothing and makes the next read load a second copy
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-8e6b-7d29-8c7d-8b57bd55cb0a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c0a990be94
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/heldHistories.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
---
`HeldHistories` evicts by least recent read within its resident bound, counting every held thread in full. A running thread's messages are also held by its run (shared by identity), so evicting it frees no memory. The next reader (for example `toldState` on a hosted call) then loads and folds the whole history again, as fresh objects, and holds that second copy. Inference from `history.ts`, not measured: the run's next fold write diffs its own array against the reloaded `stored` by identity in `changedRows`, finds no shared prefix, and deletes and reinserts every row.

Seen in the a990be94 proof bench (10 ACP agents, 300 KB assistant messages, ~15–20 MB histories): at a 64 MiB bound only one to three histories were held at each census cut while all ten threads were running. The bound landed at 128 MiB resident, no lower than the previous estimate's effective ceiling, but the cost stays wherever active histories together exceed it.

Decide at the owner: either a history pinned by an active run is not charged to or evicted from the cache (its run owns that memory and declares its bound), or the history store reuses the run's objects instead of a reload. Measure reload count and rows rewritten per write first.

Outcome: measured and fixed with [[d13ee0a0]] (`f1ff9abc16`, `5b400140c9`). The inference held: 20 whole-row rewrites at `open_hosted_turn` and 102 cold `call_hosted_tool` loads by 180 s of the N=10 bench before; none and 7 after. Threads this process drives are no longer evicted (the history store learns them from `RunControl`), and a claim keeps the committed history readable.