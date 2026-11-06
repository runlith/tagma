---
id: 01a0ca95-302a-761c-b835-d02e2f69b0c4
title: Desktop window
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/bridge.ts"
      },
      {
        "at": "src/kept.ts"
      }
    ],
    "id": "@tagma/desktop",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-8018-7e8b-b5d6-367efdc8aed8
  - kind: imports
    to: 01a0c837-97b4-73fc-bc40-b92b59160e8b
  - kind: imports
    to: 01a0c83c-e15d-738b-bdd7-5263883b9c98
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf0b-75ac-870f-109964d4c5ab
  - kind: imports
    to: 01a0fd8b-bf0c-778a-8cab-a767627a3d25
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a10bb4-14bf-76ff-8ee5-b6b93a3d1025
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a132c7-c70e-71c2-9a65-20a479a88a92
  - kind: imports
    to: 01a13b1a-1851-79b3-ba84-3b0e9f581885
  - kind: imports
    to: 01a14828-1f15-7e60-8663-f3c1496f9eb4
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a1488c-954c-76bc-bfcd-42d64103030b
  - kind: imports
    to: 01a1a83d-f5be-74d5-8aa8-06b53d10c144
  - kind: imports
    to: 01a1a95d-e159-7393-b1ce-ac0137f92c13
sources:
  - kind: dir
    ref: apps/tagma/desktop
---
Tagma as an app, not a browser tab: Electron windows with their own bundle identity, a place in the dock, and the global shortcuts the person allowed (by default one hides and shows Tagma), standing over the surface served by the Tagma server; each window holds its own project at its own address. It keeps itself and the server on the chosen release: it installs the release carrying its app, becomes the app of the chosen release, and asks the server to restart on it; it opens only its own data directory's server and starts it itself when the address is silent. “Quit” stops Tagma when nothing is running, “Stop Tagma” always; where there is no surface the window shows a waiting page in the person's words with an action. A window aimed at someone else's address starts nothing. What the surface does is the surface's business; the `bridge.ts` bridge gives it the operating system, the keys and global dictation. The window publishes its key table (the chords it binds, those a press may cancel for the menu, frames' chords and the global set); main registers the globals with Electron through the host kit and answers for each — held, taken by another app, or needing Accessibility —, keeps the last set while no window is open and opens a window for a global pressed then, cancels a published chord the application menu also holds so the page's action runs first, and lists the chords it keeps for itself (`kept.ts`), which no binding may take. For dictation main holds the key via `@runlith/desktop-input`, shows the pill — the `/_desktop/dictation` page of the same surface — and inserts its result into the active app, while sound and recognition stay with the surface and the server. The same bridge opens plugin view windows: each is a separate `BrowserWindow` over the same surface's `/_desktop/view/…` route, and main accepts only that surface's addresses from the renderer.
