---
id: 01a173bf-dc34-7878-8987-602c378556cb
title: Keep angle-bracket placeholders in paths during Markdown rendering
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a173b0-53c6-79fa-9a83-65e942298d32",
    "status": "done"
  }
---
Fix the reading of `/posters/<w>/<s>.png` as HTML, which drops parts of the path and strikes through the rest of the reasoning. Remove the cause in the Markdown path recognizer, keeping explicitly written HTML; confirm with a regression test through the app renderer, including stream completion. The regression test first reproduced the placeholder loss; after the fix 17 Markdown tests pass, including the live stream, its completion and cold open. Review found HTML capture right after a path separator (`/tmp/<s>**kept**</s>`); the scenario reproduced with a failing test and fixed by bounding the placeholder's right edge. After the boundary fix 17 tests pass with shuffle seeds 1, 2 and 3; typecheck and app build pass as well. No browser check ran.
