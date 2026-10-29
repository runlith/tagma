---
id: 01a14c14-a11c-7ce8-9d84-6337de2c63cd
title: "The agent and the operator learn in advance what the rules will find: in the change, in the index, or across the branch"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/check.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/cli/check.ts
    symbol: check
---
**Value.** The violation is found before landing, not refused at its end; a new inspection can be tried on code before it becomes law.

**How.** The `check_rules` operation (for the agent — together with the shell); CLI `tagma check` — index judgement with an exit code of "clean", "refused", or "not judged", `tagma check --all` — the whole branch on HEAD.

**Behaviour.**
- Over a session's change, the same tree `submit_work` would lay is built, and the answer says whether it would refuse; the change can be narrowed by paths or taken together with another session's lines.
- Over HEAD — all reach violations, debt marked.
- Over the index — exactly the judgement `git commit` will meet.
- An unsaved inspection is run over the future rule's reach as `enforce_rule` would measure it.
- Program or linter time includes setup and the run itself, even one ending in failure; keys of one checker share the run and each shows its full time. Merge judgement adds run times against the parents.
- Nothing is recorded: neither refusals nor debt.

**Limits.** Continuing the page re-runs the judgement and refuses if HEAD or the change moved. `tagma check` judges through the running server: without its answer it reports that nothing was judged.
