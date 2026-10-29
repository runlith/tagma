---
id: 01a18345-c21d-7ee5-9e23-72a05620c714
title: The rail shows every message of the thread, not only the loaded pages
ord: 79
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/MessageNav.svelte
---
The rail's tiles are the user messages of the loaded pages (`VisibleFeed.users`), so in a long thread it maps only its tail, grows at the top as pages load, and cannot jump to the start. A whole-thread rail would need: a producer-side index of user messages riding the snapshot and its deltas (the runtime→chat contract of c3436715, so a change of that contract), the same visibility as the feed (rewound, withdrawn and optimistic messages), the predecessor message at a page boundary that starts mid-turn, a seek read around a target instead of loading every page down to it, and a windowed rail — `MessageNav` today mounts every tile and reads every tile's rect on each `pointermove`. It must stay the one source of tiles, not a second derivation beside `VisibleFeed.users`. Raised in the reviews of [[2ea21922]], which leaves it out: highlighting the message being read is met on loaded history.