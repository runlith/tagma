---
id: 01a183d8-9309-7f5f-bd78-3da2ce8628fc
title: A body's HTML is final when render answers; code colour arrives later as spans over the same code text and never changes a box
ord: 13
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/highlight/src/colours.ts
    symbol: visibleCode
  - kind: symbol
    ref: packages/markdown/src/render.ts
    symbol: codeColours
---
Rendering answers synchronously so a feed row has its final height in its first frame; a later HTML swap would move the text the reader is looking at. Highlighting runs in the worker and arrives later, so it never touches a block's `html`: replacing a block's `{@html}` string replaces all of its DOM, which drops a selection in prose, unmounts setting chips and parses the block twice. `codeColours(block)` instead replaces the children of the existing `pre > code` elements with the same text split into colour spans, and only on a line whose token text equals the shown text. The plain form already shows the text Shiki will show: for `ansi` the escape sequences are consumed the same way (`visibleCode` in `@runlith/highlight/colours`). Font style from the theme (bold, italic) is not applied, because it can change glyph widths. Colour results are cached per block, so a remounted row colours at once without asking the worker again.

Colour is not painted as CSS custom highlights, although ranges add no elements where spans add hundreds per code block. Chromium repaints highlighted content on every style recalculation anywhere in the document, and during motion, or under any running animation, that is every frame. On the chat-ui stand at 4× CPU, a feed with highlighted code painted about three times as much per frame as with spans, more than the spans' insertion saves. Live `Range`s are not an alternative: every DOM mutation in the document walks them.
