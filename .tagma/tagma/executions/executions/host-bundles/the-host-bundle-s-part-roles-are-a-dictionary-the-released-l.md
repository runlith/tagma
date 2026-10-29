---
id: 01a17d05-bec5-79d7-b369-2e3d99e0a462
title: "The host bundle's part roles are a dictionary the released logic reads strictly at yield: a new file carries an already known role"
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: relates
    to: 01a1288d-3b7d-700d-b90c-2ad8806ec229
sources:
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/execution-host/src/registry/departure.ts
  - kind: symbol
    ref: packages/executions/src/protocol/artifact.ts
    symbol: ArtifactRole
---
Not only the new logic reads the `bundle.next` manifest, the departing one does too: during preparation and at signal yield it checks the candidate with its own `verifyArtifact`. Its schema is the `Schema.Literals` of its build's roles, so a role it never knew rejects the whole manifest. The logic writes `bundle.next.refused` and never yields, and the new server stays hostless: no terminals, no commands and no ACP sessions start. That is how the update broke on the `terminals` role added with the terminals stream.

So a new file the host logic runs beside itself gets a role released logics already read. The role must allow several parts: `carrier`, `evidence` or `sampler`. `sampler` carries both POSIX-adapter workers — the process table and the terminals stream. `metadata` never fits: the departing logic looks for the migrations directory by that role's first part. The assembled bundle's role set is held by `bundleBoot.itest.ts`, and it must never grow a new role while released logics read roles strictly.
