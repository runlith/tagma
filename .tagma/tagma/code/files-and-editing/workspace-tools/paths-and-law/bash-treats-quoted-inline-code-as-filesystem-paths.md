---
id: 01a12d23-d6f3-73ec-a4a9-2095d21aa825
title: bash treats quoted inline code as filesystem paths
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The command succeeds but bash appends a filesystem attribution failure: Unknown: FileSystem.stat (/opt/workspaces/runlith/const data = JSON.parse(await Bun.stdin.text()); ...). The preceding unfiltered JSON read also attempted to stat a large fragment of the spec prose.",
    "command": "bash(command=\"tagma op read_block --json '{\\\"blockIds\\\":[\\\"52b10a62\\\"]}' | bun -e 'const data = JSON.parse(await Bun.stdin.text()); const blocks = Object.values(data).find(Array.isArray); const body = blocks?.[0]?.body ?? \\\"\\\"; const start = body.indexOf(\\\"## Adapter contract\\\"); const end = body.indexOf(\\\"### Registry\\\", start); console.log(body.slice(start, end));'\", description=\"Read adapter host module contract excerpt\")",
    "expected": "Return the successful read-only command output without treating inline JavaScript or JSON output as file paths."
  }
---
Filed from project `runlith`.