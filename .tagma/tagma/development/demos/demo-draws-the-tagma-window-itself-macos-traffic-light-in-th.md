---
id: 01a1517d-5ffd-7729-93d4-7c5a31910673
title: "Demo draws the Tagma window itself: macOS traffic light in the app header instead of a landing frame"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/demo/app/src/runtime.ts
  - kind: file
    ref: apps/tagma/site/src/lib/landing/Showcase.svelte
---
The landing frame with its own "Tagma — polygon" bar over the app looks out of place. The demo draws an unclickable macOS traffic light right in the app header, plus back/forward arrows as in desktop; the landing shows the iframe with no bar of its own. Proof is the demo build and app typecheck.
