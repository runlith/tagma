---
id: 01a14c13-c481-7acc-8aa6-03b0bcebf852
title: The agent reads text in a line window, an image as an image, PDF by pages, and pages directories
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b2bc597e66
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/files.ts
  - kind: file
    ref: packages/agent-tools/src/ls.ts
  - kind: file
    ref: packages/agent-tools/src/pdf.ts
  - kind: file
    ref: packages/agent-tools/src/read.ts
---
**Value.** The agent reads code, a screenshot, or a PDF spec with one tool and gets exactly the window it needs, spending no context and not leaving for a shell.

**How.** The native agent's `read` and `ls` tools (the files capability).

**Behaviour.**
- Text arrives with line numbers, in a window from the given line; a long line is truncated, and a footer says which line continues it.
- The model sees PNG, JPEG, GIF, and WebP as the picture; a PDF reads as text page by page, and a page with no text layer arrives as a picture.
- A directory pages by name, with a continuation cursor. A missing path's refusal shows the nearest existing directory and its contents.
- Reading never asks the operator, in any mode. A read path carries its place's law and notes (delivery — A4).

**Limits.** A binary file doesn't read; a too-large file, image, or PDF isn't shown, and the answer says why. A path may lie anywhere on the machine, not only in the thread's checkout.
