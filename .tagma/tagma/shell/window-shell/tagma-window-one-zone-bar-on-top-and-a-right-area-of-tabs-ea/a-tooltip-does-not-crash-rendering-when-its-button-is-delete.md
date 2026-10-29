---
id: 01a156df-9e12-7e57-b79d-03b8b64e21f5
title: A tooltip does not crash rendering when its button is deleted; call, attention, and menu moved to the left rail
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: packages/primitives/src/tooltip.svelte.ts
---
**Bug.** "Pressed — tabs appeared, but no area". Reproduced on its own `tagma:try` in Chrome. Console shows `state_unsafe_mutation` from `tooltip.svelte.ts`, path: `hide` ← `drop` ← `focusout`/teardown ← `{#if}` in `AreaToggle`.

How it happens:
- a button with a tooltip disappears as a tab opens;
- its `focusout` and teardown write `$state` from inside a block effect;
- Svelte throws, the update breaks mid-way: the bar is drawn, the area is not.

From reading a stale value in teardown, the tooltip also never closes.

Fix at the owner, in `Tooltip`:
- comparison goes by a plain field;
- reactive-state writes wrapped in `untrack`.

**Move per the operator's word.** Call, "Attention", and menu left the header for the bottom of the left rail. A separate Settings button is gone: settings live in the menu. The rail element's shared classes are in `shared/ui/rail.ts`.

Verified:
- in Chrome on `tagma:try`: opening a tab via "+", hiding and showing, the rail menu — no console errors;
- `tooltip.test.ts` on deleting a shown trigger;
- typecheck, `primitives`, `app`, `speech` tests.
