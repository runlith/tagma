---
id: 01a12854-eac8-7d62-a049-fec386f1ecef
title: The predecessor never leaves before the successor is ready; Released with acknowledgement and a deadline
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-ea09-7fb8-9262-45fa444a045d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e89b246531
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
The remainder of review [[9ae1db7b|ownership handover]]. After standing-by the predecessor leaves without learning whether the successor rose: a successor that crashed after taking the lock leaves the machine with no server. The successor's `released()` waits with no deadline; the Released message on its own road goes with no acknowledgement. Start at `installation/process/succession.ts`. Needed: the predecessor releases the doors only after the successor is ready, or comes back itself on its crash; a deadline on `released()`; an ack on Released. The missing tests from the same review: an observer at every rollout read point, `release()`, the preparation plan, adoption in stores, placeHost, checkpoint-child loss. Done when the successor's crash after taking the lock ends in a working server in the stand.
