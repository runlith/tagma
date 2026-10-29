---
id: 01a0f820-b65a-7aa0-850a-69b0a54da71b
title: "Build 7489a79e: every call stands on its place's served graph, and enforcement reads standing rules through Orientation.rules"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f81d-4179-7d66-86a9-04a37731dee0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0f7ec-3b2c-70ab-a21f-1375c1e12165
  - kind: implements
    to: 01a0f826-e222-7653-b45b-f8c07489a79e
---
Build [[7489a79e]] in its order (§9).

Files: `apps/tagma/server/src/invocation/admission/services.ts` and its two callers (native door, HTTP admission); `apps/tagma/server/src/graph/contract/service/orientation.ts`, `graph/orientation/prime.ts`; `apps/tagma/server/src/enforcement/rules/{reach,engines}.ts`; contract tests under `composition/testing/enforcement/` and the catalog-wide call test.

Done when §7 holds: both contract tests red before and green after, server typecheck clean for the changed files, claims written from the code, and an independent review's holding findings fixed.