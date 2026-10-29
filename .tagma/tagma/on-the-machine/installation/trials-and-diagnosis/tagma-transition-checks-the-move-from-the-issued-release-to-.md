---
id: 01a13d38-e6b4-70e0-9a02-f32136475170
title: tagma:transition checks the move from the issued release to the tree with a trial run and the new release's real SurfaceLoader beside the predecessor server
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13c9b-dc32-7bc0-b0f3-020661930775
  - kind: relates
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/transition.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/transition.ts
---
An issued release is frozen with people and decides its own way, so the move from it to the tree is checked with its real code beside the new release's real window.

- **The tree is installed as a release** with a number past the issued one — Developer ID signature as in cut, no clean tree, no published reading and no notarization — into a temporary directory; the operator's release directory is never written. The issued release — archive and `release.json` beside it (by default the standing cut's archive for this machine's target): the record gives the number and stores for irreversibility.
- **The new release's window** — the real `SurfaceLoader` with a window that only records (`desktop/scripts/transition.ts open`); Electron never starts.
- **Worlds:** cut trial run (predecessor button, [[ab172e64]]); new app from Downloads opened beside the predecessor server — the human road that installs the new release from the DMG. The world converged when the trial-run check passes with a freshly started helper: `HelperClient` holds the session 30 s, and an earlier session's answer would never prove the new release's copy.
- **Unchecked:** the predecessor window — how its code follows the new release ([[55712a25]]); live Electron window, Dock and Finder, system dialogs.
