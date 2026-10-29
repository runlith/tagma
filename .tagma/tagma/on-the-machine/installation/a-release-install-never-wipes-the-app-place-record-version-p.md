---
id: 01a13c45-8f0e-74ab-b668-319d448882f2
title: "\"A release install never wipes the app-place record: version prune removes versions only\""
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c3f-40ca-7964-82f9-9a9fb8a393fd",
    "status": "done"
  }
---
Public Tagma 0.1.0: after the first DMG install the call refuses `capture-refused` "the installation declares no desktop audio helper".

Cause: `install-from` (`release-channel/install.ts`) calls `pruneVersions(installRoot, …)` after `swapCurrent`, and that deletes everything in the installation root except `current` and the keep list — including the `application` file where the window recorded where `Tagma.app` stands. The app is not copied from `/Applications` into the version's `desktop/` (`placeApplication` answers `stable`), so after prune `windowOf` answers `undefined`, and `composition/speech.ts` assembles `AudioDevices.none` for the server's whole life. The same loss breaks the window's move onto the new release (`successorOf`) and the rollback (`kept`). Reproduced on the 0.1.0 archive in a temp HOME: the record is there before `install-from` and gone after.

Do: `pruneVersions` deletes versions only — directories `versionsNewestFirst` calls versions; files next to them (the place record, `release.log`, the shelf's `order`) are left alone, and keep lists stop naming them. Proof is `versions.itest.ts`: a file next to versions survives prune.

The operator's step: a fresh cut, so the fix reaches users. For those already installed: close the window, reopen it (the window rewrites the place), and restart the server (`tagma restart`).
