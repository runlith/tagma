---
id: 01a13d48-9aa9-71d0-a2d8-68ff1bd06392
title: "Popover on the kit stack: non-modal, circular Tab, focus into the first field"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/popover
  - kind: file
    ref: packages/primitives/src/popover.svelte.ts
---
14 consumers.

**Parts:**
- `Root`: `open`/`bind:open`, `onOpenChange`;
- `Trigger`;
- `Content`: `side`, `align`, `sideOffset`, `collisionPadding`, `anchor`, `initialFocus`, `returnFocus`, `dismissOnFocusOutside`, `trapFocus`.

**Behaviour.**
- The popover is non-modal: outside pointer and focus-outside close it per [[313c7343]].
- Tab cycles inside the popover by default, as today: bits has `trapFocus = true`. Popovers with fields (`speech/library/Again.svelte`, `settings/controls/ColorSlots.svelte`, `app/chrome/StandingChip.svelte`) do not close on Tab.
- Opting out of the trap is `trapFocus={false}`. `threads/Peek.svelte:370` uses it.
- Opening moves focus to the first field or first tabbable, closing returns it — per [[313c7343]].
- Consumers with `customAnchor` (`threads/FolderPicker.svelte`, `threads/Peek.svelte`) move to `anchor`. Peek's `onOpenAutoFocus` becomes `initialFocus`.

**Performer check** (unit):
- opening via trigger;
- closing on Escape and outside click;
- focus lands in the first field and returns to the trigger;
- Tab cycles, and with `trapFocus={false}` leaves.
