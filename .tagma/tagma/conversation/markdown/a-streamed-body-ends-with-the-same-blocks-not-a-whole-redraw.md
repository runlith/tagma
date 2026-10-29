---
id: 01a1694f-6cef-7e3b-9a3b-a4208e06fae1
title: A streamed body ends with the same blocks, not a whole redraw; a block that may still change is marked `live`
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/markdown/src/render.ts
  - kind: file
    ref: packages/markdown/src/stream.ts
---
When a body rendered with `streaming: true` arrives with `streaming: false`, the tail closes with the same block splitting. Finished blocks come back with the same values, so the consumer's keyed list keeps their DOM: selections, chips and open popovers survive stream end. A body that never streamed draws as one block: cheaper for cold history reads.

Both paths must yield identical HTML. If block splitting diverges from parsing the whole text — e.g. from reference definitions (including ones nested in a quote or list), lazy lines or setext headings — the splitting is what gets fixed, not a return to whole redraw.

One exception is raw HTML. An element opened in one block is kept open by DOMPurify's HTML parser into the following ones: a `<div>` or unclosed `<b>` spans later paragraphs. So at stream end, blocks starting from the first one containing `<` draw as one fragment. Blocks before it contain no tags, and their HTML does not depend on neighbors.

`live` stands on every open block, i.e. on any that may still change. That is the healed `remend` tail: unclosed inline code there is already `<code>`. That is also the paragraph held back before the tail: the next line may continue it and reparse backtick pairs. When an open block turns finished, it gets `live: false`. Decoration reading code text — a setting chip, say — goes only in a block without `live`.
