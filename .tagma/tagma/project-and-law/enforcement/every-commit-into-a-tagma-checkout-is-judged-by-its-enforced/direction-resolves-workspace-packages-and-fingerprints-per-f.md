---
id: 01a0de42-bfeb-7bea-a84b-c5d7c00d12f1
title: "`direction` resolves workspace packages and fingerprints per file; each builtin declares `tightens`, and `enforce_rule` asks only for a real loosening"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de43-0b70-7baf-a34e-61cf96a1492d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0de42-a34b-71f3-803b-b3e38bdd6f75
---
Builder (A) of [[8bdd6f75]]: package resolution, file-level fingerprint with old pair debt read, `tightens` per builtin, `enforce.ts#loosened` asking it. Files: `packages/code-facts`, `apps/tagma/inspection`, `apps/tagma/server/src/enforcement/enforce.ts`. Done when the decision's acceptance points on packages, per-file debt and tightening hold, and every enforced runlith rule still reads 0.