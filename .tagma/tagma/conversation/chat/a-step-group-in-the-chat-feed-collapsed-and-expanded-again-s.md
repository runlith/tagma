---
id: 01a154f0-e124-7d16-b37a-b392adf67508
title: A step group in the chat feed, collapsed and expanded again, shows an expanded header with no steps
ord: 77
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ActivityStretch.svelte
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
  - kind: file
    ref: packages/chat-ui/src/TimelineFold.ts
---
The operator collapsed a "Worked for 9s · 7 steps" group in the feed while the thread was still growing, and could not expand it: the arrow stands expanded, but there are no steps under the header. After a page reload the bug did not repeat. It was seen in the demo, but the demo runs the same `packages/chat-ui` as the app.

Not reproduced in jsdom through the real `ChatSurface` and `ThreadSession`: collapse → new records → switch to another target and back → expand; separately — a feed with 260 preceding messages and the 66 lead chunks of the `lab` scene, expanding before and after the second turn, unread signals, and progress-only events. On the original code the steps come back. On ordinary expand, `ChatEntryView.setExpanded` changes the revision, `rowView` gets a new reference, `TimelineFold` adds step keys and changes shape; the unchanged-rows branch in `begin` does not explain this transition. Geometry unchecked: the harness sets every row to height 60 and disables ResizeObserver, while `TranscriptRow` clips content to the virtual row height. Still unknown whether the steps were missing from the DOM or had zero/foreign height. Baseline checks passed: 462 tests, 6 bench tests; typecheck — 0 errors and warnings. The temporary experiment is removed from the checkout; no fix and no commit.

Proof is a red-then-green test of the feed's public behavior: collapse a group, feed new records, expand — the steps stand. The fix goes to the defect's owner.
