---
id: 01a1734b-f46e-7d0f-9c0c-29c0629129b7
title: Fallback trigram search for near words over graph blocks and thread conversations when strict FTS is empty
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1734c-6f9e-718d-9230-9bc7f2f1c30d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1734b-d7e6-7660-80b4-37dff267eadb
---
The strict query doesn't change. When it found nothing, a second query over the same indexes finds records with words near the query words (a typo: one edit from 4 letters, two from 8), and marks the results as approximate — in the palette, in `@` mentions and in the agent's `search_blocks` answer. The fallback query's cost is measured on a large graph and a large conversation history.
