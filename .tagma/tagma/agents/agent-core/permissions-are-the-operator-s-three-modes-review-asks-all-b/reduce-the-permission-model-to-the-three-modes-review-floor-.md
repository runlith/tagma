---
id: 01a0f9a9-a301-77e2-9a90-bf6be56a369e
title: "Reduce the permission model to the three modes: review floor over all but pure reads, and remove spawn reach, rights, definition rules, owner rules, grants and inherited authority rules"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f9aa-8aa0-7755-af2f-b89f3e9b0506",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f9a9-a2cb-70ac-ac38-efa4f6f8e9c5
---
Build the kernel and plane half of [[f6f8e9c5]]: the review floor, the removals in `packages/agent` (permissions, collaboration, thread authority), the server's owner-rule stores and consent source, the question's "always" answer in the app, the agents doctrine and the collaboration prompt, and `interrupt_agent` under the `own-lineage` sanity limit. The thread verbs' `reach` and the archive/delete lineage belong to [[c2778bc5]]. Done when the spec's acceptance for these parts holds and the claims over the removed code are retired or rewritten from the code.