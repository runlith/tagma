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

So the lens never leaves while an act for its block and language is being started: `Translations` marks the act from the press until `translate_block` answered and the block's reads were fetched again, and the lens also waits out a read in flight, since a cached read may predate the act. A refusal (no usable model, an unknown model) is held per block and language for the life of the graph scope and is replaced only when the next act settles, so a retry from the lens keeps showing the old refusal rather than dropping the lens. The press moves to the lens right after its read, without waiting for the act, and only while the reader still stands where he pressed.

A chosen model or "Translate again" stops the running act first: the server joins a running act whatever model it is asked for.

A changed part shows its current original, joined with neighbouring parts of the same state into one markdown body, so a fully translated block renders with its own spacing.