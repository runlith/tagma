---
id: 01a1a256-d1bb-7cf0-8ce5-185056b83175
title: Keep the person's application launchable through interrupted replacement
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a255-1dad-78a2-b0c2-4ebc6f454ac0",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a13cca-55a0-7b12-a0d5-c78c1fe1ff84
---
Replace a standing application without any step removing its primary path: exchange the verified incoming bundle atomically, then remove the displaced bundle. Prove the window's public placement operation still leaves a launchable primary application when its process is killed immediately after publication.