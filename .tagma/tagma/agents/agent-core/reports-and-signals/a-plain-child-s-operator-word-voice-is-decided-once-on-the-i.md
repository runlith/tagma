---
id: 01a146cf-9c17-7818-810d-9a864bd3b0cd
title: "A plain child's operator-word voice is decided once, on the inbox item: `sender.asOperator` while the sender is its current parent"
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146bd-69c8-71fa-bb83-96996cfb2a0f
sources:
  - kind: symbol
    ref: packages/agent/src/collaboration/envelopeActs.ts
    symbol: threadSender
  - kind: symbol
    ref: packages/agent/src/thread/inboxItems.ts
    symbol: saidAsOperator
---
A plain child's operator-word voice is decided once, on the inbox item: `sender.asOperator` while the sender is its current parent.

`plain` mode stands on the thread's mandate (`thread_mandate.plain`), but the render does not read it: `itemOf` (envelopes) and birth `provision` set `asOperator: true` at send time when the recipient is plain and the sender is its `parentThreadId`. Every render after that — `threadSignalOfInboxItem`, `queuedTurnText`, opening a turn from rest, the queue — looks only at the item. That keeps render a pure function of the item, while detaching and re-attaching change the voice only for new words, never for standing ones.

Reports, obligations, receipts, and recall still read `kind` and `sender.threadId`: a plain child's parent receives reports like from any child. The only obligation reader of `asOperator` is the closing reminder of the final answer, which skips such requests.

Not in `TransportCapabilities`: capabilities are written by the transport and rewritten on reseat or provider change.
