---
id: 01a1366b-3156-7248-ac0d-9b54116babc1
title: ColumnWindow keeps one attachment per row key and publishes only changed geometry
ord: 23
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/ColumnWindow.svelte.ts
    symbol: ColumnWindow
---
Svelte attachments are compared by function identity. Keeping one per row key prevents a list update from detaching and reattaching observation on every mounted row. The thread column keeps this lifetime and its retained keys while the shared list binding owns measurement and geometry; a content-only list update must not publish a new geometry revision. The content before the spacer is observed separately, because a worktree-creation message can shift the list without resizing the scroller.

The column, spacer and row attachments run untracked. An attachment runs in its own effect, so one that read the lines while configuring the list re-ran on every list change: the column's teardown disposes the shared binding, which forgets every registered row and stops observing it, and the rows kept their DOM and attachments, so they never registered again — each stayed at its last top and size while the list moved and grew around it.