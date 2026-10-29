---
id: 01a0cad0-2982-744d-9d96-58a6269568fb
title: strip_comments strips vitest environment pragmas it promises to keep
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "All six `// @vitest-environment jsdom` directives were stripped as prose; the six suites fell back to the `node` default and failed with `document is not defined` (64 tests). The write door then dropped my `//`-form restoration as prose; only the `//!` form survived, which vitest honors.",
    "command": "strip_comments over packages/chat-ui, then bun run test",
    "expected": "Per its contract (\"a pragma a tool reads [is] never rewritten\"), strip_comments keeps `// @vitest-environment jsdom` directives and the suite stays green"
  }
---
Filed from project `runlith`.