---
id: 01a0ca8c-2301-773b-8155-9b10d1d3672b
title: Give the surface the session phase and liveness verdicts, not caller-computed forms or booleans
ord: 33
tags: ["rule"]
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: symbol
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
    symbol: ThreadSession
---
Give the surface the session's phase and liveness verdicts, not forms or caller-computed booleans.

Hero gets unborn, live pulse gets working; a boolean from a run id does not replace these verdicts.
