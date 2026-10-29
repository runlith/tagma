---
id: 01a1523c-ef55-7d47-bf4f-3e2a20ce33a9
title: Setting variants from runtime-source are read when the catalog is issued
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/settings.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/settings/resolution.ts
---
The owner module declares `settingControls` next to the keys, and composition binds each source to the server-build context. The catalog calls the source on read, so registering or removing a mode after boot changes the offered variants with no key declaration change. Settings knows no subject registry and derives no variants itself; static `control` stays the shape for keys with no runtime-source.
