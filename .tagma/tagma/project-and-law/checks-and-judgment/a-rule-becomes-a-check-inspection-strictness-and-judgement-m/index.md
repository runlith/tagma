---
id: 01a14c14-a11c-7ce8-9d84-6334c46b6b5f
title: "A rule becomes a check: inspection, strictness, and judgement moment, with standing violations as debt behind tasks"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6337de2c63cd
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63387548cc1d
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633a4a0384a4
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633b841d0f08
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/operationChecks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/wire/operationCatalog.ts
    symbol: ENFORCEMENT_OPERATIONS
---
**Value.** A measurable norm stops depending on agents' memory: Tagma finds its violations itself, and already standing violations don't block work while a task that will remove them stands behind them.

**How.** The `enforce_rule` operation over a rule — inspection, strictness `note`, `watch`, or `gate`, triggers (operation and phase before or after), debt owners.

**Behaviour.**
- `checkout` selects a registered root; without it, the explicitly addressed cwd or branch applies, otherwise the only checkout with the session's lines in the rule's project, and with no such lines — the main one. Multiple checkouts require an explicit choice. The HEAD measurement, the uncommitted-violation lookup for absorb, and the graph-copy write belong to that tree; a worktree's debt arrives with its graph on merge. The confirmation shows the debt, the absorbed, the retired, and the measurement time.
- The first check makes every found violation debt with an owner — a standing task or spec. A violation without an owner is recorded as an escape; if debt grows or stays ownerless, in review mode the operator is asked.
- `note` only delivers the rule text, `watch` names violations, `gate` refuses the landing.
- Triggers: before or after `submit_work` and `merge_worktree` (a pre-`submit_work` trigger also judges `git commit` and `commit_checkout`); after `edit` or `write` — over the written file, with a message to the holder; before or after an operation that changes nothing.
- Inspection lists are edited by record patches without rewriting the document; a record built on a stale document revision refuses.
- `off` removes the check; the journal keeps the removed document.

**Limits.** A built-in inspection comes only from the pack the project uses on HEAD. A switched-off or replaced rule can't be checked. Without triggers, a rule judges only `check_rules`. The `@runlith/tagma` package, from which `tagma.config.ts` imports check functions, is unpublished: Tagma executes the config itself, but the user's editor finds neither types nor hints.
