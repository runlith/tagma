---
id: 01a15951-2e55-78c3-b945-2ffe8b1915eb
title: The place held by a mounted instance belongs to the last live claim, not the last write
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/Claims.svelte.ts
---
When `{#key}` swaps, Svelte 5 builds the new component instance before destroying the old one, and the teardown reads `$state` as it was before this flush's writes. A place arranged as "last writer owns; the leaver zeroes if the place is still theirs" then sees itself in teardown instead of the successor, and wipes the live instance's place. So the main `ChatShell` thread lost its place in `SidePanes` on every `{#key standing}` change in `routes/[project]/+layout.svelte`: `ThreadSeats.host` went empty, and a call Give opened a new thread on the right instead of the open thread's draft.

`Claims` and `KeyedClaims` hold every live holder's claims in order in plain fields the teardown reads as is, while reactive state only mirrors the winner: the last claim acts, a departure removes only its own, and the place returns to the one remaining. The main thread and the shown `SidePanes` layout, the mobile `Screen` main thread, thread slots on the right `ThreadSeats`, the top-line zone and header `Bar`, and Checkout surfaces in `FileOpener` go through them. A new place a component takes on mounting uses the same primitive. Such a place is tested under jsdom: under node, vitest substitutes the server Svelte build, where effects and teardown do not run.
