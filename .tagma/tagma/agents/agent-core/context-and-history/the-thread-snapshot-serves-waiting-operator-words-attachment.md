---
id: 01a15cad-d589-74ac-8ed4-32adf98a8c93
title: "The thread snapshot serves waiting operator words' attachment address and type without reading image files: a missing file yields a broken thumbnail, not a snapshot failure"
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15c97-6b29-7235-b1b3-abd3af6f7c28
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
    symbol: waitingTurnOf
---
At an operator word's waiting attachments the thread snapshot serves the attachment address and type without reading image files: a missing file yields a broken thumbnail, not a snapshot failure.

Attachments of one's own steer and follow-up in `pendingInput` travel the attachments port's `addressed`, not `resolve`. `resolve` checks every file on disk, reads all of markdown, and fails on a missing file — while the snapshot publishes on every going-turn state change, so one deleted image of a waiting word would drop the thread feed. `addressed` builds the address from the owner URL and the type from the attachment id; it reaches disk only for a PDF name. The box above the input field and "Edit" read these fields as they stand, never assembling the address themselves. Other agents' mail (`arrived`) travels `resolve`: its attachments leave into the journal together with the signal.
