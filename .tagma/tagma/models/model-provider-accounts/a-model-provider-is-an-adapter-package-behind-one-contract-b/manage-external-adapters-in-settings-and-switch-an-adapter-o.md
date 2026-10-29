---
id: 01a12f52-1afd-7cd3-a3a7-74e0ea19a4b3
title: Manage external adapters in settings and switch an adapter off; model hints for agents are an operator setting
ord: 12
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Gaps from spec-audit №5, №6, №14. The app has no adapter install, update or removal by source (npm, GitHub, path) — only the `tagma adapter add/update/remove` CLI. Disable exists nowhere: `AdapterInstall.enabled` exists, the operation does not. `spawnGuidance` is removed from descriptions, and its replacement — an operator setting of "for what" and "which reasoning" per (provider, model) pair, read by `CollaborationTools` — is not made.

Done: a `disable`/`enable` operation and CLI verb; an adapters section on the Providers screen with a list (source, version, state, `failed` reason) and add/update/disable/remove actions; the model-hint setting and its text in the agent model menu. Screenshots from a separate instance.
