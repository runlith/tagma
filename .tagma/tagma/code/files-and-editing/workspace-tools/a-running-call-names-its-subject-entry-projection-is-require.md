---
id: 01a14b61-0c47-7ef3-a420-fdb4bfca2216
title: "A running call names its subject: entry projection is required in the tool declaration; websearch, webfetch, grep, glob, ls, and the vendor web declare it"
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14b51-d720-7dd5-bf2b-a467111b7332",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/vendorWeb.ts
  - kind: file
    ref: packages/agent-tools/src/websearch.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
---
While websearch runs, the feed writes "Searching the web" with no query: the heading before the answer comes only from the `display` projection, which the tool declares in `Tool.make` (`toolPartialDisplay` in `turn/call.ts` and `ThreadHosting.display`), and Tagma websearch, the vendor web (`vendorWeb.ts`), webfetch, grep, glob, and ls do not declare it — the subject appears only in `ToolAnswer`.

Do:
- declare the projection on these tools (query, url, pattern with path; on the vendor — the first query or address from `targets`);
- make `display` required in `ToolDeclaration`, so a tool without a projection does not compile; a tool with no subject declares `() => ({ form: 'none' })`.

Proof: `streamedSubject.itest.ts` names each of these tools' subject by partial entry, the vendor tool's test, `bun run typecheck` green.
