---
id: 01a1b2b9-8bb6-7197-b03d-804fa1fb6920
title: Plugin classes reach the window in one union utilities sheet, replayed from the window build's record and made once every enabled plugin is up
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1b1a5-f0a8-701e-8971-9bf996ba6027
sources:
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/utilities.ts
  - kind: file
    ref: apps/tagma/server/src/views/modules/builds.ts
  - kind: file
    ref: apps/tagma/server/src/views/modules/compile.worker.ts
  - kind: file
    ref: apps/tagma/app/scripts/windowUtilities.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/UtilitiesSheet.ts
---
Tailwind orders conflicting utilities by its own order, not by sheet. A sheet of plugin-only classes appended after the window's would let a plugin's `p-2` beat the window's `px-3` on every `Button`. So the server compiles one union: the window's candidates and every published plugin's, in Tailwind's order, inside the same `utilities` layer, adopted after the window's own sheet. For any two classes it then decides as the window's own build would. Utilities read the theme's variables, so switching themes never regenerates it.

The window build records what that compile needs in `_app/host/utilities.json`: its candidates, and every stylesheet `@reference "<app.css>"; @import 'tailwindcss/utilities.css'` loads, keyed by the id and base Tailwind asks with. The server replays that record with the pure `tailwindcss` compile and reads no file of the app, so it needs no resolver and no `node_modules`. Bases are relative, so no build machine's path ships.

The sheet is keyed by the artefact's hash and the sorted plugin-only candidates, and a key whose file exists is never compiled again. It is made only after plugin-host's first pass has taken every enabled plugin up, and only while no view is still preparing. Plugins publish concurrently at start, so an earlier sheet would cover a partial set and compile at every start. The feed's `sheet` is null while no plugin brings a class the window lacks. A sheet that cannot be made leaves the previous one and records a `degraded` note: the window keeps working, unstyled where the classes are new.

The window adopts the sheet as one constructed stylesheet and replaces it when the address moves. A window that Vite's dev server serves ignores it: its own Tailwind is not the installed one the artefact describes, so it takes plugin candidates as `@source inline` from `/api/views/candidates` instead. A built surface in any build mode has its artefact and adopts.
