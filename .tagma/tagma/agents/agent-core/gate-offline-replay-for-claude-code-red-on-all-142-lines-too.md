---
id: 01a10226-6482-7662-97dd-08f542ddeb5d
title: "Gate offline-replay for Claude Code red on all 142 lines: tool schemas carry the door's `background` field, missing from native records"
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a101ad-7536-73f6-b50c-adb7fadd5ece",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/tool.ts
---
Before the fix, `bun src/composition/testing/captureGate.ts gate` (from `apps/tagma/server`) on 2026-10-03 yielded 0/142 matching lines. The only divergence in every line was `call N.body.tools[i].input_schema.properties.background` (`{"type":"boolean","description":"Answer at once; the outcome arrives later as a notice."}`) and the `bodyText` derived from it. Messages, images, cache marks, headers, and compaction and fault scenarios matched.

Cause — incomparable rig inputs: Claude Code was attached to a test MCP server whose `src/mcpCatalog.ts` declared 126 schemas without `background`; product replay passed that catalog through `Tool.make`, which adds the field. By agreement with the operator the field was added to the fixture catalog. The core, the production presentation, and the comparator did not change.
