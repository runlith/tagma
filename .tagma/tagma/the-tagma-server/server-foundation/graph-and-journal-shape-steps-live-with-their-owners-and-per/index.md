---
id: 01a14aa9-df12-7761-aebe-0e14f8616748
title: Graph and journal-shape steps live with their owners and persist across releases
ord: 25
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79ed842e3529
  - kind: relates
    to: 01a1320b-f658-774d-b6ad-8df84581b954
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cut/steps.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/format.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/sequence.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/baseline.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/formSteps.ts
---
Graph and journal-shape steps stay in the code past the release that carried them. Graphs travel over git between branches and people on different versions; deleting travelled steps leaves an old copy with no path to the current shape. The operator cancelled the former requirement to fold those steps.

A cut keeps the step lists in `release.json` and the feed for stored-shape accounting. An already-released graph or journal step may be present; the cut does not require moving `GRAPH_BASE` and `JOURNAL_BASE` to the previous release's last step. The step and shape-reading machinery itself is unchanged by this edit.

`machine-store` migrations keep the cut's former condition: migrations carried by the last published release fold into the base one; the base itself is exempt from this requirement in the receipt. That is a separate translation of the base's ledger, not a deletion of the carried graph's or journal's steps. `host-store` still skips the fold check.

The work [[b5bac326|on the cut conditions]] checks that travelled graph and journal steps persist under the same machine-migration check, the cut tests and server types. A real release and server restart are not part of this check.

A step stays with its shape's owner: the graph in `graph/steps/`, the journal in the `steps/` of the module declaring the record shape. Wiring goes through manifests; serving takes the graph steps through the `GraphSteps` port. That boundary keeps the shape's knowledge with its recording author.
