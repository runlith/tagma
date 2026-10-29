---
id: 01a17d2b-ffc2-717d-8c2a-e2e1d352bac7
title: A host refusal to take the candidate cancels the switch before the predecessor leaves, and the server returns a ready installation with the price of a new host and an update act with a new host
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17d09-b00b-797b-8a6e-b8daa1009819
  - kind: implements
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/arrival.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/departure.ts
---
A host refusal to take the candidate cancels the switch before the predecessor leaves, and the server returns a ready installation with the price of a new host and an update act with a new host. First reproduce 2026-10-27: tagma:try on a build whose host will refuse the candidate, update onto it — the switch happens without host preparation; find why the predecessor's `SuccessionSteps.prepare` did not refuse. Then: a preparation refusal does not switch; the machine state carries a "new host needed" flag and the price (executions with a view — the running program, an empty shell by the pty foreground process, an agent command by name, project, holder); a restart act with a new host; the same state for a server that rose at a foreign host that does not take it, with host-restart and return-to-past-installation acts. The state contract for the window and desktop is a note under the spec.
