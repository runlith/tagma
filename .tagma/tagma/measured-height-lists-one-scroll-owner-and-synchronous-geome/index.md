---
id: 01a1845d-33f4-7e77-8a62-df878b7128c3
title: "Measured-height lists: one scroll owner and synchronous geometry"
ord: 1217
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/VirtualList.ts"
      },
      {
        "at": "src/FollowingViewport.svelte.ts"
      },
      {
        "at": "src/scrollFollow.ts"
      }
    ],
    "id": "@runlith/virtual-list",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/virtual-list
  - kind: file
    ref: patches/@tanstack%2Fvirtual-core@3.19.8.hunks.json
  - kind: file
    ref: patches/@tanstack%2Fvirtual-core@3.19.8.patch
---
Lists of measured-height rows share one binding of the scroll owner so a resize and its geometry reach the same paint. The kit owns measurement, mounting, placement and tail-following mechanics; each surface keeps its selection, navigation and following policy.