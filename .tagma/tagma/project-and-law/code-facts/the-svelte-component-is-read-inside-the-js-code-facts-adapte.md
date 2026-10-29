---
id: 01a14048-c1d8-7a37-90bc-76e81deebeb8
title: The Svelte component is read inside the JS code-facts adapter, and the `platforms` and `modules` aliases come from different sources
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14028-2a07-7ffe-8f7f-2d2da43e08a7
sources:
  - kind: file
    ref: packages/code-facts/src/languages/js/imports.ts
  - kind: file
    ref: packages/code-facts/src/languages/js/resolve.ts
---
Remainder after 4edc2e6b87, found by review.

- `.svelte` is a separate source format but lives inside the JS code-facts adapter: the extension list (`language.ts`), `<script>` extraction (`imports.ts`), and `.svelte` substitution when resolving a relative import (`resolve.ts`). Under rule 6f758080 a format is its own adapter, and the list of substituted extensions is a resolution setting, not kernel knowledge.
- The `$lib` alias is declared twice: `modules` resolves it through tsconfig `paths` (with a copy of the generated config in `built`), `platforms` — through the rule's `aliases`. Two sources of one fact can diverge (rule 51c66cb6): one is needed.

Check: `.svelte` does not occur in `packages/code-facts/src/languages/js`; both builtins' aliases are read from one source; no divergence test is needed because divergence is impossible.
