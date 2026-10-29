---
id: 01a11332-ed7d-7b3c-989a-a0f842b4525a
title: "Change record: stamping every carried line on reshaping, and ChangeRecord.reshape — a three-way merge of the delta into the working files"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a112cb-2f89-7056-bf19-2c0fd3e50475
---
Part 2 of the spec; the `reshape` contract is in the "Owners and layers" section, called by both hooks (part 1) and steps (part 3).

Done when: `PreparedPlan.whole` carries line ids; `reshape(checkout, reshaped, holder)` answers `merged` or `kept` (`conflict`, `moved`, `unreadable`), comparison by the `git merge-file` subprocess (`mergeFileAt` in `packages/git`), writing through the CAS port `LineWrites`, in the file's working form (CRLF); a `committed` write is held by nobody, `held` — the session's lines. Tests through the public contract: the delta merges into a file with others' lines and their lines stay intact; a shifted file is left alone; a CRLF file does not conflict wholesale. Before implementing, verify that a write holding no lines does not pick up a parallel shell command's command observation (`change-record/record/commands.ts`).
