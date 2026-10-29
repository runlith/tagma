---
id: 01a15ec6-775c-704c-ad94-8a240e6a1e75
title: "Step 5: text in HTTP (`tagma-answer`), the MCP bridge, and `tagma op`; doctrine and help texts"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
---
Done in 30b6667085: HTTP `tagma-answer: text` → `_meta.text`; `tagma op` prints text, `--json` prints the document, `json-required` is gone; the journal range counts `invocation/journaled.ts` for any door (an operator HTTP call has none: the journal looks records up by the writer's session); `list_operations` with entry signature and the `json` choice in `cli/mcpTools.ts`; the `cli → agent` module link; doctrine, help, `unblock`, and plugins-skill texts. Left: `cli/verbs/mcpServe.ts` (text mode, refusals through `refusalLines`, `isError` on negative) and the bridge system tests `mcpServe.stest.ts`, `mcpInstall.stest.ts` — lying uncommitted, waiting for `@runlith/agent/tool/refusal` from step 3; acceptance measurement 10.

Spec points 1, 9, and 11: HTTP puts text into `_meta.text` under the `tagma-answer: text` header; the bridge hands over one text content and a document under `json`, `list_operations` with entry signature; `tagma op` prints text without `--json`; the journal range at every door; doctrine, help, `unblock`, and the `plugins` skill speak one formula.
