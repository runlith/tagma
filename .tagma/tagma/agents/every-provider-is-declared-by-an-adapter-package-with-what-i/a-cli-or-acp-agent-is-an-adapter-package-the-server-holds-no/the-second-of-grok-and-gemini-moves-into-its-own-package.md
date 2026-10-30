---
id: 01a18d5f-862b-73c3-8598-6617dc84f88b
title: The second of Grok and Gemini moves into its own package
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-315e-7cf6-89b8-16def116d3cd
---
Step 6 of the Migration in [[57787448]]: whichever of the two the first vendor task did not move. Server code is deleted, tests move and stay green, behaviour and ids are unchanged.