---
id: 01a1a310-baa2-7e00-a60a-dc354bbccb3e
title: The macOS application bundle layout stands behind the Applications adapter instead of the core wire
ord: 97
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a30d-3192-78c8-a90e-14527d736b6e",
    "status": "in_work"
  }
---
`installation/contract/wire/layout.ts` declares the macOS bundle shape — `<name>.app`, `Contents/MacOS/Electron`, `Contents/Resources/release` — and `releaseApplication` in `contract/wire/manifest.ts` builds on it, so the platform-neutral core spells one platform's layout. The variance moves behind the platform adapter (`mac-applications`, filling the `Applications` port); the core keeps only platform-neutral layout. Facts frozen between issued windows and servers keep their values and stay declared where both sides reach them, outside the core wire.