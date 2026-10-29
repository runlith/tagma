---
id: 01a18627-8835-76a7-a9a4-dc5da7e9a341
title: Keep traced interactions present after a completed browser gesture
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18627-3d95-7c84-bfb1-c1ee81a96b0b",
    "status": "done"
  }
---
Make the managed-browser interaction scenario stop its trace after Chromium has reported the clicked interaction, rather than after an approximate pair of animation frames. Native event counts distinguish dispatched input from delayed EventTiming publication; retain the 300 ms INP assertion without retries or sleeps. Clean HEAD reproduced the empty trace when stopped immediately after a completed click; its raw file held no EventTiming events.