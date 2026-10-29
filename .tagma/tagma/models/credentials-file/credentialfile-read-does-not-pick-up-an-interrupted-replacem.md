---
id: 01a123d3-684a-76a9-996a-9fc1ba67838c
title: CredentialFile.read does not pick up an interrupted replacement while the cache holds the live file's stamp
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0d4647905f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123bf-df38-77d4-bfc6-3cda183bbfe8
sources:
  - kind: file
    ref: packages/credential-file/src/CredentialFile.ts
---
`CredentialFile.read` returns the cached document when the live file's stamp is unchanged, and never looks at temp files. Another process, interrupted between fsync and rename, leaves a valid newer `.tmp` without changing the live stamp, and a running reader serves the old document until `update`, `readFresh`, a live-file edit or a new instance drops the cache. Spotted by reviewing the file's port into `@runlith/credential-file`; the behaviour came over from the old code unchanged. Done when the reader picks up such a replacement without a restart, covered by a test: a second instance leaves a `.tmp` after the first one's read, and the first one sees it.
