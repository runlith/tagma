---
id: 01a11d9b-58bd-7f29-9f53-0140e843aa87
title: "Terminal on core, part 2: terminal CLI questions via hook — Questions entries with adapter route; the facet.question slot for hook and screen goes away"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
---
What: questions from [[a621fbb3]] on the [[2d80ffd6]] mechanism (answer route recorded at `asked`). The proven core Questions are already available; end-to-end ACP acceptance stays in [[2d80ffd6]]. The terminal's `TransportAsks` joins the single adapter registration from [[6232d2bb]], with no separate run opening on the question side.

Proof: the [[a621fbb3]] question criteria; migration of open hook/screen questions under the same id.
