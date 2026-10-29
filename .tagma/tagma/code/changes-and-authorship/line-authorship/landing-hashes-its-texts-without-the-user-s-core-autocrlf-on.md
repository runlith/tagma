---
id: 01a111f9-68f3-7e02-807d-7ff418e6be44
title: "Landing hashes its texts without the user's `core.autocrlf`: on Windows a CRLF file commits with CRLF"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11240-8e4d-73c7-bcd8-d90c914a9e18",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111ce-3737-7517-8b69-f747435f5333
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
---
`submit_work` writes the blobs of its texts through `hash-object` under `gitEnvironment` (`platform/git/ownGit.ts`: no global or system config, `core.autocrlf=false`) — `ownBlobs` in `change-record/prepared/tree.ts`. Git for Windows sets `core.autocrlf=true` in the system config, and the user's own `git add` normalizes CRLF to LF; the Tagma landing does not, so the same file landed by Tagma reaches the repository with CRLF. `.gitattributes` (`text`, `eol`) still apply, so the defect only hits repositories without them.

Comparison against the working tree already goes through `configuredGit` ([[fbdff675]]); recording does not, and that contradicts the same note: the landing's "one result on any machine" currently differs from what the user's git would produce. Decide through which git the landing normalizes texts for the index, and fix the note in the same change.

Done when, with `core.autocrlf=true` in system or global config, a CRLF file landed by `submit_work` sits in the commit with LF, as after the user's `git add`.
