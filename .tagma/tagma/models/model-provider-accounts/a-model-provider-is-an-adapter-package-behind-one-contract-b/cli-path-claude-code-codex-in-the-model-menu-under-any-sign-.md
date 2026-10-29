---
id: 01a13542-fc07-724f-8c28-6f552e2cfd4f
title: CLI path (Claude Code, Codex) in the model menu under any sign-in mode while the CLI is installed
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12660-dbc3-70fa-b84b-c55e56bcec26",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
---
The registry (`providers/registry.ts`, `hidden`) currently hides the harness provider from the menu and makes it non-selectable when another mode is selected in the vendor section. Because of this, Tagma mode cannot run a native thread on Tagma sign-ins side by side with a Claude Code ACP thread, even though the CLI always runs on its own login.

Do: the menu and `selectable` hide the harness provider only when its CLI is not installed (the section's `unavailable` variant); harness-row quota is still published only in its own mode.

Done: registry test — in another mode the harness is in the menu and selectable, without the CLI it is not; the ledger quota test is unchanged.
