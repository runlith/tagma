---
id: 01a184f6-8a86-752e-ad11-1193ae1fbfd1
title: Desktop geolocation grants follow the leased webContents and its current origin
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
---
A geolocation override needs a permission without opening a native permission prompt. Both Electron permission handlers therefore consult the same scoped webContents grant and require the request's origin to match the current top-level page; navigation follows the grant without admitting a cross-origin frame or another page of the profile. The last lease's release, a page close, or a channel break returns the page to the host's default denial.