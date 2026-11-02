---
id: 01a1050d-b653-758c-bca6-8843f1420476
title: Build the `speech` server module and the speech setup and verification surface in the window
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1070a-4d0d-7725-96e4-7f5b322529ca",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c37bcc1f119c
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-8840b6141481
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-884187dbf690
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-8842517daa38
sources:
  - kind: dir
    ref: apps/tagma/server/src/speech
---
Module per spec [[cc1f119c]], window per [[87eac0a0]] (UI — Claude models only). Composition binds the adapters, `audio-darwin`, the Whisper engine, and the Bun runtime. Done when the module's integration tests are green and the installed `Tagma.app` smoke passes the verification run.

Result: live smoke on the operator's machine passed — microphone and system-audio capture, Whisper and Soniox, transcript, `finish`, Soniox synthesis, and echo cancellation. Successor handoff was not verified live: the operator deferred it; it is covered only by the module's integration tests.
