---
id: 01a14c08-8336-7b3c-965a-b098800eb2b3
title: Plugin pins its own view above the thread's feed for the thread's whole run
ord: 5
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09689f8466a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pins.feed.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/pins.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/pins.ts
  - kind: file
    ref: apps/tagma/server/src/threads/pinOffers.ts
---
**Value.** A plugin keeps above the thread's feed what matters for its whole run — a game table, a task board — instead of one card floated away upward.

**How.** A plugin declares pinnable views in the `pins` point and pins a view with a resource key via the `pin_view` operation, unpins with `unpin_view`; the thread's feed shows pinned views as a strip above itself.

**Behaviour.**
- Only a view the plugin named in `pins` can be pinned; repeating the same address leaves one pin.
- A pin is a thread fact: it outlives the plugin being switched off and shows again when it is back. Pinning checks neither enabled state nor process life.
- A pinned view gets its resource key and thread.

**Limits.** Both operations are for the operator and the outside caller; they are not offered to an agent, and the app has neither a pin nor an unpin button. In practice only the plugin process pins and unpins (or the operator through `tagma op`): an unneeded pin cannot be removed by the operator from the window.
