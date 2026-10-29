---
id: 01a0c869-cc73-7bef-b10e-1361af53608f
title: "A scrimless dialog still blocks the page: the host's layer div takes the pointer the option promises to leave free"
ord: 28
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
  - kind: symbol
    ref: packages/primitives/src/types.ts
    symbol: DialogOpenOptions
---
`scrim: false` is offered so a panel can stand over a page that is still usable — the option's own words are "whether the dim exists at all: without it the page beneath stays live, which is what a panel over a still-clickable bar needs". It does not do that.

`DialogHost.svelte:55` wraps every showing in a `fixed inset-0` layer div carrying the entry's z-index. The class list carries no `pointer-events-none`, so the div's pointer-events are the default, and it is rendered unconditionally — the `{#if entry.scrim}` at :56 guards only the dim inside it. The content box at :67 IS `pointer-events-none`, and the view's own wrapper at :69 re-enables the pointer. So the hit-testing chain over the whole viewport is: layer div (auto) → content (none) → wrapper (auto). Every click outside the view's wrapper lands on the layer div and stops there.

A comment at :52 used to claim the opposite — no scrim means no catcher; the prose strip in 0b3f108d7e removed it (verified 2026-09-26). Nothing now remarks on the div wrapping the content.

This is live, not latent. `apps/tagma/app/src/routes/+layout.svelte:89` mounts `<DialogHost overlayClass="…" contentClass="…" />` and passes no `layerClass`, so the default class list is what ships; `test-utils/DialogStack.svelte:11` mounts it with motion only (verified 2026-09-26). A caller could pass `layerClass="pointer-events-none"` today, but that also strips the layer's own layout unless it repeats it, because `overrideDefaultClasses` is off by default and `cn` merges — so the workaround is a caller repeating the host's internals.

Fix it at the host: the layer div should decline the pointer when the entry asked for no scrim, leaving the wrapper at :69 as the only thing that takes it. Note while deciding that the scrim case wants the opposite — a dim that catches the outside click is how `interactOutsideBehavior` is reached through `Dialog.Overlay` — so the two branches genuinely differ and the fix is per-branch, not a blanket `pointer-events-none`. A test should assert that a click outside a scrimless dialog reaches an element beneath it; nothing asserts that today.
