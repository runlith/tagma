---
id: 01a1b2cd-b543-7c6d-bbdc-4c90ceccb729
title: "A plugin view's `<Thread>` is a placed thread threads fills through a port: on screen without focus, it opens every other thread beside and hands it what the move carries"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/seats/PlacedThread.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/ViewThreads.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/Thread.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/seats/ThreadSeats.svelte.ts
    symbol: ThreadSeats.placedWriter
---
`plugin-views` is imported by `threads`, so it cannot draw a conversation itself: it declares the `ViewThreads` port, and composition fills it with threads' `PlacedThread`, the same `ThreadSlot`, `PaneGraph` and `Conversation` a side pane draws, through the `SlotConversation` both share. The thread is the person's whole interface, so what is sent from it is the person's turn, whatever plugin placed it.

The placed thread holds one thread for its life, and its slot has its own pane key, so its unborn draft is neither the main page's nor a side pane's. Whatever would move a slot elsewhere — opening a child or linked thread, starting a new thread, moving a draft to another project — opens that thread beside, in the side panes, instead of replacing what the plugin placed (`ThreadSeats.placedWriter`). What such a move carries goes with it explicitly, since the slot that started it never moves: a new draft hands its unborn draft, the agent chosen by `/agent` and the place included, to the pane's slot (`ThreadSlot.handDraft`), and a branch takes the words it returns into the branch's own draft key, not into the draft of the thread it came from.

`ThreadSeats.seatPlaced` counts the placed thread as on screen without making it a seat: `shown` and placement include it, so a page, file or call it opens lands on the screen the person is looking at and its read outcome is seen, while `host`, `mainFocused` and the window's thread shortcuts still belong to the main page and the side panes, so it never takes keyboard focus on its own. It shows a thread of the view's project.
