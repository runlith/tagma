---
id: 01a0d137-0f5c-70f2-b534-a0cf338247a0
title: "Stage 3b of program rules: a pure matcher deciding which program rule binds one process"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d137-8f4f-7055-b377-b59a6c33b0ac",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/commandRules.ts
    symbol: CommandRuleProgram
---
This is stage 3, part 2 of [[13e3cf43]]: the matcher that decides which program rule, if any, binds one process. It is a host module with no wiring and no wire change.

**Scope**
- **The inputs** are one process as the reader of [[3a6dc74e]] answers it (arguments, executable, working folder), and a thread's ordered program rules.
  - The rules have the stored shape `CommandRuleProgram { words, folder? }` from `apps/tagma/server/src/protocol/commandRules.ts`.
  - They are the project's rules first, then the thread's.
  - The folder is relative to a project root.
- **The answer** is the last rule that matches, or none. A process whose arguments or folder were not read matches nothing, and the answer says it was not read.
- **Matching is exactly the "Matching a process" section of [[13e3cf43]]:**
  - the program word against the basename of `argv[0]` or of the executable;
  - through an interpreter, from the one list named there, the script's basename without its extension, or the module after `-m`;
  - the script is the first argument that does not start with `-` and names an existing file relative to the process's folder;
  - a shell given `-c` has no script;
  - every other word must equal a later argument, in order, with gaps allowed;
  - the folder covers itself and everything below it, compared after real paths are resolved on both sides.
- **File lookups** (whether a script exists, resolving real paths) sit behind a port, so the matcher itself is pure and tests inject the answers.

**Out of scope:** the watcher, the set, enforcement, and anything outside `packages/execution-host`.

**Proof:** tests over injected processes cover every example in [[13e3cf43]]:
- `tsc` covers `node …/bin/tsc -p x`;
- `vitest` covers `node …/vitest.mjs`;
- `pytest` covers `python -m pytest`;
- `git commit` covers `git -C repo commit -m x`;
- `git add docs/commit.md`, `bun run scripts/test.ts` and `cat pytest.ini` match no rule;
- the `--require` shift is the known limit;
- the `git log --grep commit` over-reach is the known limit;
- a folder match below the rule's folder, and none beside it;
- the last matching rule decides;
- an unread field matches nothing.

The typecheck is clean.

**At finish:** write the claims from the code, and state the two known limits as limits.
