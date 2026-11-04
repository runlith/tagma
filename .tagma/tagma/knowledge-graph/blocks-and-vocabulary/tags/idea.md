---
id: 01a0bf8d-de91-7cb5-a239-57f347e571a9
title: "#idea"
ord: 7
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "content"
    },
    "edges": [
      "validates",
      "relates"
    ],
    "fields": {
      "status": {
        "type": "enum",
        "values": [
          "open",
          "closed"
        ]
      }
    },
    "gates": [
      {
        "field": "status",
        "from": "open",
        "gate": "transition",
        "to": "closed"
      },
      {
        "field": "status",
        "from": "closed",
        "gate": "transition",
        "to": "open"
      }
    ],
    "id": "idea",
    "identity": {
      "shipped": {
        "export": "idea",
        "library": "work"
      }
    },
    "roles": {
      "status": {
        "closed": "closed",
        "field": "status",
        "initial": "open"
      }
    },
    "sections": [
      {
        "key": "idea",
        "text": "An #idea keeps a worthwhile possibility not yet accepted: the question, the motivation, what would inform the choice, its uncertainty explicit. It obliges no implementation and may be closed once not useful; an accepted target is a #spec. A passing question need not become a node."
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
      "file",
      "dir",
      "symbol"
    ]
  }
---
An #idea keeps a worthwhile possibility not yet accepted: the question, the motivation, what would inform the choice, its uncertainty explicit. It obliges no implementation and may be closed once not useful; an accepted target is a #spec. A passing question need not become a node.