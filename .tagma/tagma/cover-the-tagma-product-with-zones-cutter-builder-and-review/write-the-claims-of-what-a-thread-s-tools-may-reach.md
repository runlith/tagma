---
id: 01a0ca97-13bc-7e41-a7b8-6741a9b2d65b
title: Write the claims of what a thread's tools may reach
ord: 207
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caad-6666-77ab-9b92-94c0804162e8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/harness/capabilities
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/presentation.ts
---
Read `harness/capabilities/` whole, with `PermissionRules.ts`, `toolPresentation.ts`, `toolProjection.ts`, `nativeCatalog.ts`, `skills.ts`, `artifactSkill.ts`, `performanceSkill.ts`, `mcpRule.ts`, `mcpServerTools.ts`, `WebSearch.ts`, `AgentLibrary.ts`.

Write the claims of [[89df5e7a]]: what a capability admits and what it only appears to, how the touch rule decides which law a path's writer receives, which operations are subtracted from an agent's catalog and why, what a world tool may reach that a plain tool may not, and how one operation is spelled to each kind of caller. The kernel decides whether a call may run at all — [[4c82c2b1]] — so write what Tagma's capabilities decide, not the policy engine beneath them.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].