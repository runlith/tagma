---
id: 01a196a1-4095-7aae-8890-907257f4d0e0
title: Merge submit judges an allowance with its numeric lines field missing
ord: 190
tags: ["reflection"]
fields:
  {
    "actual": "The call refused inspection-failed for all 24 rules because inspections.names lacks checks.F4.allowances[2].lines, although both the working file and resolved index contain lines: 817.",
    "command": "submit_work({subject:\"chore: reconcile main with projection source work\",tasks:[],paths:[\"bun.lock\",\"apps/tagma/server/src/external-harnesses/protocol/journal.ts\",\"checks/builtins.ts\"]})",
    "expected": "Judge and conclude the resolved open merge with its index and selected lockfile update, preserving the complete F4 allowance from the merged config."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

At ~/.tagma-dev/worktrees/tagma/cpu-event-projection, HEAD 3a13af8caaa1437071f9c73feee2e8f5c5d109b3 merges e7bac5e5187c3d4a9ace33f14e8f10d86cb5030e. The resolved checks/builtins.ts is byte-identical to MERGE_HEAD at the reviewed allowance and changes 814 to 817 against HEAD. The selected landing reported config-invalid at checks/builtins.ts:34, path [checks][F4][allowances][2][lines], Missing key. No unmerged index entries remain. The built-tree line slicing is a suspected cause, not yet proved.