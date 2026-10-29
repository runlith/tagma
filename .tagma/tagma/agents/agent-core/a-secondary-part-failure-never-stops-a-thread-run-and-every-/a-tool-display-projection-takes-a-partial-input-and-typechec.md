---
id: 01a15554-aa93-7a22-884f-a7056288b691
title: A tool display projection takes a partial input, and typecheck catches reads of a field that may be missing mid-stream
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15555-1870-7ae3-8887-a2bf3ec48157",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
---
Part 5 of the spec. In `ToolDeclaration` (`packages/agent/src/agent/tool.ts`) both `display` shapes take a partial-schema input; the cast in `toolPartialDisplay` and `toolDisplay` leaves. Each of 59 `display` declarations (34 files) is fixed where typecheck shows a missing-field read: header and body build from what arrived. Proof — `bun run typecheck` of the whole monorepo green and existing preview tests passing.
