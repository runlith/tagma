---
id: 01a1a2d0-aad0-7d52-9407-4513feffc4ae
title: "An unreadable attempt, return or served record is a typed state, never \"no record\": installs, pruning and starts keep what it may hold"
ord: 92
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87df-748d-bc94-66317e1c6f98",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1a2c3-df29-790a-ac75-a876cfb6a896
---
Found by M2 (frozen wire formats, [[cfb6a896]]). When `attempt.json`, `returned.json` or `served.json` does not decode, `readAttempt`, `readReturn` and `servedRelease` log a warning and answer that no record exists. An install then treats an unreadable unrestored attempt as absent, writes a new attempt over it, and the next start drops the only copies of the data from before the update. This is the H1 class of loss, reached through a damaged file. Unreadable must be its own typed outcome at the owner (`closure/attempt.ts`). Installs refuse while it stands. Pruning keeps every release and copy such a record might name, and a start drops no copies under it. The fix is proven red→green through `install-from` and the start's admission.