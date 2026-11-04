---
id: 01a14c05-9e8f-7c75-a633-b2af0ada7311
title: Screens follow the server's live changes and restore subscriptions after a link loss
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2ad5afaf792
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/liveTrouble.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WireState.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
**Value.** Open screens follow server changes without polling, and a transient connection loss does not demand reopening the app by hand.

**How.** A shared live-channel WebSocket; features hold their subscriptions through `Live.hold`, the status bar shows link state.

**Behaviour.** After the connection recovers, held subscriptions reopen in the order byte and frame streams need. A thread Stop pressed with no link goes to the server first, ahead of waiting commands and subscriptions. A dropped link is distinct from a single subscription's refusal. A server that is slow or stalled under load is no loss: the link ends only when the socket reports its end. The connection recovers on return, on user action and on automatic attempts after loss; a page in the browser cache releases it until return. Feeds with a declared window allow several parts in flight on the server and return backpressure on lagging confirmations.

**Limits.** Reconnecting alone does not mean an already sent changing act is repeated. Each feature decides how to re-read its stream or take a fresh snapshot. Refusal to a device stops recovery until a new admission; working with no network is not promised for all screens.
