---
id: 01a1b2cd-b543-7c6d-bbdc-4c90ceccb729
title: A plugin view's `<Thread>` is a fixed-thread seat that threads fills through a port, and it opens every other thread beside instead of moving
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/seats/PlacedThread.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/ViewThreads.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/Thread.svelte
---
`plugin-views` is imported by `threads`, so it cannot draw a conversation itself: it declares the `ViewThreads` port, and composition fills it with threads' `ThreadSeat`, the same `ThreadSlot`, `PaneGraph` and `Conversation` a side pane draws. The thread is the person's whole interface, so what is sent from it is the person's turn, whatever plugin placed it.

The seat holds one thread for its life. Whatever would move a slot elsewhere — opening a child or linked thread, starting a new thread, moving a draft to another project — opens that thread beside, in the side panes, instead of replacing what the plugin placed. The seat is not one of `ThreadSeats`' slots: the main page and the side panes stay the window's threads on screen, so the seat neither takes keyboard focus on its own nor answers the window's thread shortcuts. It shows a thread of the view's project.