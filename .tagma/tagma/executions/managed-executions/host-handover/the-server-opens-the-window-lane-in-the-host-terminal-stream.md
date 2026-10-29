---
id: 01a17b7e-a8ef-7e59-81cc-8e4bb234fd5e
title: The server opens the window lane in the host terminal stream and learns about input on it only from the Inputs subscription
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: relates
    to: 01a17b24-b0a8-7e8a-9091-24f6303715ed
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/endpoint.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/channel.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/lanes.ts
---
The contract for host, server and window is [[303715ed]]; here is what the server holds.

- **Open order.** `ViewLanes.open` opens the operator's binding, installs the execution's `Inputs` subscription follower, awaits the `Subscribed` answer and only then calls `OpenTerminalLane`; a subscription or host refusal drops the binding in the same step. The host gives admitted-input events only to live subscribers and never repeats past ones, while `Subscribe` travels the walk lane whereas `OpenTerminalLane` goes control and would overtake it: without the wait, an act admitted before the subscription would reach neither writers nor the grid.
- **One follower per execution**, living while the execution holds at least one window lane; the last one's departure drops it. A subscription failure — host connection change, logic handover — resubscribes with a growing pause while lanes stand; the execution work's end (`completed`) ends the follower.
- **What the server takes from the event.** `InputWitness.reported` finds the view by binding and makes it settle the grid when the cause is typed, paste or interrupt; `TerminalWriters` marks the principal by the same rules as control-plane input. For a lagging subscriber the host merges events by (binding, cause) pair down to each cause's last, so a late `raw` never wipes the typing before it, and writers and the grid need only each cause's last event: they need the last act's time and the last typing view. What counts as typing is decided by the server (`typedInto`): click and wheel (`mouse`) mark the principal in writers, `raw` marks someone else's principal but not the operator's — theirs is hover and focus-report. Only typed, paste and interrupt settle the grid.
- **The lane lease.** The secret gives the window a connection past the server, so the server learns that the window still holds the lane from the `terminal.lane.hold` feed: while the subscription stands, the 30 s grace doesn't drop the lane; with no subscriber the lane is dropped, and the host closes the connection with code 4410. A lane remembers the device that opened it through the remote door, and a device revoke drops its lanes at once, not after the grace: the secret acts on the site with no door gates.
- **Address by door.** The answer's `url` is given by the `LaneEndpoint` of the door the call came through: the local door stands on loopback only and hands `ws://127.0.0.1:<port>`, the remote one the Tailscale Serve site. With no address, the open drops the lane and refuses `terminal-endpoint-unserved`.
