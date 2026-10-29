---
id: 01a16b62-7941-74ad-a1ce-96febd4e3665
title: "Build “Restart agent”: thread-kernel operation, transport release, resume, thread menu item"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b5d-c732-716a-88f9-e64d40da7f5d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b62-65bd-7e64-b65a-b72f418bc57e
---
Implements [[418bc57e]] in full: thread-kernel operation, process replacement via `TransportResource.release`, turn resume, menu item and feed record, end-to-end tests from the “Done when” section. The process-replacement mechanism is shared with [[8da1f8be]].
