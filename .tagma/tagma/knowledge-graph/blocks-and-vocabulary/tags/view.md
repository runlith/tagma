---
id: 01a0bf8d-deb5-774a-9c41-47a20b43ddc1
title: "#view"
ord: 11
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "orientation"
    },
    "edges": [
      "validates",
      "relates"
    ],
    "fields": {
      "layout": {
        "name": "viewLayout",
        "type": "schema"
      },
      "query": {
        "name": "blockQuery",
        "type": "schema"
      }
    },
    "gates": [
      {
        "field": "query",
        "gate": "required"
      }
    ],
    "id": "view",
    "identity": {
      "shipped": {
        "export": "view",
        "library": "core"
      }
    },
    "roles": {
      "leaf": true
    },
    "sections": [
      {
        "key": "view",
        "text": "A #view saves a selection worth a durable address for repeated use, not every search: say what it answers; opening it runs its query against its own scope — a live reading, not a list to maintain."
      },
      {
        "edits": [
          "append"
        ],
        "key": "project",
        "text": ""
      }
    ]
  }
---
A #view saves a selection worth a durable address for repeated use, not every search: say what it answers; opening it runs its query against its own scope — a live reading, not a list to maintain.