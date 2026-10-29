---
id: 01a0ee68-7125-7d9c-a29c-e3fcb943ba6b
title: "graph serving imports nothing from change-record: discharge started by change-record, held and task-label ports reversed"
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
---
Done in 8ae13cc40a. Graph declares `TaskHolders` and the `ServedMirrors` event in its own `contract/service/serving.ts`; the mirror builder announces each served checkout instead of starting change-record's discharge. change-record declares `ServedDischarge`, and composition's runtime subscribes the one to the other, so neither module imports the other. `ChangeScope` is filled by invocation (`invocation/admission/changeScope.ts`), not graph. `check_rules` over the tree answers no `graph/ -> change-record/` crossing under the floors of f49f228f.

Left for the change-record wave (§7.5 W4): discharge is still started per served checkout through this event; the spec's form — a subscription to workspace's `headMoved` over the project registry — replaces the event when change-record N lands.