---
id: 01a0d564-ec47-7645-8756-ec405e1647fa
title: Code facts
ord: 40
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "411a495f",
          "00ddf0e5",
          "48c1dabd"
        ]
      },
      {
        "at": "src/blobs.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "00ddf0e5"
        ]
      },
      {
        "at": "src/floors.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9"
        ]
      },
      {
        "at": "src/imports.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "48c1dabd"
        ]
      },
      {
        "at": "src/languages/adapters.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "13182a9f",
          "411a495f",
          "00ddf0e5",
          "48c1dabd"
        ]
      },
      {
        "at": "src/languages/index.ts"
      },
      {
        "at": "src/languages/js/index.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9"
        ]
      },
      {
        "at": "src/languages/js/resolve.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9"
        ]
      },
      {
        "at": "src/languages/js/workspace.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "48c1dabd"
        ]
      },
      {
        "at": "src/tree.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9",
          "00ddf0e5",
          "48c1dabd"
        ]
      },
      {
        "at": "src/languages/js/imports.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "bbddbda9"
        ]
      },
      {
        "at": "src/languages/js/config.ts"
      },
      {
        "at": "src/runtime.ts"
      },
      {
        "at": "src/runtimes/index.ts"
      }
    ],
    "id": "@runlith/code-facts",
    "kind": "kit",
    "order": [
      [
        "src/"
      ],
      [
        "src/languages/"
      ]
    ]
  }
sources:
  - kind: dir
    ref: packages/code-facts
---
Every reader in the product asking what the code says reads through this kit — so two readers don't diverge over one tree. It owns reading imports, declarations, used names and their local bindings from source texts, and resolving imports over a handed tree — one adapter per language — and queries over those facts that carry no rules, the first of which is the floors-table intersections. The core knows no language: parsing, project manifests and resolution settings are the adapter's business; what a tree is and what is forgiven as debt, the callers decide. A Bun macro import stays a dependency for module boundaries but doesn't enter runtime loads.
