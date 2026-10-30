---
id: 01a18da8-4311-76e0-b56e-7a884737c390
title: Semantic placement keeps resolution state inside one handed tree
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-facts/src/languages/js/resolution.ts
  - kind: file
    ref: packages/code-facts/src/languages/js/symbols.ts
---
A placement question may reach the same import through many receiver chains. Its resolver shares configuration and target answers within that handed tree, but none survive into the next question, where source or installed files may differ. Only the requested names and lines trigger semantic lookup; looking up unrelated spellings can force TypeScript inference and filesystem work the caller never needed.