---
id: 01a0f4ab-e324-7c2e-a871-b820ef457ade
title: The rules agent's prompt learns runner descriptors, adapter capabilities, placement at birth and the semantic delta
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0f476-051e-7c46-aa9a-b63cf697d121
  - kind: waits-on
    to: 01a0f4ab-e31e-7d8d-8fe3-ebc6be843c7e
---
Teach the builtin `rules` agent the method the new capabilities need ([[f697d121]] §4.4): runner descriptors and one run per identity; reading adapters' capabilities from `read_inspections`; placement by category at birth; the semantic delta for a conversion that removes restrictions; saying plainly when Tagma cannot read a project's language, with the interim checker offered. The prompt stays free of catalogs ([[14725e18]]).

**Class:** simple — `claude-sonnet-5-5` high.

**File scope:** `apps/tagma/server/src/native-harness/agents/rules/identity.ts`.

**Acceptance:** [[f697d121]] §7's live runs in a NestJS and a Python fixture; `read_agent rules` composes the prompt naming no operation outside its capabilities.

**Waits on:** the oxlint adapter task.

**Reviewers:** one Muse lens (prompt names only what exists, rule d82432e6).

## Delivered and open

Commit `2ee370eefb` teaches: a runner descriptor in `runners.json` with norms bound as `{ runner, id }` in `enforce_rule`'s `bindings`, one process per descriptor; measuring a runner check by running its tool over the reach (`check_rules` takes builtins and programs only); law placed by category at birth; the unread-language answer with an interim checker; the semantic delta of a loosening. Claim [[14725e18]] revised and verified.

Open: `read_inspections` does not yet answer runner adapters or their capabilities, so the prompt cannot teach reading them (rule d82432e6); the §7 live NestJS and Python runs need the server restarted onto a build carrying this prompt and `bindings` — the operator's act.
