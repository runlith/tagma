---
id: 01a0de42-c029-7e92-91df-bdf2db2448ad
title: "Judge every `git commit`: staged-tree subject, `checkout_commit` wiring, `tagma check`, the `pre-commit` hook Tagma installs, and the human override recorded as an escape"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de43-0bf0-782e-adec-d5417d9a4ee3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0de42-a34b-71f3-803b-b3e38bdd6f75
---
Builder (B) of [[8bdd6f75]]. Files: `apps/tagma/server/src/enforcement/` (except `enforce.ts#loosened`), `cli/`, the checkout operation body, project/worktree registration for hook install. Done when the decision's acceptance points on `git commit`, `checkout_commit`, hook chaining and the server-down path hold.