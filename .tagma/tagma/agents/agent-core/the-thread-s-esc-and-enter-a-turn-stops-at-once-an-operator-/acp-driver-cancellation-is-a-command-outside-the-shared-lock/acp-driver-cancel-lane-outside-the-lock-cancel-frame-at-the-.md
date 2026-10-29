---
id: 01a15f39-4ae7-74c1-8627-9418ad0ccde6
title: "ACP driver: cancel lane outside the lock, cancel frame at the queue head, turn end on receipt"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f39-1d38-7319-aaf6-94afb2f5e09f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d62b8fd967
---
Implement [[2b8fd967]]: ACP cancellation does not await `links.locked`, the `session/cancel` frame overtakes the writer queue, the `Admitted` receipt ends the turn `aborted` with a sealed tail, the next prompt awaits the agent's answer to the cancellation, and a process-less connection attaches at once. Acceptance is a stest with a scripted agent under four conditions.
