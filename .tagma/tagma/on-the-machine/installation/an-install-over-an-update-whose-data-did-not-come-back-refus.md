---
id: 01a1a25c-6f77-77c4-ac38-0269b6a557af
title: An install over an update whose data did not come back refuses, keeping its copies and the release that reads them
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13283-fc95-76c8-a601-3f5eac2d9a04
---
`liveAttempt` ignored an attempt that ended `unrestored`, so `install-from` of a newer release replaced its record, pruned the `from` release, and the newer release's first start deleted the only copies of the data from before the failed update. Such an attempt still stands on `current`: an install refuses `attempt-open` and every prune keeps both its sides.