---
id: 01a0cac3-b3c2-7610-bc30-ddfa77e40774
title: The console-key card prints a raw rounded percent beside its grammar-ruled hover
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/ConsoleKeyGroup.svelte
---
The usage grammar (`figureText`) never rounds a share into a lie — a spent window reads 99% until it runs out, a touched one `<1%` (`windows.ts:61-84`, claimed by [[33ea51a8]]). But the console-key card prints the visible percent with a raw `Math.round` (`ConsoleKeyGroup.svelte:149`) while its own hover reads `figureText` (`:139`): one window can show `100%` beside a `99%` hover — the exact disagreement the grammar exists to prevent.

Route the card's visible percent through the shared grammar, or record why it differs. Done when no two readings of one window disagree.