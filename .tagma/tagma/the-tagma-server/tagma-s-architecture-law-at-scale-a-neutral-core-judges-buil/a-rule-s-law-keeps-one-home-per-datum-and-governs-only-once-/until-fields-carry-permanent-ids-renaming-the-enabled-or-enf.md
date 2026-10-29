---
id: 01a0f50e-6e4f-7a47-b85f-9eb7703a62c4
title: Until fields carry permanent ids, renaming the enabled or enforcement field of a type carrying an adopted rule reads that rule pending, and its accepted law keeps judging
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0f4ab-e2f0-7606-910e-f31b53727148
  - kind: relates
    to: 01a0f483-46b0-7202-b8fc-bbf742fb81f7
  - kind: relates
    to: 01a0f483-46b4-7a20-8471-e0b5877ba8f0
---
§7 says renaming the graph's field keys leaves an adopted rule accepted. Release N meets that for the document's own keys — a version 1 document rewritten as version 2 with the same decoded policy stays accepted (`composition/testing/enforcement/adoption.itest.ts`). It does not meet it for the fields of the rule's type. The pinned law projection names the `enabled` and `enforcement` fields by name ([[f1c49a55]]'s `LawProjection`), because no permanent field id exists yet, and `enforcement/adoption/predecessor.ts#differences` compares projections with the graph's `readsLawAlike`. So renaming `enforcement` to another key is indistinguishable from moving the binding to another field: the rule reads `pending` and its accepted law keeps judging. That fails closed, never open.

Proposed correction: §7's field-key item applies to the document's keys now, and to a type's field keys once [[42fb81f7]] gives fields permanent ids and the pinned projection compares them through the owner's mapping (`TagTable.resolveStoredType` and its field counterpart), with [[877ba8f0]]'s contract translation keeping the meaning. A reference the mapping cannot resolve must keep the pinned predecessor judging — pending or failed, never dropped.

Owner of the change: the stable-id work ([[42fb81f7]], task ee489b18). Release N changes nothing else here.
