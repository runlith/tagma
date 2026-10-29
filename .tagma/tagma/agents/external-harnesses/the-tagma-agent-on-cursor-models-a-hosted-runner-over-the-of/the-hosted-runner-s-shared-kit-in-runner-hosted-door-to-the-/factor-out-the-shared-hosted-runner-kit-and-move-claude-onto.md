---
id: 01a16445-907f-74a7-9f75-80d25c4da570
title: Factor out the shared hosted-runner kit and move Claude onto its cycle port
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16446-40bb-7462-bba0-de7d99575740",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16434-fc60-7079-91d8-189d050e0330
---
Factor the shared hosted-runner mechanism out of the Claude runner into a vendor-neutral kit, move Claude onto its cycle port with no change to its contracts, and update the sources and module boundaries.
