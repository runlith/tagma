---
id: 01a18500-e258-7fef-a6ef-40bb29394a15
title: The agent's cursor is Chromium's DevTools overlay, and every agent capture lifts our overlays for its own frame
ord: 26
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184e9-acb7-7aa5-b270-ce2073c47652
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/cursor.ts
---
The cursor has to reach the desktop native view and every screencast viewer, stay invisible to the page's own scripts, and stay out of what the agent itself sees. The DevTools overlay meets the first two at once: Chromium paints it into the page's compositor output, so the WebContentsView and `Page.screencastFrame` both carry it, and it adds nothing to the DOM, to any JS world or to event dispatch. The alternatives were rejected: a viewer-drawn cursor cannot reach the native view, which lies above all window HTML; a desktop-drawn view over the page would take the operator's clicks over its bounds and cost a renderer process of its own.

The price is that `Page.captureScreenshot` reads the same compositor output, so an overlay standing during a capture lands in the picture — the pick highlight was once seen in a pick's picture this way. `unmarked` therefore lifts every overlay of ours for the length of a capture and puts it back after: the cursor by `hideHighlight`, an open pick by switching inspect mode off in the root and its out-of-process frame sessions, because each inspect tool repaints its hover highlight on its own. Pick begin and end, frame adoption, and captures share an overlay-write queue so a newly attached frame cannot restore a highlight during capture or retain inspect mode after the pick ends. A new capture path the agent receives must go through it; the screencast's fallback first frame is for viewers and keeps the cursor. Chromium offers no way to hide a pick's hover highlight but replacing its inspect tool, and the new tool forgets the hovered node until the pointer moves again: a press with no move after an agent capture during picking picks nothing and reaches the page.

Element boxes are drawn with `highlightQuad`, never `highlightRect`, whose coordinates the protocol leaves wrong at a device pixel ratio other than 1.

Chromium keeps one highlight at a time, so an action shows either the box of its element or an arrow at its point, and nothing while a pick holds the overlay.
