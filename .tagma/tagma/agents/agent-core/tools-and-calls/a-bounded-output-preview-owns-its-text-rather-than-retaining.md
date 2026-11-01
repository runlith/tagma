---
id: 01a1947b-33a8-7917-a1bf-11b72a677d2f
title: A bounded output preview owns its text rather than retaining a view of the full answer
ord: 23
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/ToolOutputSpool.ts
---
A head or tail may be a substring view, and joining a single selected line may preserve that view. The preview is copied inside its existing byte envelope so keeping the small answer in a transcript or display cannot keep the producer's full output string alive.