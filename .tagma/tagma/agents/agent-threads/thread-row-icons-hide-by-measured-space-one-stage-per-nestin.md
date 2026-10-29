---
id: 01a1179e-cec7-748d-9c8e-dd360bfe39e0
title: Thread row icons hide by measured space, one stage per nesting level, and a hidden icon stays in layout
ord: 19
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11792-a345-78e4-8aa7-842f55333c0f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/squeeze.svelte.ts
---
The column itself decides which thread row icons stay visible: `Squeeze` holds each row's demand, re-reads only rows whose own size, icon cluster, or title changed (the whole column on mount and after fonts load), and for each indent picks the lightest stage that still leaves every row at that indent about 8 title characters (the fading tail consumes part of the space). A deeper stage is never lighter than a shallower one, so rows at one indent always look alike and a nested row is never more detailed than its parent. This replaced fixed column-width thresholds, which knew neither depth nor icon set, and let a child agent's title shrink to zero.

Two conditions keep the computation correct:
- a hidden icon gets `STOWED` — out of flow but still in layout — otherwise its width cannot be measured and the column never learns it fits again; `display: none` breaks icons coming back on widening here;
- an icon inside another icon (reasoning level and model name inside the model pill) has a stage below its container, otherwise the nested icon's share is subtracted from an already hidden container.

The worktree name is the first stage (`Stow.place`): when space runs short it goes before the reasoning level, model name, context ring, and file count, leaving a colored dot with a tooltip. The badge itself never disappears. The operator requires the branch name to collapse first while model and reasoning hold on longer. The stage order in `Stow` is the hiding order; a new icon that can yield space gets its own stage and a `data-squeeze-piece` attribute. An icon next to the title that never yields (the project mark on a row from another home) is tagged `data-squeeze-keep`: its width is subtracted from the title space, otherwise the stage comes out lighter than needed.
