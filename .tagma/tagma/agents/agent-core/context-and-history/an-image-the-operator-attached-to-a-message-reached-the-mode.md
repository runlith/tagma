---
id: 01a155c5-069c-7014-823b-42eaf95c8fd5
title: An image the operator attached to a message reached the model neither as bytes nor as a path after the retry of the turn that failed on the limit
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The prompt held only the text \"Look, there is no proper scrolling here…\" (translated from Russian); the agent had to find the image via read_thread_record (entry.attachments url) and glob in ~/.tagma-dev/attachments — 4 extra calls",
    "command": "operator message with image attachment in thread 01a155bd-f7ff-74da-a925-f4e0f55e265f (first run failed: weekly limit; next run answered the same message)",
    "expected": "The model's turn carries the attached picture or at least its file path (per explanation 1f601161: path is written in at hydrate)"
  }
---
Filed from project `runlith`.

read_thread_record at=1 shows `entry.attachments: [{mime: image/png, url: /api/threads/01a155bd-…/attachments/01a155bd-f848-7800-9e31-fcaa6344ccbc.png}]`, while `messages[0].content` contains only the text part — no image part and no path string. Unknown whether the loss comes from the retried run after the 429 weekly-limit failure or from this transport in general.
