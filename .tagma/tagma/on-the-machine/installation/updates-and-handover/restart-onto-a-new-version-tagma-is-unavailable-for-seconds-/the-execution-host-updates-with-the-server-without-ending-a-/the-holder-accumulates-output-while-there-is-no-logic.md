---
id: 01a1271e-2479-7971-9b0c-4ed1bfd3bc2a
title: The holder accumulates output while there is no logic
ord: 12
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
While there is no logic, programs that write a lot stand on a full kernel buffer: a dev server writing its log synchronously stops answering. For a planned update gap that is seconds; when logic falls repeatedly — until fixed. The holder could drain the output to a file until the logic arrives, but then it starts reading child output and holding disk — exactly what it does not do now and what makes it reliable.

The fact is needed: how long the absence of logic actually lasts, and which of the operator's real programs stop on a full buffer in that time.
