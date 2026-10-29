---
id: 01a0cf56-2ade-7aa3-9d73-858e86856008
title: Record each writer's newest input per terminal, and answer it on the holder's reads
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d0f1-9629-70bb-bf47-7d04580b3719",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-283d-77ed-b27b-f3bf21c657bc
  - kind: waits-on
    to: 01a0cf4b-e140-75c1-b41d-5f5552d67932
---
Build [[21c657bc]] at the server's input gate and in the terminal read operations. Done when the acceptance cases hold for an operator typing into an agent's terminal, including across a server restart, and doctor over the touched paths is clean.