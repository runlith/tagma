---
id: 01a16183-dbba-7945-afa5-dc047a32e162
title: A checkout mark reaches onMark listeners even when nobody reads that checkout's lines
ord: 21
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
A typed record (`Intake.land`) marks the checkout before the tool answers, and `onMark` calls listeners in that same step — even when nobody reads that checkout's lines. The listeners — the navigation engines holder, Holdings, the authorship cache — judge the checkout's inputs, not its lines: if they were called only when lines had a reader, a write to a checkout not open in the UI would reach them only with a watcher event, and the engine would answer from the stale file text the agent just wrote. Rereading the lines themselves still happens only for held lines; `refs`, `head`, and `operation` listeners do not wake ([[30a50401]]).
