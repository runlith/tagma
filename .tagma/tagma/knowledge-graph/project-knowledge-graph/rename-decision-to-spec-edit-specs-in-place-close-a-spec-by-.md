---
id: 01a0f8de-85df-798e-8321-167d6904026c
title: "Rename #decision to #spec, edit specs in place, close a spec by its last finish, and remove the divergence mechanism"
ord: 216
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f8d6-6ff2-7d6b-8bde-0eda29d5653e",
    "status": "done"
  }
---
The operator's order: a spec is a document edited in place, with no bureaucracy around its changes, and a built spec is closed and forgotten.

- The code-project tag `decision` becomes `spec` everywhere: its declaration, the role (`spec`), the contract (`core/spec`), operation texts, agent prompts, the catalog and the UI. Existing nodes of every project on the catalog move to `#spec` by one migration at graph open, keeping edges and history.
- The `#spec` prompt is rewritten short: accepted future behaviour, edited in place when it changes, closed when the work is done (with the claims written from the code, where there are any) and no longer read as current knowledge.
- The divergence mechanism goes whole: `file_delta` and its batch op, delta nodes (deleted by the same migration), the `delta-undecided` finding, the `spec-unverified`/`spec-diverged` gates, `specOk`, and the unresolved-descendant gate on verifying and closing a spec.
- Closing: finishing the last open work of a spec closes it in the same act; `close_block` on a spec needs nothing beyond its own open-children gate. `close-due` stays as the reminder.

Where: `apps/tagma/server/src/catalogs`, `graph/work/tasks`, `graph/measure/checks`, `graph/contract/wire`, `graph/tree/migrations`, `graph/serving/open.ts`, doctrine and app tag presentation.

Done when: tsc is clean for the server and the app, contract tests prove a spec edited in place and closed by its last task's finish, and the migration's rename and delta deletion, claims are written from the code, and one Sol review's findings are fixed.
