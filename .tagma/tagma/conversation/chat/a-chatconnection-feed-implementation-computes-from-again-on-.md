---
id: 01a0ca82-f93d-77a3-a54f-7c0a6d2dde6c
title: A `ChatConnection.feed` implementation computes `from` again on every attach and every resubscription it makes
ord: 30
tags: ["rule"]
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/ThreadPort.ts
    symbol: ThreadPort
  - kind: symbol
    ref: packages/chat-ui/src/wire/ChatConnection.ts
    symbol: ChatConnection
---
A resubscription the socket makes without the session's knowledge after a break also runs the passed current-position `Effect`, instead of repeating the first-attach position.