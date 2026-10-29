---
id: 01a0c70f-89c1-7b61-9e52-3540e312c061
title: Recognize `@vitest-environment` and `@jest-environment` as directives, so a strip does not take a suite's environment pragma
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c931-8642-7df8-89de-1df704fcec0d",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/source-comments/src/languages/typescript.ts
---
Measured on 2026-09-22: `strip_comments packages/scroll-follow` removed `// @vitest-environment jsdom` from both suites, and six of their eleven tests then failed with `document is not defined`. The TypeScript directive table (`packages/source-comments/src/languages/typescript.ts`) carries the `@ts-*` and eslint pragmas and not vitest's, so the line read as prose. Add the two pragmas to the table (content side; vitest matches `@(vitest|jest)-environment\s+name` anywhere in the file's leading comments), cover it in the classify suite, and re-check the other packages already stripped for the same loss. The two suites carry the pragma as `//!` until the table knows it.