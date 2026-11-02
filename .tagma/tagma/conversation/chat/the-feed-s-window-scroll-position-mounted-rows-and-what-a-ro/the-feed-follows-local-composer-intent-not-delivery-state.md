---
id: 01a199cd-70ef-7b68-a249-9a5be99bd716
title: The feed follows local composer intent, not delivery state
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: file
    ref: packages/chat-ui/src/session/TurnCommands.svelte.ts
---
Returning to the tail belongs to the mounted surface, while only its holder knows that a composer draft was just submitted. The signal is transient and scoped to that holder: received entries, confirmations, automatic retries and reattaching a surface must not take a reader away from a place chosen after submission. The surface releases its listener on detachment and the command scope ends the signal's lifetime. Listener failures are raised outside delivery so a view defect cannot prevent the turn from being sent.