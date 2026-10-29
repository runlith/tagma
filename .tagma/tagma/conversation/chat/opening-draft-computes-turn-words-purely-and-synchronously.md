---
id: 01a0ca81-10a0-7a79-8451-26b23be174e5
title: Opening draft computes turn words purely and synchronously
ord: 26
tags: ["rule"]
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatDraft.ts
  - kind: symbol
    ref: packages/chat-ui/src/ChatDraft.ts
    symbol: ChatDraft
  - kind: symbol
    ref: packages/chat-ui/src/session/TurnCommands.svelte.ts
    symbol: TurnCommands
---
The opening draft computes turn words purely and synchronously.

Sending after the thread is born runs compose once and does not carry its own words instead of the opening draft.
