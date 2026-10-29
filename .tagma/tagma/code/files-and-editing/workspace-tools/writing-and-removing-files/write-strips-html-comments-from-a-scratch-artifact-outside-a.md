---
id: 01a14057-e9fe-767f-969a-973d615ceb38
title: write strips HTML comments from a scratch artifact outside any checkout
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "Dropped 4 comment lines and reported \"The change record kept no row for this path\"; the immediate publish_artifact then answered \"nothing to publish\" and succeeded only on retry",
    "command": "write path=~/.tagma-dev/scratch/<thread>/rails.html (a standalone HTML artifact with <!-- A --> section markers)",
    "expected": "The file in the thread's scratch is written as given: the no-prose-comment rule binds the checkout, not scratch"
  }
---
Filed from project `runlith`.