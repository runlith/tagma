---
id: 01a14fe4-7cca-7d89-8e75-79136cf028b1
title: Split Claude Code (`harness:claude-code`, terminal only) from the Tagma agent on Claude (native ACP run) per spec 987b9fc1
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14f84-68cd-75bf-8897-4433dd8555b8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14faf-e87e-7b93-9852-5c59ed037ca0
  - kind: implements
    to: 01a14fe9-0964-7561-900a-61f7987b9fc1
---
Do per [[987b9fc1]]: harness rename with migration, one door into the native Claude run, no `harness` in the native run's row, rigs on the `claude-code` model. Proof is the spec's “Performer proof” section.
