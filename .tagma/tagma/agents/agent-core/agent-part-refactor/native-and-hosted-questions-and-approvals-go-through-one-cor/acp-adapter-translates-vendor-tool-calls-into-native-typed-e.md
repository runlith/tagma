---
id: 01a11caa-42ff-703c-82f5-4128b0dc848c
title: ACP adapter translates vendor tool calls into native typed entries; the client drops acpCall and AcpToolRow
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/external/acpCall.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/projection.ts
---
Implements the [[fb39e560]] paragraph on hosted-road calls: the server-side ACP adapter (module [[287a4906]]) translates raw ACP shapes (`content` diff/terminal/content, `locations`, `rawOutput`) into the same typed entries as native — display, `ThreadToolState`, outcome from the shared settlement projector ([[c3436715]]) — before ingress. The client never parses ACP shapes.

Start: `apps/tagma/server/src/external-harnesses/protocol/projection.ts`; client — `features/threads/external/acpCall.ts`, `AcpToolRow.svelte`, the branch in `native/tools.feed.svelte`.

Done: an ACP thread renders with the shared `ToolRow` and no transport branch; `acpCall`/`AcpToolRow` are removed; de-duplication of Tagma-executed calls is kept ([[ae10d61d]]); a projection contract test on recorded ACP shapes; typecheck of the affected packages.
