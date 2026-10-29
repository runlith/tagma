---
id: 01a11ca5-7ddf-7f42-a891-bd632d80ffd6
title: "ACP vendor questions as Questions records: asked, resolved, TransportAsks.answer; the facet.question slot for protocol goes away"
ord: 14
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9128a5e5740d
---
What: [[35a07ee2]], "Vendor questions", plus cut 2 of the [[9116e494]] root; the "answer given, not yet delivered to the vendor" flag is introduced by the `Questions` owner ([[fb39e560]]). No second question machinery.

Proof: two simultaneous `request_permission` calls become two questions, answers travel by their own ids, cancel answers both; open `protocol` questions migrate under the same id.
