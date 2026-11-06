---
id: 01a1696e-ebc7-708f-b516-0a701ec33fbf
title: "Tagma's own colours stand once, as theme data: the window's token stylesheet and the terminal palette are derived from it"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/appearance/contract/wire/tagma.ts
  - kind: file
    ref: apps/tagma/server/src/appearance/stylesheet.ts
  - kind: file
    ref: apps/tagma/app/src/tokens.generated.css
---
Tagma's light and dark palettes stand in `tagma.ts` and resolve through the same `resolve` as any plugin theme. `stylesheet.ts` writes `tokens.generated.css` from them, and Tagma's chrome into the two `theme-color` metas of `app.html` and the colours of `manifest.webmanifest`, which a device with no boot paint and an installed app's splash read before any code runs; `stylesheet.itest.ts` fails while any of them is stale. The terminal's "Same as the theme" palette comes from the same resolution. So a colour changes in one place: an edit to the generated file is lost at the next generation, and no copy of a Tagma colour stands in the terminal catalog.

The values must also stand in a stylesheet the bundle loads, not only in the sheet `Appearance` adopts. A window paints before the feeds answer, and a device with no boot paint has nothing else to paint Tagma with.
