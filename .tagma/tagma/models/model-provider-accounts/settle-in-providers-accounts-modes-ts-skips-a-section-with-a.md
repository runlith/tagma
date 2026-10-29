---
id: 01a13c2d-9bce-76b2-8029-b27d32bc99ab
title: "settle in providers/accounts/modes.ts skips a section with an unavailable preferred option: after CLI install and recheck the saved browser choice flips to CLI"
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c14-5054-78fd-b5e0-9f25782aed8c
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/modes.ts
---
Found by the providers translation's lead reviewer (P2). The `.filter((s) => s.options[0]?.unavailable === null)` filter in `settle` (added by work [[782aed8c]], "settle without forced writes") does not record a choice for a section whose first option is unavailable. When CLI is later installed and `recheck` runs, no saved choice exists, and the browser the operator worked through loses to CLI. Check against spec [[2aa569ba]] whether intended; if not — keep the current effective choice. Proof: a test — browser chosen, CLI unavailable → CLI install + recheck → choice stays browser.
