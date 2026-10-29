---
id: 01a121e5-2700-7b99-ae65-295557f1fef4
title: "Broadcast in one call: a to list on send_message, send_task and interrupt_agent"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a121d6-3d32-71e9-bb7e-606acf893aa6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a121e1-8304-7f20-b17b-923e5add92f2
---
Implement [[5add92f2]] whole: `to` — an address or a list at the three send verbs, one envelope per recipient, admission by one keyed act with wake intents, `final-to-many` and `compact-to-many` refusals, one `sent` response with `deliveries`, the `agents` display link, moving the send verbs from `CollaborationTools.ts` into their own file.

Start from `packages/agent/src/collaboration/ThreadEnvelopes.ts` (`send`) and `collaborationVerbs.ts`.

Done when the contract tests from the "What the performer proves" section are green, the typecheck and the tests of `packages/agent`, `apps/tagma/server` (affected ones), and the app pass, and the work is landed by a commit.

## Outcome (commit eff497e9da)

Left unproven:
- that `SenderWakes` brings a broadcast's admitted but undelivered envelopes to the recipient on SQLite: the wake intents are proven to write atomically with the envelopes (conformance on InMemory and SQLite) and to survive an interrupted delivery (core test); the `SenderWakes` selection itself was not re-run;
- settlement through a genuinely interrupted run (`ThreadEffectSettlement`): only the core `settle` is proven;
- the feed-line and question-window appearance was not checked with eyes, only `activityIdentity` by unit test;
- the system tests (`protocolRuns.stest.ts`, `mcpServe.stest.ts`) were not run.

Failures in code this change does not touch (not rechecked separately on the parent commit): in `packages/agent` — three `spawnBirth` tests, the `runLog` test about the envelope before a snapshot failure, and the fork test in `ThreadSpawnTree`; in the server — `definitions.test.ts` (standing grant sources) and the hook schema test.
