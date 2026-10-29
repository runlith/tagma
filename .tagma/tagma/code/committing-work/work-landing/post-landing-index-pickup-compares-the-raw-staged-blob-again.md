---
id: 01a11247-197c-795f-9120-a76ef407426c
title: "Post-landing index pickup compares the raw staged blob against the working bytes' digest: with `core.autocrlf`, a session-staged path is not picked up"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11240-8e4d-73c7-bcd8-d90c914a9e18",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111f9-68f3-7e02-807d-7ff418e6be44
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/indexSync.ts
---
`syncIndex` (`landing/land/indexSync.ts`) decides whether to pick the user's index entry up to the landing's commit by comparing the raw staged blob's digest (`textsAt` through `actingGit`) against the session lines' `afterHash` — working-bytes digests. Where git normalizes line endings (`core.autocrlf=true`, `text`), the session's own `git add` puts an LF blob in the index, while its `afterHash` is of CRLF text: the digests mismatch, and a path the session staged itself stays staged when it should have been picked up to the commit. Visible only when the landing took part of the file (a neighbor's lines stayed): with a whole file the index blob equals the committed one anyway.

Found by reading code in [[18e6be44]], not reproduced by test. A direct port to `workingTextsAt(configuredGit, …, '')` costs one `cat-file --filters` process per path (for the index, `workingFilesAt` reads one by one); the root variant is batched working-form reads of the index in `packages/git` (`cat-file --batch --filters` with a path) or comparison in CR-less form where `normalizedAt` verdicts.

Done when, with `core.autocrlf=true`, a path staged by the session's command and partially landed matches the commit in the index after `submit_work`, with no extra git process per file.
