---
id: 01a15a1b-4e0b-770c-9ab8-a7355c7c8e54
title: Defer machine catalog installation until old graph rows are brought to form
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a0e-2b6d-7a45-a5d2-5fa30063c8b7",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
---
Eliminate installing new catalogs at boot over row-backed graphs of unknown, old or newer shape. The machine installer works only with rows at the current GraphSteps.last; the rest transition through lazy switch, graph steps and the mirror installer. Proof: a red-then-green test of the public ensureVocabulary and subsequent opening of legacy notes, a separate check of current/newer/missing marks and the global root.
