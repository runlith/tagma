---
id: 01a14623-c52e-745c-8e3b-adaff297c9ac
title: A bash call title without description is the command's short head, not the whole line
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14621-8a37-726f-88a4-862ae99bc434",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a145f0-745c-7611-ab38-7506d4b6b56b
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/answers.ts
---
A `bash` call without `description` shows the whole command line as its feed title: a long chain `npx prettier … && npx jest … ; npx tsc … | head -20` takes six lines of large text, while facts (`wait`, time) slide below it.

To do: at the title owner — `commandLabel` in `packages/agent-tools/src/bash/answers.ts` — give a short command head without a description: the line's first simple command (leading `cd`/`pushd`/`popd` skipped, assignments and redirects dropped), within the character budget in whole words, with `…` when something is omitted. The full command stays in the expanded step's monospace block, as with described calls. The same label is carried by the command record (executions) and standing-command chips.

Done when: such a line's title is no longer than a description (about 60 characters) and takes one feed line at normal feed width in every call state; in a narrow panel it wraps like a description (waiting, live, backgrounded, finished, unknown); described calls unchanged; `bun run typecheck` and bash tests pass; review under the model rule; commit.
