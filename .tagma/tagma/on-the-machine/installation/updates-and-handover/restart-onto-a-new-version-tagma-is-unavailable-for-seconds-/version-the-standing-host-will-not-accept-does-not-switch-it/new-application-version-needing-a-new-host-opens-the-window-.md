---
id: 01a17d2b-ffc2-717d-8c2a-e2e364da4231
title: New application version needing a new host opens the window on the working release and hands the question to the card instead of a system dialog
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d4e-da4c-712f-998f-12c467da481e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
  - kind: waits-on
    to: 01a17d2b-ffc2-717d-8c2a-e2e1d352bac7
sources:
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
---
The `install-from` branch carrying the host question does not call `dialog.showMessageBox` (`apps/tagma/desktop/src/main.ts`); it opens the window on the working release, and the question stands as the window's card. The refusal lasts until the application next opens. Works starting with the release that carries it.
