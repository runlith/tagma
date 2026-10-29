---
id: 01a0bf8d-de5a-73ad-978f-bb4c904a49e2
title: "#module"
ord: 1
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "orientation"
    },
    "contracts": {
      "core/module": {
        "slots": {
          "entries": "entries",
          "id": "id",
          "order": "order"
        },
        "words": {}
      }
    },
    "edges": [
      "validates",
      "relates",
      {
        "kind": "imports",
        "to": [
          "module"
        ]
      },
      {
        "kind": "imports-tests",
        "to": [
          "module"
        ]
      }
    ],
    "fields": {
      "entries": {
        "name": "moduleEntries",
        "type": "schema"
      },
      "id": "string",
      "kind": {
        "type": "enum",
        "values": [
          "kit",
          "product",
          "surface",
          "substrate"
        ]
      },
      "order": {
        "name": "moduleOrder",
        "type": "schema"
      }
    },
    "gates": [
      {
        "gate": "source-required",
        "kinds": [
          "dir",
          "file"
        ]
      }
    ],
    "id": "module",
    "identity": {
      "shipped": {
        "export": "module",
        "library": "software-development"
      }
    },
    "roles": {
      "container": true
    },
    "sections": [
      {
        "key": "module",
        "text": "A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under its part, wherever its code lies: a page for one area of what the user gets, made once the root outgrows a screen; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first."
      },
      {
        "edits": [
          "append"
        ],
        "key": "project",
        "text": ""
      }
    ],
    "sources": [
      "dir",
      "file"
    ]
  }
---
A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under its part, wherever its code lies: a page for one area of what the user gets, made once the root outgrows a screen; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first.