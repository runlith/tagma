---
id: 01a14022-3fdc-7998-a972-6ed7cd1d69bf
title: "`platforms` knows the Vite query in code: `leaves` accepts only `?url|raw|inline`, while `?worker` is parsed separately"
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13fce-a146-7f42-8015-220531b8a60c
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/declaration.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
---
The `leaves` schema (`declaration.ts`) admits only a closed list of Vite queries, while `walk.ts` separately recognizes `?worker`/`?sharedworker`. That is bundler knowledge inside Tagma's code (rule 6f758080), and one bundler is declared in `modules.queries` and `platforms.leaves` in different shapes.

To do: queries in `leaves` become declared data of the same grammar as `modules.queries` (`^\?[^\s?#/]+$`); worker behavior becomes a rule declaration too, with no branch on the name. Check: a `platforms` test where a declared non-Vite query is a leaf and an undeclared one stays a violation.
