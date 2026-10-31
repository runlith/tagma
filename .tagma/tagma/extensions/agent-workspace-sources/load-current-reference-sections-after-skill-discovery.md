---
id: 01a19400-6ca6-7831-99ec-fe99b0cf9821
title: Load current reference sections after skill discovery
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a185bb-fbfa-7a6b-bde8-4c8b45b4288b
---
Make load_skill read the requested sections of a discovered folder from its current references directory, just as it reads the current body. Keep catalog discovery governed by skills.rescan and keep reference names inside the skill's section namespace. Prove the reported same-catalog scenario through load_skill: discover measuring, then add ios and stands and edit the body before loading them.