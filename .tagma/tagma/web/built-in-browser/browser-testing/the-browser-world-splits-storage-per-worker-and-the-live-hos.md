---
id: 01a16cb3-e80d-78e0-a056-bbec99535c29
title: The browser world splits storage per worker, and the live host belongs to the file scope
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/testing/world.ts
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/testing/electron.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/testing/host.ts
---
Chromium and Electron close with the file's finalizers: Chromium's crashpad lives in separate processes with no profile path on the command line, so holding only the browser process never ties them to the shared world. Storage, profiles, and browser services come from the world registries, and a new host joins them for the duration of the suite; server close-and-reopen tests build their own worlds, because their lifetime is the very subject under check.
