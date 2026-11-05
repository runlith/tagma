---
id: 01a1a2be-30cc-71e5-909b-4a0eefa0036d
title: The final stapled disk image of a notarized cut is recorded with its digest and size and verified before reuse and publication
ord: 87
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2bb-33ee-76fa-bb2d-1d7445b0686d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1a21e-4549-7e66-ad45-d4a4f405abcc
  - kind: relates
    to: 01a16915-34b6-7bf8-9a01-c8c56bc98bc4
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-release/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/cut/stage.ts
---
`ReleaseRecord.images` named files only and `cutStanding` checked existence, so a modified DMG in a notarized cut was published. The sealed record carries `imageDigests` (sha256, size per platform); `notarize` and `publish` verify them before reusing a notarized cut. A notarized cut recorded before the field existed is sealed in place — staple and Gatekeeper on the image — then recorded, never trusted unproven.