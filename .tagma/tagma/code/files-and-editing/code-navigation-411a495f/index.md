---
id: 01a16166-1402-7837-8a74-f7f8411a495f
title: Code navigation
ord: 24
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/verdict.ts"
      },
      {
        "at": "src/question.ts"
      },
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/answer.ts"
      },
      {
        "at": "src/navigation.ts"
      },
      {
        "at": "src/engine.ts"
      }
    ],
    "id": "@runlith/navigation",
    "kind": "kit",
    "order": [
      [
        "src/verdict.ts"
      ],
      [
        "src/question.ts"
      ],
      [
        "src/adapter.ts"
      ],
      [
        "src/engine.ts"
      ],
      [
        "src/answer.ts"
      ],
      [
        "src/owners.ts"
      ],
      [
        "src/owners.worker.ts"
      ],
      [
        "src/navigation.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c702-a15a-7740-ab79-497190d97bc9
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/navigation
---
Before editing, an agent needs to know where a symbol is declared and all the places it occurs, and never mistake a partial answer for a complete one. The kit owns the navigation contract — the `definition` and `uses` question, a verdict per textual occurrence of the name, an answer with revision, lag, and engine state — and the pass that builds it: ripgrep finds candidates, the language adapter gives verdicts by position through the `Engines` port, the kit merges them, folds foreign symbols, comment lines, and out-of-code occurrences into counters, occurrences left unchecked for file-related or language-coverage reasons into counts by file and reason, keeps unreviewed positions for the agent to read, and cuts ready lines into pages. The kit holds no processes, engines, or language semantics: composition supplies the adapter and its engine, and which checkout to ask with which limit is the callers' decision.
