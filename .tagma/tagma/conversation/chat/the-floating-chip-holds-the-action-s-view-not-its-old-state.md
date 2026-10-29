---
id: 01a17451-149c-7e8b-b265-31efb72a5a27
title: The floating chip holds the action's view, not its old state
ord: 67
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
sources:
  - kind: file
    ref: packages/chat-ui/src/LivePeek.ts
---
The chip helps read history, so short steps need not land in it, and the shown action needs reading time. The hold keeps the entry's identity: a finished step re-reads from the feed and gets its real outcome at once, or smoothing would depict continuing work. The chosen live step persists among parallel ones; vanished candidates form no queue. Hiding the chip ends its hold, but the action's age comes from its entry or first observation, so scrolling up never restarts a long action's delay. The entry's server time converts by the session-measured clock difference; the shown label's hold stays on local clocks and never depends on server clocks. Human waiting and a live-state change cancel the hold.
