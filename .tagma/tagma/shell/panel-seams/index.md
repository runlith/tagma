---
id: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
title: Panel seams
ord: 39
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/Seam.svelte.ts",
        "for": [
          "78f56704",
          "1edee1c2",
          "8f8b93e1",
          "a8449383",
          "4f0a6d9b",
          "57643bc7",
          "96400e93"
        ]
      },
      {
        "at": "src/SeamHandle.svelte",
        "for": [
          "78f56704",
          "1edee1c2",
          "8f8b93e1",
          "a8449383",
          "4f0a6d9b",
          "96400e93",
          "3724cd7a"
        ]
      }
    ],
    "id": "@runlith/seam",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/seam
---
Surfaces join panels side by side, and the reader drags the boundary between two, giving one more room. The package owns that boundary: the size at which one panel is held along the axis, and the handle that changes it. It knows nothing of what the panels hold and stores no sizes: the width the reader leaves arrives in geometry and returns through report — so the host decides where it lives. The boundary between two panels sharing a container (a terminal split) is the same seam: the host holds the first panel's share, the seam keeps both minima and reports the share on every gesture frame and on release, while Escape or window loss return it to the start.
