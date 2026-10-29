---
id: 01a159d3-9fcf-77ba-b068-85322a7e573f
title: The operator keeps only needed places on the rail, and gets the rest from “…” and pins them with a pin or by dragging
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
  - kind: relates
    to: 01a159bf-ec6e-7736-97c7-0be036796717
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/MorePlaces.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RailPins.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RailPlaces.svelte
---
**Value.** Rare places do not take rail room or distract. One who needs a place every day returns it to the rail with one gesture.

**How.** Below the rail's pinned places stands a "…" item. It opens on hover, click, touch and from the keyboard. Each place in "…" has a pin. Rail icons reorder by dragging. A place from "…" drags onto the rail, and an icon from the rail — back onto "…".

**Behaviour.**
- Right after installation, Agents, Checkout and Knowledge are pinned.
- "…" enumerates all rail places in a stable order: Rules, Journal, Calls, Agent library, app sections and windows. Pinned ones are there too, their pin always visible.
- A newly pinned place stands at the rail's end. A place dropped on the rail stands where it was released.
- When an open place is not on the rail, "…" is highlighted.
- Hover, pin and drag in "…" do not steal focus. If the operator was typing in an input, they keep typing there.
- Set and order are a personal setting, one for all projects. Changes show in all windows at once.
- When the product later makes a new place daily, it appears on the rail on its own — except places the operator removed.

**Limits.**
- The setting lives in the window's store. It does not move to another machine or browser.
- An app's place is only visible in a project where the app is enabled. In other projects it leaves no empty cell.
- From the keyboard a place can be pinned and unpinned, but only the mouse reorders.
- The mobile shell has no rail.
