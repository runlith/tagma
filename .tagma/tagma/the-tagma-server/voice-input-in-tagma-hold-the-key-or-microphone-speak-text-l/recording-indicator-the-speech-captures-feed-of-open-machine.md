---
id: 01a10b71-fa8f-7aff-a06d-c20fbeb7938c
title: "Recording indicator: the `speech.captures` feed of open machine captures and a \"Stop\" chip in the top panel"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b70-624a-788b-ba2a-cbe616b50a26
  - kind: waits-on
    to: 01a10b71-faaa-7731-9455-7d9e0d2967d5
---
Spec step 2: the capture feed on the server and the chip in the window. Follows step 1, because recognition "Stop" calls `finish_recognition`. Done when the feed itest shows listening and recognition open and end as events, and the chip burns during agent listening.
