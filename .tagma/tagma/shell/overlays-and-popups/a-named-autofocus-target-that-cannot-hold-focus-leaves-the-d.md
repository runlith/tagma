---
id: 01a0c86b-2d21-7802-ba9b-a97d9a4902f6
title: "A named autofocus target that cannot hold focus leaves the dialog keyboard-dead: the named step is stamped and counted a success without checking"
ord: 22
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a90d-739e-b053-727e5d33e95f
sources:
  - kind: file
    ref: packages/primitives/src/dialog/content.svelte
  - kind: symbol
    ref: packages/primitives/src/dialog/focus.ts
    symbol: focusInitialIn
  - kind: symbol
    ref: packages/primitives/src/dialog/focus.ts
    symbol: focusSafely
---
`focusInitialIn` treats a named element as a decision rather than an attempt. It takes the first `[data-runlith-autofocus]` match, calls `focusAndMark` on it and returns `true` — with no check that the element can hold focus and no check that it did.

`focusSafely` is built to swallow: it tries `focus({ preventScroll: true })`, then a bare `focus()`, and lets both fail silently. On an element that is not focusable — a `div` or a `span` carrying the attribute without a `tabindex` — both calls are no-ops. The mark is stamped anyway, `true` is returned, and every fallback the function exists to provide is skipped: the preferred-field search, the first-focusable search, and the content box itself.

The caller cannot recover. `takeFocus` in `dialog-content.svelte` reads that `true` and returns without its own `focusSafely(ref)` fallback, so focus stays wherever it was — the body, for a dialog opened from a store. The frame-later retry then finds `content.contains(document.activeElement)` false and calls `takeFocus` again, which repeats the same failed pick with the same result. A dialog opens with no focus inside it, which means the content's own `keydown` handler never runs: Tab is not wrapped and the element-level Escape path is unreachable, leaving only the document capture listener.

Nothing reports any of this. The attribute is the product's own door for saying where focus belongs, so the misuse it invites — putting it on the wrapper rather than the control — produces a silently keyboard-dead dialog.

Fix it at the owner. `focusInitialIn` should treat the named element as a candidate: attempt it, confirm focus actually moved, and fall through to the preferred-field and first-focusable searches when it did not. `focusSafely` already swallows the throw, so the check has to be on the result — comparing `document.activeElement` after the attempt, or filtering the named element through `getFocusableElements` before taking it. A test should assert that a dialog naming a non-focusable element still lands focus somewhere inside itself.
