---
id: 01a159bf-ec6e-7736-97c7-0be036796717
title: "Rail holds only daily places, the rest goes into \"…\": pin, both-way drag, personal set and order"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159ae-6e80-74c4-9055-57fbd04c3da5",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/Reorder.svelte.ts
  - kind: file
    ref: packages/primitives/src/popover.svelte.ts
---
**What.** On the rail — projects and pinned places; by default Agents, Checkout, and Knowledge. Below them stands a fixed “…”.

In “…” lie all rail places: Rules, Journal, Calls, Agent library (removed from the utility menu), plugin sections and windows. Each item has a “Pin to sidebar” pin: it appears on item hover, and on a pinned item it is always visible. A pinned item goes to the rail's end.

How “…” behaves:
- opens on hover after a short delay;
- does not close at once when the mouse leaves;
- also opens by click, touch, and keyboard.

Dragging:
- rail icons reorder with the dock's shared `Reorder`;
- an item from “…” lands on the rail where it was dropped;
- an icon returns to “…” when dropped on “…” or unpinned.

Set and order are a personal setting, one for all projects.

**Why.** The operator decided so: rare buttons on the rail waste space and attention, while the daily must return in one gesture.

**Where to start.** `app/chrome/NavigationRail.svelte` and `AppMenu.svelte`. `shared/Reorder.svelte.ts` needs a second drag source and a stash. `packages/primitives/src/popover.svelte.ts` — hover opening. Place declarations — `features/*/surfaces.ts`.

**Proof:**
- test for saving and restoring set and order;
- typecheck;
- check in a live `tagma:try` window with frames;
- review.
