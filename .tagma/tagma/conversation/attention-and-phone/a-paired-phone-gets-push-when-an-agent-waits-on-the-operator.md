---
id: 01a14bc0-76c7-7595-a09a-82c02494791d
title: A paired phone gets push when an agent waits on the operator, crashes, or finishes — with no open app
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76e5-78af-8421-e72bafcb3305
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/Push.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/service-worker.ts
  - kind: file
    ref: apps/tagma/server/src/push/contract/wire/push.ts
  - kind: file
    ref: apps/tagma/server/src/push/courier.ts
  - kind: file
    ref: apps/tagma/server/src/push/notice.ts
  - kind: file
    ref: apps/tagma/server/src/push/operations.ts
---
**Value.** The operator steps away from the machine while the phone in his pocket reports that an agent waits on him, crashed, or finished, with no open app.

**How.** On a paired phone Inbox offers to enable notifications; the `read_push_status`, `subscribe_push`, and `unsubscribe_push` operations are available only to a paired device.

**Behaviour.**
- Every Attention event and every app notice leaves by Web Push with project, thread, and essence; questions go as urgent. A tap opens the thread or Inbox.
- An open thread closes its own notices; the app badge shows the waiting count.
- An event arrives once; temporary push-service failures repeat, a gone subscription is removed.

**Limits.** Old events and questions answered by a parent agent are never sent. They are switched off by the phone browser's notification permission; a removed device loses its subscription.
