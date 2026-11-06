---
id: 01a170e7-94b3-719a-aaad-eb24412bbac1
title: Code colors with `var(--syntax-*)` roles whose values are Tagma's theme tokens, hued no closer than 21° to state tones
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a170de-397f-794e-8eaa-e72de2ced92c
  - kind: relates
    to: 01a1661f-b314-7930-87f2-794af671eb5f
sources:
  - kind: file
    ref: packages/highlight/src/theme.ts
  - kind: file
    ref: apps/tagma/server/src/appearance/contract/wire/tagma.ts
---
The kit's shiki theme carries no color: each token role — keyword, string, function, type, constant, property, declaration, punctuation, comment — is a `--syntax-*` CSS variable, and their values for light and dark stand in Tagma's theme data, generated into the window's tokens; a plugin theme sets its own. So coloring does not depend on the window theme: CSS does the theme switch, with no recoloring of documents in the worker and no second color set.

In Tagma, color in the window is signal: red is failure, blue change and "waiting on you", green done, amber work, gold "you are here". The GitHub themes standing before laid keywords, strings, tags and parameters right onto those tones, and a removed-line stripe got lost among red `import`s. So role hues stand no closer than 21° to any state tone, and their saturation below the signals'. Names, punctuation and comments tintless, like window text, and no gold in code. A new role or hue shift keeps the same conditions.

Exception: `markup.inserted`, `markup.deleted` and `markup.changed` (diff and patch in a code block) — that is added, removed and changed, so their roles point at `--status-done`, `--severity-lie` and `--mutation`.

The terminal palette not included here: ANSI colors chosen by the program itself, and red there really reports an error.
