---
id: 01a1696e-ebc7-708f-b516-0a701ec33fbf
title: "The Tagma Dark and Tagma Light themes keep a hex copy of the `--background`, `--foreground`, and `--brand` tokens from app.css: editing those tokens edits the themes too"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/app.css
  - kind: file
    ref: apps/tagma/app/src/lib/shared/terminalThemes.ts
---
A terminal theme is an xterm object with concrete colors: `composeTheme` applies transparency only to hex, contrast is computed over hex or rgb, and the `terminal.colorOverrides` setting keeps only hex. So the Tagma themes hold the tokens' values translated to sRGB (background, text, brand for the cursor; selection is brand with alpha), not `var(--…)`. Reading tokens from the document on the fly was rejected: window-mode switching and terminal-theme recomputation run in different effects with no ordering guarantee, and light values cannot be read while `.dark` stands on the root.

Without a synchronous edit, the terminal background will drift from the thread background again, and the cursor from the brand gold — the match these themes stand by default for.
