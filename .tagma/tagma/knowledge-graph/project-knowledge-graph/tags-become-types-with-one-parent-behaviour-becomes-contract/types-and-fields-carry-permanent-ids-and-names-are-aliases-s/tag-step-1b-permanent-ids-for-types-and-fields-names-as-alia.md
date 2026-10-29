---
id: 01a0f4aa-02db-794f-b21a-598eee489b18
title: "Tag step 1b: permanent ids for types and fields, names as aliases, the resolver over today's keys"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4fc-e1b3-78c6-9512-6968c6e59fc3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46b0-7202-b8fc-bbf742fb81f7
  - kind: waits-on
    to: 01a0f4aa-02c3-7b01-b494-5e38f1c49a55
---
Builds [[42fb81f7]], concurrently with the compiler through its TypeResolver seam. Identity owns canonical ids, immutable carrier keys, aliases and rename semantics; it does not own a second compiler or installer. Format activation belongs to [[3d39abda]]; concrete boundaries are [[0f83e781]]. Class: **complex** (claude-opus-5-5 `high`). Scope: `graph/vocabulary/`, `graph/blocks/` rename road, saved-query references. Acceptance: [[42fb81f7]]'s — rename with carriers, two catalogs sharing a name, references by id; no stored byte rewritten. `LawProjection` ids resolve through it.