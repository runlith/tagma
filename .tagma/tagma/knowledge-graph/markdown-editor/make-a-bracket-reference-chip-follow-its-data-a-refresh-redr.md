---
id: 01a0c70e-37f7-756c-9103-98efffabe318
title: "Make a bracket-reference chip follow its data: a refresh redraws nothing, and a click opens the target the node view was built with"
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/markdown-editor/src/bracketRef.ts
---
Two measured defects in `packages/markdown-editor/src/bracketRef.ts`, found while the zone was written (probes under bun + jsdom over the checkout's sources): (1) `refreshBracketRefs` dispatches a no-op transaction, which the editor view does not redraw a node view for, so the surface that calls it when resolution data moves (`apps/tagma/app` `BlockBody.svelte`) leaves a renamed block's chip on the old title until that atom's node is replaced — stated as [[5b762d80]]; (2) `addNodeView`'s click handler closes over the node the view was built with while `update` re-renders the DOM from the new one, so after an in-place attribute change the chip shows the new target and a click opens the old one. Start at the node view in `bracketRef.ts`; completion is a chip whose text and click target both follow the attributes it currently carries, with the consumer's refresh path either working or removed, and [[5b762d80]] rewritten from the code that results.