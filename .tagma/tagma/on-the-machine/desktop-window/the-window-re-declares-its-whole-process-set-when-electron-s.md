---
id: 01a19256-af02-7ecb-9f2f-ff0fe8c07480
title: The window re-declares its whole process set when Electron's events say it moved, and rechecks slowly for what no event reports
ord: 41
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/declaring.ts
---
A declaration is always the whole set, never a delta, so the server's view is replaced rather than patched and a lost one costs nothing. The first goes out when a report socket attaches (a new generation), then one whenever navigation commits, a frame is created, a renderer dies, a webContents is destroyed, a child process is gone or the browser host opens, adopts or closes a page; bursts coalesce, and an unchanged set is not sent.

Two changes raise no Electron event: a frame removed from a page and a renderer that exits quietly after a navigation moved its frames elsewhere. A slow recheck while attached covers exactly these; it reads `app.getAppMetrics()` and the frame trees, and sends only when the set differs. Without it a dead renderer stays declared until the next unrelated event.

A webContents is the interface only when its address is on a Tagma surface origin; a built-in page is named by the id the browser host gave it; everything else is named by its frames' origins. The window sends no names it does not own: titles and app or server names are the server's to attach.