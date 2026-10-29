---
id: 01a12913-4b82-7215-b396-18c28d9d2adc
title: write creates a file under missing directories in one call
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12840-2701-7b14-bcea-6562c66293ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a128e1-a0e9-7e15-b0b0-914592f818fd
sources:
  - kind: file
    ref: packages/agent-tools/src/workspace/runtime.ts
---
Fix new-file resource binding resolution: preparation and admission must yield one physical address even when several parent directories are missing. Start with packages/agent-tools/src/workspace/runtime.ts; keep the binding-change and symlink checks. Prove directory and file creation in one call through the public write, land the change, and answer the original reflection.
