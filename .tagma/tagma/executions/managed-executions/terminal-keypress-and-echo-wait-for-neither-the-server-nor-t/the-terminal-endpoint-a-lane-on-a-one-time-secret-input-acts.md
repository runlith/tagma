---
id: 01a17aff-0013-783e-93b0-8217d7e0445d
title: "The terminal endpoint: a lane on a one-time secret, input acts with receipts, and live pty output with offsets over the stream's WebSocket"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: waits-on
    to: 01a17aff-0013-783e-93b0-82167556936c
sources:
  - kind: dir
    ref: packages/executions/src/protocol
---
The terminal stream listens on WebSocket on loopback. The logic registers in it the lane the server opened, with a one-time secret; the secret connection carries the lane's input acts and their receipts plus live output from the requested offset, and an owner change, revoke or execution end close it. Frame protocol and lane registration live in `@runlith/executions`. Done when an itest types into pty through the endpoint and gets echo within 100 ms with the logic main loop busy for 2 s, and the twentieth queued keypress is no slower than the first.
