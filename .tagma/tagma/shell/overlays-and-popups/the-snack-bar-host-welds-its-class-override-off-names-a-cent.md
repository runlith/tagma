---
id: 01a0c859-9a9a-789d-9e84-0d1be1e40eb4
title: The snack bar host welds its class override off, names a centred position `top-left`, and lets that position take the pointer full-width
ord: 23
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a92c-73b4-85c4-f93d3c062247
sources:
  - kind: file
    ref: packages/primitives/src/DialogHost.svelte
  - kind: file
    ref: packages/primitives/src/SnackBarHost.svelte
  - kind: symbol
    ref: packages/primitives/src/types.ts
    symbol: SnackBarOpenOptions
---
The snack bar host carries the shape of two capabilities it does not have, and a position name that does not describe where it draws. None of the three has a caller today, so all three are latent — and all three are the kind a first caller discovers by being wrong.

**The class override is welded off.** `DialogHost.svelte:18` declares `overrideDefaultClasses` as a prop, defaults it to false at line 26 and reads it at line 34, so a caller can genuinely replace that host's classes. `SnackBarHost.svelte:9` declares the same name as a module-scope `const overrideDefaultClasses = false`, then branches on it three times — lines 34, 39 and 47. Those three branches cannot run. A reader who sees the same helper shape in both files will conclude the snack bar host takes the same override; it takes nothing, and there is no prop to pass.

**`top-left` renders top-centre.** The viewport classes for that position are `fixed top-0 left-1/2 w-full max-w-[1920px] -translate-x-1/2` — pinned to the top, then centred horizontally and capped at 1920px. It is the top-centre placement under a left-sounding name, and `SnackBarOpenOptions.position` publishes that name as one of its two values, so a caller asking for `top-left` gets a snack bar in the middle of the top edge.

**At that position the strip takes the pointer across the whole width.** `bottom-center` gives its frame `flex w-full justify-center`, so the `pointer-events-auto` content box is shrunk to its own content by the flex line. The `top-left` frame is only `pointer-events-none`, leaving the content box an ordinary full-width block — so a 1920px-wide invisible strip across the top of the page accepts clicks for as long as a snack bar is up. The host is otherwise careful about exactly this: its viewport and frame are both `pointer-events-none` for the same reason.

Decide each deliberately. Either give the snack bar host a real `overrideDefaultClasses` prop like its sibling or delete the three dead branches and the constant; either rename the position to what it draws or move it to the left edge it names; and constrain the content box at that position so only the snack bar takes the pointer. Confirm the package's suite and typecheck stay green — no test names any of the three.
