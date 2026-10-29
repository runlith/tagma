---
id: 01a12f52-1b0a-74fc-a2fa-e4cb357b5846
title: "Adapter author's kit: own host-module declarations, contract tests, template"
ord: 13
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Gaps from spec-audit №1, №2, №19. `packages/tagma-adapter` is three files; its types import the private `@runlith/llm`, there are no host-module declarations for authors, and there are no contract tests or `bun create @runlith/tagma-adapter` template.

Done: the package assembles into self-contained declarations (no `@runlith/llm` in author dependencies); export of the contract suite the author runs against their adapter (declaration, sign-in, model call against a stub, failures — `LLMError`); a template from which a new adapter passes that suite and loads through the external loader.
