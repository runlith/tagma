---
id: 01a0e02e-ee59-7605-8a17-e13b9fc72c8f
title: Turn the Anthropic thinking summary on by default and carry the switch into spawned and forked children
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e02f-2e1e-7043-81e0-cd672fa3817f",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/preference.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
  - kind: file
    ref: packages/llm/src/models/anthropic.ts
---
The Anthropic "Thinking summary" switch reads as lost on most threads and is off by default. The operator wants it on by default and wants a choice to persist across server restarts and browsers.

**Measured on 2026-09-27, read-only from `~/.tagma/tagma.sqlite`:**
- The owner default is stored and survives: `thread_owner_settings.default_switches = {"reasoningDisplay":"summarized"}`.
- Root threads are born with it: `birthSelection` in `AccountDefaults.ts` keeps the remembered switch.
- **Every spawned child is born `{}`.** For example, child `01a0dfb8-dbbb-7713-8ebb-a76402a77bf6` of the summarized Anthropic parent `01a0d3dc-fb48-771a-8da2-f41be7bb5806` got `{}`. Child `01a0e01e-a2b4-7255-962f-90af3664b6e5` had `{}` until the operator toggled it at 23:58:14Z.
- Cause in `packages/agent/src/collaboration/ThreadSpawnTree.ts`: `insertChild` writes provider, model and reasoning, but no switches; the fork path writes `switches: {}`.
- `REASONING_DISPLAY_SWITCH` in `packages/llm/src/models/anthropic.ts` declares `default: null`. The resolver (`resolve.ts` `chosenSwitches`) then sends no `display`, so no thinking text is returned, and the panel shows off.

**Target:**
- The declared default is `summarized`.
- A child is born with its parent's switches kept for its own row, the way a model move keeps them (`keptSwitches`). Where the parent carries no value for a remembered switch, the owner's remembered value for the child's provider applies, so an operator's "off" persists too. Choose the mechanism at the owner; the kernel must not read Tagma's storage directly.
- The fork birth follows the same rule.

**Consequence to report, not avoid:** Anthropic keys its cache on the thinking parameters (claim [[10e77d5b]]). Every existing thread stored `{}` changes its request once, on its next turn, and rewrites its conversation cache once.

**Acceptance:**
- A new root and a new child are born on; an explicit `omitted` stays off for new births.
- The anthropic profile test's default row states the new contract.
- Claims [[c95c64cb]], [[1c5af329]], [[7f55a1be]], [[9c162f56]] and [[4a65287f]] are reconciled.
