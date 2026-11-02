---
id: 01a19ccc-a70b-7b1c-a454-370b81abda85
title: Keep worktree standings reads independent of run history and thread payloads
ord: 149
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19cbe-733b-7520-82de-9520299f1d18",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
---
Fix the shared outcome lookup to use its terminal-run index and make the activity clock readable without fetching native thread payloads. Preserve standings, unseen results, placement and page semantics; prove the worktree listing through its operation and measure cold and warm reads separately.