---
id: 01a0c839-17d3-7d06-a00d-69691aee61f4
title: Queries
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/test-utils/observe.svelte.ts",
        "role": "testing"
      },
      {
        "at": "src/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/repo.ts",
        "for": [
          "78f56704",
          "7b63e87f",
          "38c2ca4c",
          "1edee1c2",
          "8f8b93e1",
          "212858cf",
          "1c9696ea",
          "19afd604",
          "de4f491f",
          "1e061782",
          "9e843257",
          "9103ad03",
          "4f0a6d9b",
          "1c787f5f",
          "96400e93",
          "39910e41",
          "8b87c117"
        ]
      },
      {
        "at": "src/builders/keyed.ts",
        "for": [
          "7b63e87f",
          "8f8b93e1",
          "96400e93"
        ]
      },
      {
        "at": "src/builders/single.ts",
        "for": [
          "8f8b93e1"
        ]
      },
      {
        "at": "src/types.ts",
        "for": [
          "78f56704",
          "1edee1c2",
          "8f8b93e1",
          "212858cf",
          "de4f491f",
          "1e061782",
          "9103ad03",
          "4f0a6d9b",
          "1c787f5f",
          "96400e93",
          "39910e41"
        ]
      }
    ],
    "id": "@runlith/query",
    "kind": "kit"
  }
edges:
  - kind: discovered-from
    to: 01a0c830-ca93-7727-b381-91fe9eb3cad7
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: packages/query
---
Client screens need backend answers through named query families, cached in one client and surviving re-render. The kit owns the repository dictionary, scope-prefixed naming, observers in runes with their lifecycle, the gated facade, mutations, and doubles for suites. What each answer loads, through which door, and how long it lives is the product's business: the door is the key it hands over.
