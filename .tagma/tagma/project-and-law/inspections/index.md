---
id: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
title: Inspections
ord: 41
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/builtins.ts"
      },
      {
        "at": "src/core/rule.ts"
      },
      {
        "at": "src/core/verdict.ts"
      },
      {
        "at": "src/builtins.node.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/implementations.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/reading.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/judge.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/budget.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/memo.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/node/slices.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/program.ts"
      },
      {
        "at": "src/runners/",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/core/signature.ts"
      }
    ],
    "id": "@tagma/inspection",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
sources:
  - kind: dir
    ref: apps/tagma/inspection
---
An enforced rule carries an inspection, and this package tells which inspections exist — three packs so far: js, effect and architecture — what each takes, what it does not see, and how a change is judged against the base. It lives as a separate package so tagma check and the inspections SDK reach the law without depending on the server. It owns the builtin declarations, their implementations, and the judging itself; trees, the rule and debt are the caller's business, handed in as values.
