---
id: 01a14c14-a11c-7ce8-9d84-633b841d0f08
title: Project programs and external linters judge commits on par with built-in checks
ord: 8
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/runners
  - kind: dir
    ref: apps/tagma/server/src/enforcement/programs
  - kind: file
    ref: apps/tagma/inspection/src/core/program.ts
---
**Value.** A norm built-in checks can't express, the project checks with its own code or a linter it already uses — and gets the same gate and the same rule screen.

**How.** The project's `tagma.config.ts` declares inspections by key: its own program (a `defineProgram` module), a linter (oxlint, eslint, ruff, ast-grep, semgrep), or any command with SARIF or `findings` output. The rule names the key in `enforce_rule`; `check_rules` judges by the key from the change's version.

**Behaviour.**
- The program is run by the server's runner on Tagma's Bun; `@runlith/tagma/*` comes from the server, so the project doesn't need to install the package.
- All keys of one module are judged by one process: the function is called once per key with both sides of the change.
- A program may ask for code facts — imports, declarations — which the server computes itself.
- Findings outside the reach are discarded. An incremental program can explicitly cover unchanged paths in its affected frontier, comparing them against the same base paths without replacing unrelated debt.
- A linter qualifies from the minimal version with the API or output format the driver needs; a newer version alone doesn't hinder judgement.
- An inspection failure makes the `check_rules` report incomplete: the successful checks' findings stay beside the cause, but a clean result is not declared. On a program error or an unavailable command, the refusal names the checkout environment and the declared argv, if any; gate and measurement refusal carries the exit through preparation of the existing checkout and `worktrees.setupRun` for future worktrees. The setup command stays the project's own command: one lockfile doesn't define its environment, system tools, and code generation.
- Each side of a commit is judged by the description from its own version, so a config edit is also a change the gate judges.

**Limits.**
- The post-landing remeasure judges changed paths: it retires vanished debt and updates escapes by the answer's coverage. A program code change without a change to the key's description doesn't mean re-judging all unchanged sources.
- A program judges with the judged tree's code but resolves imports against the checkout's files: its code file, which a neighbour deleted or renamed without committing, fails the judgement ([[261204b5]]).
