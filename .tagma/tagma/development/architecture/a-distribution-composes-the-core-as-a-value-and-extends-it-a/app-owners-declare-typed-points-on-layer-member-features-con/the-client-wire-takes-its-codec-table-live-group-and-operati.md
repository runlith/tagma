---
id: 01a193d9-9a1f-79e8-9f71-7a9ff0c456d5
title: The client wire takes its codec table, live group and operation types from the descriptor's catalog
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19462-91e4-73af-be6c-6232bd8177ec",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a97bd02efd7
---
Item 9 of [[d4b30c0c]]: a browser-safe `CATALOG_MODULES` replaces the `USED` list in `lib/wire/liveGroup.ts`, and operation types widen through an augmentable `interface Operations`. Since the build descriptor landed (186df10a6), `Build` has no browser-safe catalog of its own and the release app carries developer-only wire declarations; the descriptor's catalog ends that.

`readingOf` in `lib/wire/WireEntryKinds.ts` stands in for agent's `ThreadEntryReader` by hand. It spreads an empty reader and overrides only the four members that depend on products: `decode`, `read`, `readWire` and `writeWire`. A later member that depends on products, or a reader with a `worker`, would silently answer from the empty reader. When the client wire takes its kinds from the catalog, let `makeThreadEntryReader` take a products source it reads on each decode, and drop the hand proxy.