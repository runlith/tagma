---
id: 01a156ee-85ff-7d77-8b14-5e339325a5ac
title: "Rules screen: every rule by name, inspected rule's key at the row, updates on `#rule` changes"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a157af-c264-71d8-bad6-c70ca7f87667",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b08bc3e35102
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad0590e3a1c9
---
Everything in [[c3e35102]]: `read_enforcement` rows for text rules, the `inspection`/`function`/`delivery`/`unreadable` fields, groups with "Followed as text", subscription to `#rule` block changes. Depends on the key in the document [[90e3a1c9]].

Proof is the [[c3e35102]] acceptance.
