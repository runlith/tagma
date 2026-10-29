---
id: 01a0c83d-a954-7bc4-bbb4-3d4bb1e688e5
title: Remove the unused dialog id generator
ord: 24
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
sources:
  - kind: file
    ref: packages/primitives/src/dialog/id.ts
  - kind: file
    ref: packages/primitives/src/dialog/index.ts
---
`src/dialog/dialog-id.ts` exports `createDialogId` and nothing imports it: the file is named neither in `src/dialog/index.ts` nor in the exports map, and a repository-wide search for the name finds only its own definition (measured 2026-09-22). The transports that need an id mint their own — `Dialogs` and `Snackbars` each keep a sequence and a private `createId` — so this is a leftover rather than a door somebody may still walk through. Delete the file, and confirm the package's typecheck and suite stay green.