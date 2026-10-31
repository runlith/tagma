---
id: 01a14c14-6895-75c6-80f2-47bebad9bb51
title: Bash refuses sed and perl file edits and commands that only sleep; sweeping the shared checkout or committing in another checkout asks the operator
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/preflight.ts
  - kind: file
    ref: packages/agent-tools/src/shellShapes.ts
---
**Value.** Agents in one checkout do not spoil each other's work with commands touching what belongs to others, and edit authorship stays provable.

**How.** On its own, before each `bash` command starts.

**Behaviour.**
- In-place file edits via `sed -i` or `perl -pi` refuse and name the files: file tools change them.
- A command that only sleeps refuses: ending the turn waits for input at no cost, while a condition is awaited with a background loop.
- Commands sweeping the whole shared checkout — bare `git commit` and `--amend`, `git add -A`, `git stash`, `git reset --hard`, `git checkout .`, `git restore .`, `git clean` without paths — ask the operator in the shared checkout and name the reason.
- In another registered checkout, where the session does not work, `git commit` and `git merge --continue` raise the same committing condition.

**Limits.** Only these forms are recognized. The `bash` description tells to search with `grep` and `glob`, but searching via shell does not refuse. The sleep refusal acts where the command has a background; the file-edit refusal acts where the world has file tools.
