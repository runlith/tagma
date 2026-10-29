---
id: 01a0bf8d-dea3-770c-89b4-74eacbac1e90
title: "#reflection"
ord: 9
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
      "actual": {
        "name": "line",
        "type": "schema"
      },
      "command": {
        "name": "line",
        "type": "schema"
      },
      "expected": {
        "name": "line",
        "type": "schema"
      }
    },
    "gates": [
      {
        "field": "command",
        "gate": "required"
      },
      {
        "field": "expected",
        "gate": "required"
      },
      {
        "field": "actual",
        "gate": "required"
      }
    ],
    "id": "reflection",
    "identity": {
      "shipped": {
        "export": "reflection",
        "library": "core"
      }
    },
    "roles": {
      "observation": true
    },
    "sections": [
      {
        "key": "reflection",
        "text": "A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. It stands under the module declaring the operation or tool it is about, never under another leaf. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report."
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
A #reflection records friction with Tagma itself: what was invoked, what should have happened, what actually happened — each concrete, useful evidence or nuance in the body. It stands under the module declaring the operation or tool it is about, never under another leaf. A measured cost is evidence, frustration alone is not. Read the refusal before blaming the instrument; product defects belong to the product's owner. It is an observation, not a promise to implement; separate finished work answers it. A repeated sighting keeps its own evidence, never rewriting the first report.