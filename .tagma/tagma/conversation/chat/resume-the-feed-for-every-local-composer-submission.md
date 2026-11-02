---
id: 01a199c8-d5fe-724f-9428-9201cc18d4be
title: Resume the feed for every local composer submission
ord: 88
tags: ["task"]
fields:
  {
    "holder": "tagma:01a199b8-caec-7f6a-a38a-b65e0254b7db",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
---
Move submission intent to the holder's turn commands so keyboard, button, queued and dictated sends all return the mounted feed to its tail at press time. Keep the scroll policy in the viewport and leave delivery retries and other holders' activity out of that intent; prove the paused-reader failures red before the fix and verify tail growth, current-message navigation and later manual scrolling after it.