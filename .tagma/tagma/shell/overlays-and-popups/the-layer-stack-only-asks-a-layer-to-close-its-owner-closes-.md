---
id: 01a14b64-ed7d-7eec-88b3-770de2998e26
title: The layer stack only asks a layer to close; its owner closes it; one stack per document
ord: 16
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
sources:
  - kind: file
    ref: packages/primitives/src/dismissal.ts
  - kind: file
    ref: packages/primitives/src/layer.svelte.ts
  - kind: file
    ref: packages/primitives/src/OverlayLayers.svelte.ts
---
The stack decides whom to ask to close and in what order: Escape — the top layer; press and focus outside — from top down to the layer whose logical subtree holds the target (the stack collects the target's owners and their ancestors in one pass for that), or to a modal dialog; also — a layer whose anchor left the DOM, and descendants of a closing parent. The ask is the owner layer's `onDismiss(cause)` call. The owner either closes the layer itself, synchronously (`close(cause)`) — so the next step of the same pass and the next press already see the stack without it — or refuses.

Refusal is the policy: "Escape is busy" at an `ignore` dialog, `dismissOnFocusOutside={false}` at a terminal menu, the bits wrapper closing by its own mechanism. So the stack stores no component state and knows no props, and one registration serves a dialog, menu, submenu, select, popover, and tooltip; the tooltip registers with `dismissable: false` and stands in the stack by depth alone.

A closed layer holds its z while at least one of its surfaces stands on the page (`layer.surface`): the outro does not fall under a layer opened after it. When the 99 band places run out, the stack renumbers the taken places from below, keeping their order.

The stack is one per document — the `overlayLayers` instance, not the app graph's service: its listeners hang on `document`, the z band is one per document, and a second stack would quarrel with the first over one press.

Focus the stack returned when a layer closed does not count as focus leaving other open layers: otherwise closing the top menu would close the neighbor.
