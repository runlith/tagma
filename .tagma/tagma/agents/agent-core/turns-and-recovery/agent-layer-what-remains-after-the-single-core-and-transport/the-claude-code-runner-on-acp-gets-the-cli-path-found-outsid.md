---
id: 01a151df-e920-73d7-9b09-09d135d5a24c
title: The Claude Code runner on ACP gets the CLI path found outside PATH
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/installed.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/programs.ts
---
After renaming the harness to `claude-code`, the runner launch lost the resolved CLI path. `vendors/claude-code/acp.ts` starts `tagma harness-run claude-code`, `sessions/programs.ts` passes `claude-code` to `InstalledHarnesses.program`, but that looks the adapter up by `binary` (`birth/installed.ts:294–299`); for Claude Code that is `claude`. Answer — `null`: neither `TAGMA_HARNESS_PROGRAM` nor the runtime pair is set, and the runner searches `claude` on its own over the process PATH (`runner/claude-code/run.ts:45`). A CLI found only in the adapter directory (`~/.claude/local`) or under a non-default nvm version shows as installed in the menu but does not start a flow on ACP. The twin in `sessions/programs.test.ts` keys the program by harness name and hides the divergence.

Do: the runner's argument resolves to a program by harness id at one owner, `InstalledHarnesses`; launching by a bare program name stays a `binary` search.

Done (b386c9cd73): `InstalledHarnesses.program(name, by)` finds the adapter by `binary` or by harness id; `harnessTerminals` resolves the `harness-run` argument by id. Not proven: a live ACP-flow launch on a machine where `claude` exists only in `~/.claude/local` (verified by an integration test on a temporary HOME).

Proof: a test through a real `InstalledHarnesses` on a temporary HOME where `claude` lies only in `~/.claude/local` and PATH is system: `harness-run claude-code` starts with `TAGMA_HARNESS_PROGRAM` equal to the found path. The twin keyed `claude-code` is removed.
