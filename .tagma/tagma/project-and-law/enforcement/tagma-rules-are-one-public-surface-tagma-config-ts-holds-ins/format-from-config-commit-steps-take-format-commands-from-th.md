---
id: 01a156ee-85b8-7fb5-ad25-ad070b391840
title: "Format from `Config`: commit steps take `format` commands from the commit version's `tagma.config.ts`; `declaration.ts`/`jsonc.ts` go away"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15755-7e78-7401-8611-f42b2c6f9a10",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
sources:
  - kind: file
    ref: apps/tagma/server/src/commit-steps/shape.ts
  - kind: file
    ref: apps/tagma/server/src/config/operations/read.ts
---
The "Format" section [[b6f7a4e0]]: the `commit-steps` module takes the `format` commands from the commit version's `tagma.config.ts` (write order, `ok`, `reads`, `on: 'commit'`); the `tagma.jsonc` reading goes away; the Format line in settings reads `read_config`. This also builds the `config` module's `read_config` operation in place of `read_commit_steps`: it answers the HEAD config's inspection keys (which function, which concern) and format commands; rules are named by key via `read_inspections`. Depends on [[45445f10]].

Proof: the current commit-steps tests pass with the declaration in `tagma.config.ts`; a command with `ok: [0, 1]` that exits 1 does not fail the commit.

## Outcome (3028f73be0)

`CommitShape` takes commands from the commit tree's `Configs.read`; `declaration.ts`, `jsonc.ts`, `fact.ts`, `head.ts` and `read_commit_steps` are gone. The `config` module's `read_config` answers the HEAD config's keys (what judges, which concern) and format commands, `null` with no config or commit, and the `config-invalid` refusal. The settings' Format section reads it. The `config` prompt fact is whether HEAD carries `tagma.config.ts`. `Config` carries a `footprint` (loaded paths and resolver misses); a prepared tree remembers it as its `declaration`, and relaying onto a shifted HEAD rebuilds the commit if the shift touched any of these paths, not just the config itself. `SHAPE_REFUSALS` gained `config-invalid` and `config-unstored`.

Checked: steps, stepsShaping (including red→green on an imported file), stepDebt, submitGit — 38+5 pass; commitSteps.stest on a live host, including `read_config` (keys and commands, `null`, `config-invalid`) — 3 pass; reading, stepsFact, submitHoldings, composeAgent — pass; app typecheck clean, server with no errors in its own files.

Not proven: `place.stest.ts` fails before the commit steps on `enforce_rule` with the old `inspection` shape — that is the unfinished migration [[90e3a1c9]]. Reading `read_config` of a thread from another project (by thread home actor) is not covered by a test.
