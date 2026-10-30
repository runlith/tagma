---
id: 01a18eda-73b4-7514-aaea-8dd4301d334d
title: Isolate declaration indexes of concurrently running checker versions
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18ed7-6044-7cf2-b358-5d8d71e38a4d
---
The shared law database erases facts, revision indexes and map roots whenever another checker version opens it. Concurrent old/new program runs therefore destroy each other's setup and block unrelated gated landings. Give each executing producer version its own semantic index, retain one shared git-directory catalogue, and prove an alternating-version run keeps both prepared indexes.