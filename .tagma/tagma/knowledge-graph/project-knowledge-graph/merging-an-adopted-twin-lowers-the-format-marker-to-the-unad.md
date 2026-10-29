---
id: 01a13fec-26e3-7a27-913f-b98c30be37d9
title: Merging an adopted twin lowers the format marker to the unadopted branch's step and re-runs all steps
ord: 53
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
    ref: apps/tagma/server/src/graph/tree/topology.ts
---
**What.** From the task's review [[ec522548]] (tree-correctness lens, code reading, not measurement): after adopting a twin to the target's format, the `format.json` marker lowers to the step read from the twin branch's ref (`show <name>:format.json`, `graph/tree/topology.ts:344-346`), while the adopted commit merges (`carried`, `topology.ts:343,348`; `merges.ts:190-217`). The ref points at the pre-adoption commit, so `lower` writes the old step over the freshly adopted `LAST_STEP` (`topology.ts:350-356`), and `open.ts:283-289` re-runs all steps, the projection, and the `graph steps:` commit.

**Why it matters.** The steps are idempotent and the result converges, but every adopting merge pays a full step cycle and a spare commit.

**Verify and fix.** Confirm from the code that `brought` reads anywhere but the adopted commit; read the marker from `carried`. Done when merging an adopted twin produces no `graph steps:` commit and the post-merge marker is the target's step (`levelling.itest.ts`, `twins.itest.ts` green).
