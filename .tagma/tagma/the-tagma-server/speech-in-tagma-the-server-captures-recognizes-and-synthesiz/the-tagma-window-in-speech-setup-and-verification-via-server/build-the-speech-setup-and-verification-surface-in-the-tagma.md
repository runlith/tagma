---
id: 01a10737-0706-794d-9a5e-f5bf051498b2
title: Build the speech setup and verification surface in the Tagma window
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10737-2f33-70a3-b50a-bc07137b2c67",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c37c87eac0a0
---
Per spec [[87eac0a0]] on top of the `speech` module's operations and feeds ([[f1420476]]). Only a Claude model builds the UI. Done when the surface shows `speech_status`, manages keys, recognizer and voice choice, microphone, local models, and the verification run through the `speech.recognize` feed and synthesis, and the window's typecheck and tests pass.
