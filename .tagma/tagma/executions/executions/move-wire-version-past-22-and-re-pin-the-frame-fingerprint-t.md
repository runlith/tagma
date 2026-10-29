---
id: 01a0c73e-16d1-75a3-9cb3-2bf52cfa4423
title: "Move WIRE_VERSION past 22 and re-pin the frame fingerprint: the two frames' shape changed without the number"
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/executions/src/protocol/wire.test.ts
---
On a clean HEAD, `packages/executions/src/protocol/wire.test.ts` — "wire version > names exactly the shape of the two frames, and moves when they move" — is red: the pinned `sha256:be930c9f…` no longer matches the schema document, which now folds to `sha256:1ca9aba3…`. The package's working tree is empty, so the red is committed on the branch. The last commit touching `src/protocol/` is `6b963103a9` ("tagma: control native invocations independently of run waits", 2026-09-21); read its diff for the field that moved. The fingerprint is computed from the runtime schema, so a comment strip cannot cause or fix it.

Fix at the owner: bump `WIRE_VERSION` to 23 and pin the new digest under it in one change, as the test's own message asks; confirm no peer of version 22 is expected to keep speaking to this host. Done when the suite is green and the mechanism claim this task was discovered from still holds as written.