---
id: 01a1891b-78b4-729f-b8ec-6895b9564a0a
title: The translation lens is an address the page leaves on its own when no translation stands and no refusal explains it
ord: 17
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/translation/Lens.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/translation/Translations.svelte.ts
---
A link followed from the lens carries `lang` without asking whether its target has a translation there: the target page reads its projection once, and when the read answers none and no act of this window was refused, the page drops `lang` in place (the address is replaced, an aside pane clears its own state). Asking before every link would cost a read per link the body draws; the page's read is the one it needs anyway, and it never starts a model call.

The menu press and the palette therefore call `translate_block` before they move to the lens: the server writes the act's row before it answers, so the page's first read already finds a projection and does not leave. A refusal (no usable model, an unknown model) is held by `Translations` per block and language for the life of the graph scope, which keeps the lens standing to show it.

A changed part shows its current original, joined with neighbouring parts of the same state into one markdown body, so a fully translated block renders with its own spacing.