---
id: 01a18ed3-e654-70cf-a801-7c87cf12b038
title: Exclude module-card testing entries from dead-code production reach
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "done"
  }
---
Testing entries declared by their owning module currently pass the filename-only production filter. Read their testing roles from revision-keyed cards, exclude them from judged exports and consumers, and rejudge affected files and their exports when a card changes.