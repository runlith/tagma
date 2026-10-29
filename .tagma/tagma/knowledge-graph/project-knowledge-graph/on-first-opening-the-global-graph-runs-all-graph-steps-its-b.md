---
id: 01a14040-8b9f-7011-b296-904360b2be79
title: "On first opening the global graph runs all graph steps: its birth leaves no rows step"
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13fcf-78eb-70b7-b325-3b15ec522548
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: switchIfDue
---
The first access to the global graph (write_setting, search in `global`) ran 8 graph steps: in settingsPlace.itest that is 2.4 s on a loaded machine. `ensureGlobal` births rows on the latest step, but the switch did not know that on first opening (`rowsStep` was null) because opening is lazy. Fix: `ensureGlobal` records the rows step in `meta` (`rows-step:<id>`), switchIfDue takes it, retire removes it. Proof: the test in mirrorMove.itest — the first global opening runs no steps.
