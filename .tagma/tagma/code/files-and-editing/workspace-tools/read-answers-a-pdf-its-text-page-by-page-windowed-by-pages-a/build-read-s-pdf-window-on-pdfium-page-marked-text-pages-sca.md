---
id: 01a0dbc1-60e0-7fbc-b460-e417fa25cfd3
title: "Build read's PDF window on PDFium: page-marked text, pages, scanned pages as pictures"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db83-ef63-7ba3-8928-1f42ad36ec89",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0dbc1-60bd-7d0e-aab9-62a10f78260a
---
Build [[0f78260a|the decision]] in `packages/agent-tools`: a `pdf.ts` owning the PDFium engine, the page window and the rendering of scanned pages, `read`'s `pages` argument and its description. Done when the decision's §7 criteria hold, the touched claims are rewritten from the code, and typecheck and the read suites pass.