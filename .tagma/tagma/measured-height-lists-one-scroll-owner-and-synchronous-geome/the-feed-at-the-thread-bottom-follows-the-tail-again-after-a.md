---
id: 01a14f41-54fb-791e-a64d-69d20dfea1b6
title: The feed at the thread bottom follows the tail again after a click beside the column, a selection, a downward wheel and content shrinking
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14f36-79ea-78e7-8ede-1ee3004117b7",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/virtual-list/src/FollowingViewport.svelte.ts
---
The operator sees the bottom of the thread, and new lines scroll away downward. Causes in the code (`FollowingViewport`, `TranscriptViewport`):

- pressing on the feed's own area — fields beside the message column, gaps, the scrollbar — drops following (`hold()`), and nothing at the bottom returns it;
- selecting text in the feed drops following; dropping the selection does not return it;
- a wheel, key, or scroll through the input field downward at the very bottom produces no `scroll` event, so it does not return following;
- the feed's own scrolls extend the "reader's hand" window (`gestureAt`), and when content shrinks the browser pins `scrollTop` to the new bottom — this counts as the reader scrolling up and drops following.

Do: pressing and selection only hold the feed in place and return it to the tail on release if the reader did not move it; the feed at the very bottom follows the tail on any scroll source; a downward reader move at the bottom returns following; the feed's own scroll never extends the reader's gesture.

Proof: unit tests of `FollowingViewport` and `TranscriptViewport` for these scenarios (each red before the fix), typecheck of the packages.
